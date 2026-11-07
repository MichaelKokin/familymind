import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { assertPrivateId, PrivateCaseError } from "./model";
import { parseResearch } from "./research-model";
import { loadOwnedCase, privateFailure, privateJson } from "./runtime";

export const MAX_RESEARCH_BYTES = 20 * 1024 * 1024;
export async function readResearch(root: string, caseId: string) {
  assertPrivateId(caseId);
  const directory = path.join(root, "research");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== path.join(await realpath(root), "research")) throw new PrivateCaseError("INVALID_RESEARCH");
  const file = await open(path.join(directory, `${caseId}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_RESEARCH_BYTES) throw new PrivateCaseError("INVALID_RESEARCH");
    const bytes = Buffer.alloc(MAX_RESEARCH_BYTES + 1); let size = 0;
    while (size < bytes.length) { const read = await file.read(bytes, size, bytes.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > MAX_RESEARCH_BYTES) throw new PrivateCaseError("INVALID_RESEARCH");
    const value = parseResearch(JSON.parse(bytes.subarray(0, size).toString("utf8")));
    for (const photo of value.photos) {
      const [header, encoded] = photo.dataUrl.split(","); const image = Buffer.from(encoded, "base64");
      const valid = header === "data:image/png;base64" ? image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : header === "data:image/jpeg;base64" ? image[0] === 255 && image[1] === 216 && image[2] === 255 : image.subarray(0,4).toString() === "RIFF" && image.subarray(8,12).toString() === "WEBP";
      if (!valid || image.length > 8 * 1024 * 1024 || image.toString("base64") !== encoded) throw new PrivateCaseError("INVALID_RESEARCH");
    }
    return value;
  } finally { await file.close(); }
}
export async function serveResearch(request: Request) {
  let owned;
  try { owned = await loadOwnedCase(request); } catch (error) { return privateFailure(error); }
  try { return privateJson(await readResearch(owned.store.root, owned.value.id)); }
  catch { return privateJson({ error: "RESEARCH_UNAVAILABLE" }, 404); }
}
