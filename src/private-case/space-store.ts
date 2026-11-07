import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertPrivateId, PrivateCaseError } from "./model";
import { DEFAULT_PRIVATE_ROOT, ensurePrivateDir, ensurePrivateRoot, readPrivateJson, withPrivateLock, writePrivateJson } from "./server-store";
import { MAX_MATERIAL_BYTES, parsePrivateSpace, type MaterialMime, type PrivateSpace, type SpaceMaterial } from "./space-model";

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Signature check never trusts the declared MIME; text must be UTF-8 without NUL. */
export function detectMaterialMime(bytes: Uint8Array, declared: string): MaterialMime | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const detected: MaterialMime | null = starts(137, 80, 78, 71, 13, 10, 26, 10)
    ? "image/png"
    : starts(255, 216, 255)
      ? "image/jpeg"
      : starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80
        ? "image/webp"
        : starts(37, 80, 68, 70, 45)
          ? "application/pdf"
          : null;
  if (detected) return detected === declared ? detected : null;
  if (declared !== "text/plain") return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\u0000") ? null : "text/plain";
  } catch {
    return null;
  }
}

export function decodeMaterialDataUrl(dataUrl: string, mime: string): Buffer {
  const prefix = `data:${mime};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new PrivateCaseError("INVALID_MATERIAL_FILE");
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new PrivateCaseError("INVALID_MATERIAL_FILE");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_MATERIAL_BYTES || bytes.toString("base64") !== encoded) throw new PrivateCaseError("INVALID_MATERIAL_FILE");
  return bytes;
}

/** Owner-added records and originals are never deleted by a later save: ids,
 * creation times, endpoints and stored originals stay; removal is a flag. */
function assertSpaceHistoryPreserved(current: PrivateSpace, next: PrivateSpace): void {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (current.caseId !== next.caseId) throw new PrivateCaseError("CASE_ID_MISMATCH");
  if (!same(current.base, next.base)) throw new PrivateCaseError("BASE_IMMUTABLE");
  if (!same(current.journal, next.journal.slice(0, current.journal.length))) throw new PrivateCaseError("JOURNAL_IMMUTABLE");
  for (const person of current.people) {
    const replacement = next.people.find((item) => item.id === person.id);
    if (!replacement || replacement.createdAt !== person.createdAt) throw new PrivateCaseError("PERSON_HISTORY_IMMUTABLE");
  }
  for (const relationship of current.relationships) {
    const replacement = next.relationships.find((item) => item.id === relationship.id);
    if (!replacement || replacement.createdAt !== relationship.createdAt || replacement.from !== relationship.from || replacement.to !== relationship.to) throw new PrivateCaseError("RELATIONSHIP_HISTORY_IMMUTABLE");
  }
  for (const material of current.materials) {
    const replacement = next.materials.find((item) => item.id === material.id);
    if (!replacement || replacement.createdAt !== material.createdAt || replacement.kind !== material.kind || replacement.origin !== material.origin || replacement.findId !== material.findId) throw new PrivateCaseError("MATERIAL_HISTORY_IMMUTABLE");
    if (material.original && !same(material.original, replacement.original)) throw new PrivateCaseError("ORIGINAL_IMMUTABLE");
  }
  for (const lead of current.leads) {
    const replacement = next.leads.find((item) => item.id === lead.id);
    if (!replacement || replacement.createdAt !== lead.createdAt) throw new PrivateCaseError("LEAD_HISTORY_IMMUTABLE");
  }
  for (const find of current.finds) {
    const replacement = next.finds.find((item) => item.id === find.id);
    if (!replacement || replacement.createdAt !== find.createdAt || replacement.leadId !== find.leadId || !same(find.source, replacement.source)) throw new PrivateCaseError("FIND_HISTORY_IMMUTABLE");
    // A recorded decision (and the material it placed) is never rewritten.
    if (find.status !== "candidate" && (replacement.status !== find.status || replacement.decisionReason !== find.decisionReason || replacement.decidedAt !== find.decidedAt || replacement.materialId !== find.materialId)) throw new PrivateCaseError("FIND_DECISION_IMMUTABLE");
  }
}

export class PrivateSpaceStore {
  readonly root: string;
  constructor(root = DEFAULT_PRIVATE_ROOT) {
    if (!path.isAbsolute(root)) throw new PrivateCaseError("UNSAFE_STORAGE_PATH");
    this.root = root;
  }
  private get directory() {
    return path.join(this.root, "space");
  }
  private spacePath(caseId: string) {
    return path.join(this.directory, `${assertPrivateId(caseId)}.json`);
  }
  private mediaDirectory(caseId: string) {
    return path.join(this.root, "space-media", assertPrivateId(caseId));
  }
  mediaPath(caseId: string, materialId: string) {
    return path.join(this.mediaDirectory(caseId), `${assertPrivateId(materialId)}.bin`);
  }
  private async prepare() {
    await ensurePrivateRoot(this.root);
    await ensurePrivateDir(this.directory);
  }

  async load(caseId: string): Promise<PrivateSpace | null> {
    const file = this.spacePath(caseId);
    await this.prepare();
    const raw = await readPrivateJson(file);
    if (raw === null) return null;
    const space = parsePrivateSpace(raw);
    if (space.caseId !== caseId) throw new PrivateCaseError("CASE_ID_MISMATCH");
    return space;
  }

  /** expectedRevision 0 creates the space; later saves are compare-and-swap with a whole-revision backup. */
  async save(input: PrivateSpace, expectedRevision: number): Promise<PrivateSpace> {
    const value = parsePrivateSpace(input);
    await this.prepare();
    return withPrivateLock(this.directory, value.caseId, async () => {
      const current = await this.load(value.caseId);
      if ((current?.revision ?? 0) !== expectedRevision) throw new PrivateCaseError("STALE_REVISION");
      if (current) assertSpaceHistoryPreserved(current, value);
      const saved = parsePrivateSpace({ ...value, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
      if (current) {
        await ensurePrivateDir(path.join(this.root, "space-backups"));
        await writePrivateJson(path.join(this.root, "space-backups", value.caseId, `${current.revision}.json`), current);
      }
      await writePrivateJson(this.spacePath(value.caseId), saved);
      return saved;
    });
  }

  async loadBackup(caseId: string, revision: number): Promise<PrivateSpace | null> {
    if (!Number.isInteger(revision) || revision < 1) throw new PrivateCaseError("INVALID_REVISION");
    await this.prepare();
    const raw = await readPrivateJson(path.join(this.root, "space-backups", assertPrivateId(caseId), `${revision}.json`));
    return raw === null ? null : parsePrivateSpace(raw);
  }

  private async readMediaFile(file: string): Promise<Buffer> {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_MATERIAL_BYTES) throw new PrivateCaseError("MATERIAL_FILE_CORRUPT");
      const buffer = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size !== stat.size) throw new PrivateCaseError("MATERIAL_FILE_CORRUPT");
      return buffer.subarray(0, size);
    } finally {
      await handle.close();
    }
  }

  /** Writes an original once. The same bytes are idempotent; different bytes under a known id are refused. */
  async writeMedia(caseId: string, materialId: string, bytes: Buffer, mime: MaterialMime): Promise<{ size: number; sha256: string; created: boolean }> {
    if (!bytes.length || bytes.length > MAX_MATERIAL_BYTES || detectMaterialMime(bytes, mime) !== mime) throw new PrivateCaseError("INVALID_MATERIAL_FILE");
    const digest = sha256Hex(bytes);
    await this.prepare();
    await ensurePrivateDir(path.join(this.root, "space-media"));
    const directory = this.mediaDirectory(caseId);
    await ensurePrivateDir(directory);
    const file = this.mediaPath(caseId, materialId);
    const existing = await this.readMediaFile(file).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    });
    if (existing) {
      if (sha256Hex(existing) !== digest) throw new PrivateCaseError("ORIGINAL_IMMUTABLE");
      return { size: bytes.length, sha256: digest, created: false };
    }
    const temp = path.join(directory, `.write-${randomUUID()}.tmp`);
    let renamed = false;
    try {
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, file);
      renamed = true;
    } finally {
      if (!renamed) await fs.unlink(temp).catch(() => undefined);
    }
    return { size: bytes.length, sha256: digest, created: true };
  }

  /** Only for a file this process created in the same request before the metadata save failed. */
  async discardMedia(caseId: string, materialId: string): Promise<void> {
    await fs.unlink(this.mediaPath(caseId, materialId)).catch(() => undefined);
  }

  async hasMedia(caseId: string, materialId: string): Promise<boolean> {
    try {
      const stat = await fs.lstat(this.mediaPath(caseId, materialId));
      return stat.isFile() && !stat.isSymbolicLink();
    } catch (error) {
      if (isErrno(error, "ENOENT")) return false;
      throw error;
    }
  }

  async readMedia(caseId: string, material: SpaceMaterial): Promise<Buffer> {
    if (!material.original) throw new PrivateCaseError("MATERIAL_FILE_MISSING");
    const bytes = await this.readMediaFile(this.mediaPath(caseId, material.id)).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) throw new PrivateCaseError("MATERIAL_FILE_MISSING");
      throw error;
    });
    if (bytes.length !== material.original.size || sha256Hex(bytes) !== material.original.sha256) throw new PrivateCaseError("MATERIAL_FILE_CORRUPT");
    return bytes;
  }
}
