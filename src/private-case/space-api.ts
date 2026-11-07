import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrivateCaseError, privateId } from "./model";
import type { PrivateResearch } from "./research-model";
import { readResearch } from "./research-server";
import { boundedJson, loadOwnedCase, privateFailure, privateHeaders, privateJson } from "./runtime";
import { applySpaceAction, initialSpace, spaceActionSchema, type SpaceContext } from "./space-logic";
import {
  MAX_MATERIAL_BYTES,
  SPACE_EXPORT_FORMAT,
  danglingSpaceReferences,
  materialInputSchema,
  materialMimeSchema,
  materialOriginalSchema,
  parsePrivateSpace,
  privateSpaceSchema,
  safeFileNameSchema,
  validateSpaceReferences,
  type MaterialMime,
  type PrivateSpace,
  type SpaceJournalEntry,
} from "./space-model";
import { decodeMaterialDataUrl, detectMaterialMime, PrivateSpaceStore, sha256Hex } from "./space-store";

export const MAX_MATERIAL_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_SPACE_IMPORT_BYTES = 64 * 1024 * 1024;
const timestamp = z.iso.datetime();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const dataUrlSchema = z.string().max(Math.ceil((MAX_MATERIAL_BYTES * 4) / 3) + 64);
const fileSchema = z.object({ name: safeFileNameSchema, mime: materialMimeSchema, dataUrl: dataUrlSchema }).strict();
const materialRequestSchema = z.union([
  z.object({ expectedRevision: z.number().int().nonnegative(), material: materialInputSchema, file: fileSchema.optional() }).strict(),
  z.object({ expectedRevision: z.number().int().nonnegative(), materialId: privateId, file: fileSchema }).strict(),
]);
const mutateRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), action: spaceActionSchema }).strict();
const bundleFileSchema = z.object({ materialId: privateId, ...materialOriginalSchema.shape, dataUrl: dataUrlSchema }).strict();
export const spaceBundleSchema = z.object({
  format: z.literal(SPACE_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: timestamp,
  caseId: privateId,
  snapshotDigest: hex64.nullable(),
  space: privateSpaceSchema,
  files: z.array(bundleFileSchema).max(500),
}).strict();
export type SpaceBundle = z.infer<typeof spaceBundleSchema>;
export type SpaceStateResponse = {
  space: PrivateSpace;
  snapshot: PrivateResearch | null;
  snapshotDigest: string | null;
  warnings: { snapshotChanged: boolean; dangling: { relationships: string[]; materials: string[]; leads: string[]; finds: string[] } };
  created?: { personId?: string; relationshipId?: string; materialId?: string; leadId?: string; findId?: string };
};

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function spaceFailure(error: unknown) {
  if (error instanceof PrivateCaseError) {
    if (/_NOT_FOUND$|_FILE_MISSING$/.test(error.code)) return privateJson({ error: error.code }, 404);
    if (error.code === "ORIGINAL_ALREADY_SET" || error.code === "FIND_NOT_PENDING") return privateJson({ error: error.code }, 409);
    // "ORIGINAL_*" must not fall into the generic origin/host 403 mapping.
    if (/^ORIGINAL_/.test(error.code)) return privateJson({ error: error.code }, 400);
  }
  return privateFailure(error);
}

async function spaceSession(request: Request) {
  const owned = await loadOwnedCase(request);
  const store = new PrivateSpaceStore(owned.store.root);
  let snapshot: PrivateResearch | null = null;
  try {
    snapshot = await readResearch(owned.store.root, owned.value.id);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const snapshotDigest = snapshot ? sha256Hex(Buffer.from(JSON.stringify(snapshot))) : null;
  const now = new Date().toISOString();
  const space = (await store.load(owned.value.id)) ?? initialSpace(owned.value.id, snapshotDigest, now);
  const snapshotPeopleIds = new Set(snapshot?.people.map((person) => person.id) ?? []);
  const context: SpaceContext = {
    now,
    snapshotPeopleIds,
    snapshotOwnerId: snapshot?.owner.personId && snapshotPeopleIds.has(snapshot.owner.personId) ? snapshot.owner.personId : null,
    snapshotRelationships: snapshot?.relationships.map((relation) => ({ from: relation.from, to: relation.to, kind: relation.kind })) ?? [],
    newId: (prefix) => `${prefix}_${randomUUID()}`,
  };
  return { owned, store, snapshot, snapshotDigest, space, snapshotPeopleIds, context };
}
type SpaceSession = Awaited<ReturnType<typeof spaceSession>>;

function stateResponse(session: SpaceSession, space: PrivateSpace, status = 200, created?: SpaceStateResponse["created"]) {
  const body: SpaceStateResponse = {
    space,
    snapshot: session.snapshot,
    snapshotDigest: session.snapshotDigest,
    warnings: { snapshotChanged: space.base.snapshotDigest !== null && space.base.snapshotDigest !== session.snapshotDigest, dangling: danglingSpaceReferences(space, session.snapshotPeopleIds) },
    ...(created ? { created } : {}),
  };
  return privateJson(body, status);
}

export async function getSpace(request: Request) {
  try {
    const session = await spaceSession(request);
    return stateResponse(session, session.space);
  } catch (error) {
    return spaceFailure(error);
  }
}

export async function mutateSpace(request: Request) {
  try {
    const session = await spaceSession(request);
    const parsed = mutateRequestSchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new PrivateCaseError("INVALID_REQUEST");
    if (parsed.data.expectedRevision !== session.space.revision) throw new PrivateCaseError("STALE_REVISION");
    const result = applySpaceAction(session.space, parsed.data.action, session.context);
    const saved = await session.store.save(result.space, parsed.data.expectedRevision);
    return stateResponse(session, saved, 200, result.created);
  } catch (error) {
    return spaceFailure(error);
  }
}

export async function addMaterial(request: Request) {
  try {
    const session = await spaceSession(request);
    const parsed = materialRequestSchema.safeParse(await boundedJson(request, MAX_MATERIAL_REQUEST_BYTES));
    if (!parsed.success) throw new PrivateCaseError("INVALID_REQUEST");
    if (parsed.data.expectedRevision !== session.space.revision) throw new PrivateCaseError("STALE_REVISION");
    const body = parsed.data;
    const attaching = "materialId" in body;
    if (attaching) {
      const existing = session.space.materials.find((item) => item.id === body.materialId);
      if (!existing) throw new PrivateCaseError("MATERIAL_NOT_FOUND");
      if (existing.original) throw new PrivateCaseError("ORIGINAL_ALREADY_SET");
    }
    const materialId = attaching ? body.materialId : session.context.newId("material");
    let original: { name: string; mime: MaterialMime; size: number; sha256: string } | null = null;
    let createdFile = false;
    if (body.file) {
      const bytes = decodeMaterialDataUrl(body.file.dataUrl, body.file.mime);
      const mime = detectMaterialMime(bytes, body.file.mime);
      if (!mime) throw new PrivateCaseError("INVALID_MATERIAL_FILE");
      const written = await session.store.writeMedia(session.owned.value.id, materialId, bytes, mime);
      createdFile = written.created;
      original = { name: body.file.name, mime, size: written.size, sha256: written.sha256 };
    }
    const context: SpaceContext = { ...session.context, newId: (prefix) => (prefix === "material" ? materialId : session.context.newId(prefix)) };
    try {
      const result = applySpaceAction(session.space, attaching ? { action: "attach_original", id: materialId, original: original! } : { action: "add_material", material: body.material, original }, context);
      const saved = await session.store.save(result.space, body.expectedRevision);
      return stateResponse(session, saved, attaching ? 200 : 201, attaching ? { materialId } : result.created);
    } catch (error) {
      if (createdFile) await session.store.discardMedia(session.owned.value.id, materialId);
      throw error;
    }
  } catch (error) {
    return spaceFailure(error);
  }
}

function asciiFileName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim();
  return ascii || "material";
}

export async function serveMedia(request: Request) {
  try {
    const session = await spaceSession(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!privateId.safeParse(id).success) throw new PrivateCaseError("MATERIAL_NOT_FOUND");
    const material = session.space.materials.find((item) => item.id === id);
    if (!material) throw new PrivateCaseError("MATERIAL_NOT_FOUND");
    if (!material.original) throw new PrivateCaseError("MATERIAL_FILE_MISSING");
    const bytes = await session.store.readMedia(session.owned.value.id, material);
    const disposition = material.original.mime.startsWith("image/") ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type": material.original.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${disposition}; filename="${asciiFileName(material.original.name)}"; filename*=UTF-8''${encodeURIComponent(material.original.name)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return spaceFailure(error);
  }
}

export async function exportSpace(request: Request) {
  try {
    const session = await spaceSession(request);
    const files: SpaceBundle["files"] = [];
    for (const material of session.space.materials) {
      if (!material.original) continue;
      const bytes = await session.store.readMedia(session.owned.value.id, material);
      files.push({ materialId: material.id, ...material.original, dataUrl: `data:${material.original.mime};base64,${bytes.toString("base64")}` });
    }
    const bundle: SpaceBundle = { format: SPACE_EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), caseId: session.owned.value.id, snapshotDigest: session.snapshotDigest, space: session.space, files };
    return new Response(JSON.stringify(bundle, null, 2), { headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="familymind-private-space.json"' } });
  } catch (error) {
    return spaceFailure(error);
  }
}

function mergeRecords<T extends { id: string; createdAt: string; updatedAt: string; removedAt: string | null }>(current: T[], incoming: T[], now: string, check: (existing: T, replacement: T) => void): T[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged = current.map((item) => {
    const replacement = incomingById.get(item.id);
    if (!replacement) return item.removedAt ? item : { ...item, removedAt: now, updatedAt: now };
    incomingById.delete(item.id);
    check(item, replacement);
    return { ...replacement, createdAt: item.createdAt };
  });
  return [...merged, ...incomingById.values()];
}

/** Restores a bundle into the same case without erasing anything: records absent
 * from the bundle become removed (recoverable), originals stay, the journal grows. */
export function mergeImportedSpace(current: PrivateSpace, incoming: PrivateSpace, exportedAt: string, context: SpaceContext): PrivateSpace {
  if (current.caseId !== incoming.caseId) throw new PrivateCaseError("CASE_SCOPE_VIOLATION");
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const people = mergeRecords(current.people, incoming.people, context.now, () => undefined);
  const relationships = mergeRecords(current.relationships, incoming.relationships, context.now, (existing, replacement) => {
    if (existing.from !== replacement.from || existing.to !== replacement.to) throw new PrivateCaseError("RELATIONSHIP_HISTORY_IMMUTABLE");
  });
  const materials = mergeRecords(current.materials, incoming.materials, context.now, (existing, replacement) => {
    if (existing.kind !== replacement.kind || existing.origin !== replacement.origin || existing.findId !== replacement.findId) throw new PrivateCaseError("MATERIAL_HISTORY_IMMUTABLE");
    if (existing.original && !same(existing.original, replacement.original)) throw new PrivateCaseError("ORIGINAL_IMMUTABLE");
  });
  const leads = mergeRecords(current.leads, incoming.leads, context.now, () => undefined);
  const finds = mergeRecords(current.finds, incoming.finds, context.now, (existing, replacement) => {
    if (existing.leadId !== replacement.leadId || !same(existing.source, replacement.source)) throw new PrivateCaseError("FIND_HISTORY_IMMUTABLE");
    if (existing.status !== "candidate" && (existing.status !== replacement.status || existing.decisionReason !== replacement.decisionReason || existing.decidedAt !== replacement.decidedAt || existing.materialId !== replacement.materialId)) throw new PrivateCaseError("FIND_DECISION_IMMUTABLE");
  });
  const entry: SpaceJournalEntry = { id: context.newId("journal"), at: context.now, action: "import", targetId: String(incoming.revision), detail: `exportedAt=${exportedAt}` };
  const journal = [...current.journal, ...(current.revision === 0 && !current.journal.length ? [{ id: context.newId("journal"), at: context.now, action: "migrated" as const, targetId: current.base.snapshotDigest ?? "", detail: current.base.kind }] : []), entry];
  return parsePrivateSpace({ ...current, ownerPersonId: incoming.ownerPersonId ?? current.ownerPersonId, people, relationships, materials, leads, finds, layout: incoming.layout, guide: incoming.guide, journal, updatedAt: context.now });
}

export async function importSpace(request: Request) {
  try {
    const session = await spaceSession(request);
    const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), bundle: spaceBundleSchema }).strict().safeParse(await boundedJson(request, MAX_SPACE_IMPORT_BYTES));
    if (!parsed.success) throw new PrivateCaseError("INVALID_IMPORT");
    const { expectedRevision, bundle } = parsed.data;
    if (bundle.caseId !== session.owned.value.id || bundle.space.caseId !== session.owned.value.id) throw new PrivateCaseError("CASE_SCOPE_VIOLATION");
    if (expectedRevision !== session.space.revision) throw new PrivateCaseError("STALE_REVISION");
    const incoming = parsePrivateSpace(bundle.space);
    const merged = mergeImportedSpace(session.space, incoming, bundle.exportedAt, session.context);
    validateSpaceReferences(merged, session.snapshotPeopleIds);
    // Every referenced original must arrive in the bundle or already exist with the same digest; nothing is written before all checks pass.
    const files = new Map<string, { bytes: Buffer; mime: MaterialMime }>();
    const seen = new Set<string>();
    for (const file of bundle.files) {
      if (seen.has(file.materialId)) throw new PrivateCaseError("INVALID_IMPORT");
      seen.add(file.materialId);
      const material = merged.materials.find((item) => item.id === file.materialId);
      if (!material?.original || material.original.name !== file.name || material.original.mime !== file.mime || material.original.size !== file.size || material.original.sha256 !== file.sha256) throw new PrivateCaseError("IMPORT_FILE_UNEXPECTED");
      const bytes = decodeMaterialDataUrl(file.dataUrl, file.mime);
      if (bytes.length !== file.size || sha256Hex(bytes) !== file.sha256 || detectMaterialMime(bytes, file.mime) !== file.mime) throw new PrivateCaseError("IMPORT_FILE_CORRUPT");
      files.set(file.materialId, { bytes, mime: file.mime });
    }
    for (const material of merged.materials) {
      if (material.original && !files.has(material.id) && !(await session.store.hasMedia(session.owned.value.id, material.id))) throw new PrivateCaseError("IMPORT_FILE_MISSING");
    }
    for (const [materialId, file] of files) await session.store.writeMedia(session.owned.value.id, materialId, file.bytes, file.mime);
    const saved = await session.store.save(merged, expectedRevision);
    return stateResponse(session, saved);
  } catch (error) {
    return spaceFailure(error);
  }
}
