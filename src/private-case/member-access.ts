import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { assertLocalRequest, LocalCaseAccess, DEFAULT_LOCAL_ORIGIN } from "./access";
import { assertPrivateId, PrivateCaseError } from "./model";
import { DEFAULT_PRIVATE_ROOT, ensurePrivateDir, ensurePrivateRoot, readPrivateJson, withPrivateLock, writePrivateJson } from "./server-store";
import { MemberNotesStore } from "./member-store";
import type { FamilyMember, MemberPrincipal } from "./member-model";

export const MEMBER_COOKIE = "fm_member_session";
const sessionTtlMs = 8 * 60 * 60 * 1000;
const inviteTtlMs = 10 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const record = z.object({ id: z.string().uuid(), caseId: z.string(), memberId: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime() }).strict();
const stateSchema = z.object({ invites: z.array(record).max(200), sessions: z.array(record).max(500) }).strict();
type AuthState = z.infer<typeof stateSchema>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

export function memberSessionCookie(token: string, expiresAt: string) {
  if (!tokenPattern.test(token) || !Number.isFinite(Date.parse(expiresAt))) throw new PrivateCaseError("INVALID_SESSION");
  return `${MEMBER_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/private; Expires=${new Date(expiresAt).toUTCString()}`;
}
export function clearMemberCookie() { return `${MEMBER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/private; Max-Age=0`; }

/** A member capability is never accepted by owner-only LocalCaseAccess. */
export class MemberSessionAccess {
  readonly owner: LocalCaseAccess;
  readonly notes: MemberNotesStore;
  constructor(readonly root = DEFAULT_PRIVATE_ROOT, readonly origin = DEFAULT_LOCAL_ORIGIN) {
    this.owner = new LocalCaseAccess(root, origin);
    this.notes = new MemberNotesStore(root);
  }
  private get directory() { return path.join(this.root, "member-auth"); }
  private get file() { return path.join(this.directory, "sessions.json"); }
  private async prepare() { await ensurePrivateRoot(this.root); await ensurePrivateDir(this.directory); }
  private async read(): Promise<AuthState> {
    const raw = await readPrivateJson(this.file);
    if (raw === null) return { invites: [], sessions: [] };
    const parsed = stateSchema.safeParse(raw);
    if (!parsed.success) throw new PrivateCaseError("AUTH_STORAGE_CORRUPT");
    for (const item of [...parsed.data.invites, ...parsed.data.sessions]) { assertPrivateId(item.caseId); assertPrivateId(item.memberId); }
    return parsed.data;
  }
  private prune(state: AuthState): AuthState {
    return { invites: state.invites.filter(s => Date.parse(s.expiresAt) > Date.now()), sessions: state.sessions.filter(s => Date.parse(s.expiresAt) > Date.now()) };
  }
  private cookieToken(request: Request): string | null {
    const matches = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${MEMBER_COOKIE}=`));
    if (!matches.length) return null;
    if (matches.length !== 1 || !tokenPattern.test(matches[0].slice(MEMBER_COOKIE.length + 1))) throw new PrivateCaseError("UNAUTHORIZED");
    return matches[0].slice(MEMBER_COOKIE.length + 1);
  }
  async requireOwner(request: Request): Promise<MemberPrincipal> {
    const session = await this.owner.require(request);
    return { ...session, memberId: "owner", role: "owner" };
  }
  async require(request: Request): Promise<MemberPrincipal> {
    assertLocalRequest(request, this.origin);
    const token = this.cookieToken(request);
    // A present invalid/revoked member cookie fails closed, never falls back to an owner.
    if (!token) return this.requireOwner(request);
    await this.prepare();
    const digest = hash(token);
    const session = (await this.read()).sessions.find(s => equal(s.digest, digest) && Date.parse(s.expiresAt) > Date.now());
    if (!session) throw new PrivateCaseError("UNAUTHORIZED");
    await this.notes.activeMember(session.caseId, session.memberId);
    return { caseId: session.caseId, memberId: session.memberId, sessionId: session.id, role: "member" };
  }
  async invite(request: Request, displayName: string) {
    const principal = await this.requireOwner(request);
    if (request.method !== "POST") throw new PrivateCaseError("METHOD_FORBIDDEN");
    const member = await this.notes.addMember(principal, displayName);
    try {
      return await this.issueInvite(principal, member);
    } catch (error) { await this.notes.revokeMember(principal, member.id); throw error; }
  }
  async reinvite(request: Request, memberId: string) {
    const principal = await this.requireOwner(request);
    if (request.method !== "POST") throw new PrivateCaseError("METHOD_FORBIDDEN");
    assertPrivateId(memberId);
    const member = await this.notes.activeMember(principal.caseId, memberId);
    return this.issueInvite(principal, member);
  }
  private async issueInvite(principal: MemberPrincipal, member: FamilyMember) {
    await this.prepare();
    return withPrivateLock(this.directory, "auth", async () => {
        const state = this.prune(await this.read());
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + inviteTtlMs).toISOString();
        state.invites = state.invites.filter(s => s.caseId !== principal.caseId || s.memberId !== member.id);
        state.invites.push({ id: randomUUID(), caseId: principal.caseId, memberId: member.id, digest: hash(token), expiresAt });
        if (state.invites.length > 200) throw new PrivateCaseError("AUTH_LIMIT");
        await writePrivateJson(this.file, state);
        return { member, token, expiresAt };
    });
  }
  async exchange(request: Request, token: string) {
    assertLocalRequest(request, this.origin);
    if (request.method !== "POST" || !tokenPattern.test(token)) throw new PrivateCaseError("UNAUTHORIZED");
    await this.prepare();
    return withPrivateLock(this.directory, "auth", async () => {
      const state = this.prune(await this.read()); const digest = hash(token);
      const found = state.invites.find(s => equal(s.digest, digest));
      if (!found) throw new PrivateCaseError("UNAUTHORIZED");
      await this.notes.activeMember(found.caseId, found.memberId);
      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
      state.invites = state.invites.filter(s => s.id !== found.id);
      state.sessions.push({ id: randomUUID(), caseId: found.caseId, memberId: found.memberId, digest: hash(sessionToken), expiresAt });
      if (state.sessions.length > 500) throw new PrivateCaseError("AUTH_LIMIT");
      await writePrivateJson(this.file, state);
      return { token: sessionToken, caseId: found.caseId, memberId: found.memberId, expiresAt };
    });
  }
  async revokeSession(request: Request) {
    assertLocalRequest(request, this.origin);
    if (request.method !== "POST") throw new PrivateCaseError("METHOD_FORBIDDEN");
    if (!this.cookieToken(request)) return;
    let principal: MemberPrincipal;
    try { principal = await this.require(request); }
    catch (error) { if (error instanceof PrivateCaseError && error.code === "UNAUTHORIZED") return; throw error; }
    if (principal.role !== "member") throw new PrivateCaseError("MEMBER_FORBIDDEN");
    await this.prepare();
    await withPrivateLock(this.directory, "auth", async () => {
      const state = this.prune(await this.read());
      state.sessions = state.sessions.filter(s => s.id !== principal.sessionId);
      await writePrivateJson(this.file, state);
    });
  }
}
