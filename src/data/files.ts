import { DomainError, type AllowedMime, type Workspace } from "../domain/model";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;

function validateName(name: string) {
  if (
    !name ||
    name.length > 300 ||
    /[\\/\u0000-\u001f]/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new DomainError("UNSAFE_FILENAME");
}

function signatureMatches(
  bytes: Uint8Array,
  mime: string,
): mime is AllowedMime {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (mime === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === "image/jpeg") return starts(255, 216, 255);
  if (mime === "application/pdf") return starts(37, 80, 68, 70, 45);
  if (mime === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return !text.includes("\u0000");
    } catch {
      return false;
    }
  }
  return false;
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function decodeBase64(encoded: string): Uint8Array {
  // A single character-class repetition avoids regex stack exhaustion on 5 MiB files.
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new DomainError("INVALID_ATTACHMENT");
  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new DomainError("INVALID_ATTACHMENT");
  }
}

export async function readArtifactFile(
  file: File,
): Promise<{ name: string; mime: AllowedMime; size: number; dataUrl: string }> {
  validateName(file.name);
  if (file.size > MAX_FILE_BYTES) throw new DomainError("FILE_TOO_LARGE");
  if (!file.size) throw new DomainError("EMPTY_FILE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime =
    file.type || (file.name.toLowerCase().endsWith(".txt") ? "text/plain" : "");
  if (!signatureMatches(bytes, mime)) throw new DomainError("UNSUPPORTED_FILE");
  return {
    name: file.name,
    mime,
    size: bytes.length,
    dataUrl: `data:${mime};base64,${encodeBytes(bytes)}`,
  };
}

/** Checked on every persistence/import boundary, never trusts a declared MIME. */
export function validateWorkspaceFiles(workspace: Workspace): void {
  let total = 0;
  for (const artifact of workspace.artifacts) {
    validateName(artifact.name);
    if (artifact.dataUrl === null) continue;
    const prefix = `data:${artifact.mime};base64,`;
    if (!artifact.dataUrl.startsWith(prefix))
      throw new DomainError("INVALID_ATTACHMENT");
    const bytes = decodeBase64(artifact.dataUrl.slice(prefix.length));
    if (
      bytes.length !== artifact.size ||
      bytes.length === 0 ||
      bytes.length > MAX_FILE_BYTES ||
      !signatureMatches(bytes, artifact.mime)
    )
      throw new DomainError("INVALID_ATTACHMENT");
    total += bytes.length;
    if (total > MAX_TOTAL_FILE_BYTES)
      throw new DomainError("FILES_TOTAL_TOO_LARGE");
  }
}

export function artifactText(dataUrl: string | null): string {
  if (!dataUrl?.startsWith("data:text/plain;base64,")) return "";
  return new TextDecoder().decode(
    decodeBase64(dataUrl.slice("data:text/plain;base64,".length)),
  );
}
