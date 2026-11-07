import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { assertPrivateId } from "./model";
import { loadOwnedCase, privateFailure, privateHeaders } from "./runtime";
import { privateCaseText as t } from "../i18n/private-case";

export const MAX_REPORT_BYTES = 20 * 1024 * 1024;
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const headers = { ...privateHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": REPORT_CSP, "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };

/** The filename comes only from the authenticated case, never request parameters. */
export async function readCaseReport(root: string, caseId: string): Promise<string> {
  assertPrivateId(caseId);
  const directory = path.join(root, "reports");
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("UNSAFE_REPORT");
  const actualRoot = await realpath(root);
  if (await realpath(directory) !== path.join(actualRoot, "reports")) throw new Error("UNSAFE_REPORT");
  const handle = await open(path.join(directory, `${caseId}.html`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_REPORT_BYTES) throw new Error("INVALID_REPORT");
    // Bounded reads also handle a file growing after stat without allocating without limit.
    const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_REPORT_BYTES) throw new Error("INVALID_REPORT");
    return buffer.subarray(0, size).toString("utf8");
  } finally { await handle.close(); }
}

function unavailable(status: number, title: string, message: string): Response {
  // All strings are trusted, externalized UI copy; no errors or private paths are echoed.
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{max-width:640px;margin:12vh auto;padding:24px;font:18px/1.6 system-ui;background:#f6f3eb;color:#213f39}h1{font:38px Georgia}a{color:inherit}</style><h1>${title}</h1><p>${message}</p><a href="/case">${t.reportBack}</a></html>`, { status, headers });
}

export async function serveCaseReport(request: Request): Promise<Response> {
  let owned;
  try { owned = await loadOwnedCase(request); }
  catch (error) {
    const status = privateFailure(error).status;
    return unavailable(status, t.reportUnavailable, status === 401 ? t.errors.UNAUTHORIZED : t.reportAccessError);
  }
  try {
    return new Response(await readCaseReport(owned.store.root, owned.value.id), { headers });
  } catch { return unavailable(404, t.reportMissing, t.reportMissingHint); }
}
