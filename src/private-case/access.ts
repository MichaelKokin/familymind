import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { assertPrivateId, PrivateCaseError } from "./model";
import {
  DEFAULT_PRIVATE_ROOT,
  ensurePrivateDir,
  ensurePrivateRoot,
  readPrivateJson,
  withPrivateLock,
  writePrivateJson,
} from "./server-store";

export const SESSION_COOKIE = "fm_private_session";
export const DEFAULT_LOCAL_ORIGIN = "http://127.0.0.1:3000";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z
  .object({
    id: z.string().uuid(),
    caseId: z.string(),
    digest: digestSchema,
    expiresAt: z.iso.datetime(),
  })
  .strict();
const authSchema = z
  .object({
    bootstraps: z.array(recordSchema).max(100),
    sessions: z.array(recordSchema).max(100),
  })
  .strict();
type AuthState = z.infer<typeof authSchema>;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const constantEqual = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

function trustedOrigin(origin: string): URL {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new PrivateCaseError("INVALID_LOCAL_ORIGIN");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new PrivateCaseError("INVALID_LOCAL_ORIGIN");
  return url;
}

/** Protect reads too: a loopback socket alone does not stop DNS rebinding or CSRF. */
export function assertLocalRequest(
  request: Request,
  origin = DEFAULT_LOCAL_ORIGIN,
): void {
  const allowed = trustedOrigin(origin);
  const incoming = new URL(request.url);
  // Next 16 canonicalizes Route Handler URLs to localhost even when bound to
  // 127.0.0.1. This internal spelling is safe only with the exact external Host
  // below; client Origin and forwarded Host remain independently checked.
  const nextInternalOrigin = incoming.protocol === allowed.protocol &&
    incoming.hostname === "localhost" && incoming.port === allowed.port;
  if (
    (incoming.origin !== allowed.origin && !nextInternalOrigin) ||
    request.headers.get("host") !== allowed.host
  )
    throw new PrivateCaseError("HOST_FORBIDDEN");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost !== allowed.host)
    throw new PrivateCaseError("HOST_FORBIDDEN");
  const requestOrigin = request.headers.get("origin");
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(
    request.method.toUpperCase(),
  );
  if (
    (mutation && requestOrigin !== allowed.origin) ||
    (requestOrigin !== null && requestOrigin !== allowed.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new PrivateCaseError("ORIGIN_FORBIDDEN");
}

export function sessionCookie(token: string, expiresAt: string): string {
  if (!tokenPattern.test(token) || !Number.isFinite(Date.parse(expiresAt)))
    throw new PrivateCaseError("INVALID_SESSION");
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/private; Expires=${new Date(expiresAt).toUTCString()}`;
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/private; Max-Age=0`;
}

export class LocalCaseAccess {
  readonly root: string;
  readonly origin: string;
  constructor(root = DEFAULT_PRIVATE_ROOT, origin = DEFAULT_LOCAL_ORIGIN) {
    if (!path.isAbsolute(root)) throw new PrivateCaseError("UNSAFE_STORAGE_PATH");
    this.root = root;
    this.origin = trustedOrigin(origin).origin;
  }
  private get directory() {
    return path.join(this.root, "auth");
  }
  private get file() {
    return path.join(this.directory, "sessions.json");
  }
  private async prepare() {
    await ensurePrivateRoot(this.root);
    await ensurePrivateDir(this.directory);
  }
  private async read(): Promise<AuthState> {
    const raw = await readPrivateJson(this.file);
    if (raw === null) return { bootstraps: [], sessions: [] };
    const parsed = authSchema.safeParse(raw);
    if (!parsed.success) throw new PrivateCaseError("AUTH_STORAGE_CORRUPT");
    for (const item of [...parsed.data.bootstraps, ...parsed.data.sessions])
      assertPrivateId(item.caseId);
    return parsed.data;
  }
  private prune(state: AuthState): AuthState {
    const live = (item: z.infer<typeof recordSchema>) =>
      Date.parse(item.expiresAt) > Date.now();
    return {
      bootstraps: state.bootstraps.filter(live),
      sessions: state.sessions.filter(live),
    };
  }
  private cookieToken(request: Request): string {
    const cookies = (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim());
    const matches = cookies.filter((part) =>
      part.startsWith(`${SESSION_COOKIE}=`),
    );
    if (matches.length !== 1) throw new PrivateCaseError("UNAUTHORIZED");
    const token = matches[0].slice(SESSION_COOKIE.length + 1);
    if (!tokenPattern.test(token)) throw new PrivateCaseError("UNAUTHORIZED");
    return token;
  }

  async createBootstrap(
    caseId: string,
    ttlMs = 5 * 60 * 1000,
  ): Promise<{ token: string; expiresAt: string }> {
    assertPrivateId(caseId);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 10 * 60 * 1000)
      throw new PrivateCaseError("INVALID_EXPIRY");
    await this.prepare();
    return withPrivateLock(this.directory, "auth", async () => {
      const state = this.prune(await this.read());
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      // Creating a fresh launch capability revokes older unredeemed capabilities for this case.
      state.bootstraps = state.bootstraps.filter(
        (item) => item.caseId !== caseId,
      );
      state.bootstraps.push({
        id: randomUUID(),
        caseId,
        digest: digest(token),
        expiresAt,
      });
      if (state.bootstraps.length > 100)
        throw new PrivateCaseError("AUTH_LIMIT");
      await writePrivateJson(this.file, state);
      return { token, expiresAt };
    });
  }

  async exchange(
    request: Request,
    token: string,
  ): Promise<{ token: string; caseId: string; expiresAt: string }> {
    assertLocalRequest(request, this.origin);
    if (request.method !== "POST" || !tokenPattern.test(token))
      throw new PrivateCaseError("UNAUTHORIZED");
    await this.prepare();
    return withPrivateLock(this.directory, "auth", async () => {
      const state = this.prune(await this.read());
      const hash = digest(token);
      const found = state.bootstraps.find((item) =>
        constantEqual(item.digest, hash),
      );
      if (!found) throw new PrivateCaseError("UNAUTHORIZED");
      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
      state.bootstraps = state.bootstraps.filter(
        (item) => item.id !== found.id,
      );
      state.sessions.push({
        id: randomUUID(),
        caseId: found.caseId,
        digest: digest(sessionToken),
        expiresAt,
      });
      if (state.sessions.length > 100) throw new PrivateCaseError("AUTH_LIMIT");
      await writePrivateJson(this.file, state);
      return { token: sessionToken, caseId: found.caseId, expiresAt };
    });
  }

  async require(
    request: Request,
    caseId?: string,
  ): Promise<{ caseId: string; sessionId: string }> {
    assertLocalRequest(request, this.origin);
    if (caseId) assertPrivateId(caseId);
    const hash = digest(this.cookieToken(request));
    await this.prepare();
    const session = (await this.read()).sessions.find(
      (item) =>
        constantEqual(item.digest, hash) &&
        Date.parse(item.expiresAt) > Date.now(),
    );
    if (!session) throw new PrivateCaseError("UNAUTHORIZED");
    if (caseId && session.caseId !== caseId)
      throw new PrivateCaseError("CASE_FORBIDDEN");
    return { caseId: session.caseId, sessionId: session.id };
  }

  async revoke(request: Request): Promise<void> {
    if (request.method !== "POST")
      throw new PrivateCaseError("METHOD_FORBIDDEN");
    const session = await this.require(request);
    await withPrivateLock(this.directory, "auth", async () => {
      const state = this.prune(await this.read());
      state.sessions = state.sessions.filter(
        (item) => item.id !== session.sessionId,
      );
      await writePrivateJson(this.file, state);
    });
  }
}
