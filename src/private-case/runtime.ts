import { LocalCaseAccess } from "./access";
import { PrivateCaseStore, DEFAULT_PRIVATE_ROOT } from "./server-store";
import { PrivateCaseError } from "./model";

export function privateRuntime() {
  const root = process.env.FAMILYMIND_PRIVATE_ROOT || DEFAULT_PRIVATE_ROOT;
  const origin = process.env.FAMILYMIND_ORIGIN || "http://127.0.0.1:3000";
  return { store: new PrivateCaseStore(root), access: new LocalCaseAccess(root, origin) };
}

export const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
export function privateJson(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { ...privateHeaders, ...extra } });
}

export async function boundedJson(request: Request, limit = 64 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PrivateCaseError("JSON_REQUIRED");
  const reader = request.body?.getReader();
  if (!reader) throw new PrivateCaseError("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PrivateCaseError("REQUEST_TOO_LARGE"); }
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new PrivateCaseError("INVALID_REQUEST"); }
  } finally { reader.releaseLock(); }
}

// Error details never contain source text, file paths, child-process output or tokens.
export function privateFailure(error: unknown) {
  const code = error instanceof PrivateCaseError ? error.code : "REQUEST_FAILED";
  const auth = /UNAUTHORIZED|SESSION|TOKEN|BOOTSTRAP|AUTH_REQUIRED/.test(code);
  const forbidden = /ORIGIN|HOST|CROSS_SITE|LOCAL_ONLY|CASE_SCOPE|CASE_ACCESS|FORBIDDEN/.test(code);
  const conflict = /STALE_REVISION|ALREADY|BUSY|ACTIVE_RUN/.test(code);
  return privateJson({ error: code }, auth ? 401 : forbidden ? 403 : conflict ? 409 : code === "CASE_NOT_FOUND" ? 404 : 400);
}

export async function loadOwnedCase(request: Request) {
  const { store, access } = privateRuntime();
  const session = await access.require(request);
  let value = await store.load(session.caseId);
  if (!value) throw new PrivateCaseError("CASE_NOT_FOUND");
  // The CLI is bounded to 180 seconds. A crashed server must not show perpetual progress.
  if (value.aiRuns.some(r => ["queued", "running"].includes(r.status) && Date.now() - Date.parse(r.startedAt) > 240_000)) {
    value = await store.save({ ...value, aiRuns: value.aiRuns.map(r => ["queued", "running"].includes(r.status) && Date.now() - Date.parse(r.startedAt) > 240_000 ? { ...r, status: "interrupted", error: "RUN_INTERRUPTED", completedAt: new Date().toISOString() } : r) }, value.revision);
  }
  return { value, store, access };
}
