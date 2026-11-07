import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import { MemberSessionAccess, MEMBER_COOKIE, memberSessionCookie } from "../src/private-case/member-access";
import { MemberNotesStore } from "../src/private-case/member-store";
import { PrivateCaseStore } from "../src/private-case/server-store";
import { listAccessibleNotes } from "../src/private-case/notes-runtime";
import type { MemberNote } from "../src/private-case/member-model";
import * as notesApi from "../src/private-case/notes-api";
import * as membersApi from "../src/private-case/member-api";
import * as sessionApi from "../src/private-case/session-api";

let root: string;
const origin = "http://127.0.0.1:3000";
function request(route: string, method = "GET", cookie?: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/private/${route}`, { method, headers: { host: "127.0.0.1:3000", ...(method === "GET" ? {} : { origin, "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "familymind-member-synthetic-")); vi.stubEnv("FAMILYMIND_PRIVATE_ROOT", root); vi.stubEnv("FAMILYMIND_ORIGIN", origin); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function owner(caseId = "case_synthetic_a") {
  const store = new PrivateCaseStore(root);
  await store.save({ schemaVersion: 1, id: caseId, title: "SYNTHETIC CASE", revision: 0, updatedAt: new Date().toISOString(), subject: { personId: "synthetic_person", name: "Учебный Человек", dateText: "около 1900", livingStatus: "deceased" }, sources: [], known: [], question: "Синтетическая проверка", notes: "", aiRuns: [], reviews: [] }, null);
  const access = new LocalCaseAccess(root);
  const capability = await access.createBootstrap(caseId);
  const session = await access.exchange(request("session", "POST"), capability.token);
  return { cookie: `${SESSION_COOKIE}=${session.token}`, token: session.token, caseId };
}
async function member(ownerCookie: string, displayName: string) {
  const access = new MemberSessionAccess(root);
  const invitation = await access.invite(request("members", "POST", ownerCookie), displayName);
  const session = await access.exchange(request("members", "POST"), invitation.token);
  return { cookie: `${MEMBER_COOKIE}=${session.token}`, token: session.token, memberId: session.memberId, invitation, session };
}
async function create(cookie: string, text: string, visibility: "private" | "family" = "private") {
  const response = await notesApi.POST(request("notes", "POST", cookie, { personId: "synthetic_person", text, visibility }));
  expect(response.status).toBe(201);
  return (await response.json()).note as MemberNote;
}
async function list(cookie: string) {
  const response = await notesApi.GET(request("notes", "GET", cookie));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
  return (await response.json()).notes as MemberNote[];
}

describe("member notes enforce server-side identity and privacy", () => {
  it("isolates three authors and a foreign family in lists, direct IDs and chat context", async () => {
    const a = await owner(), b = await owner("case_synthetic_b");
    const alice = await member(a.cookie, "Synthetic member A"), bob = await member(a.cookie, "Synthetic member B"), foreign = await member(b.cookie, "Synthetic other family");
    const ownerPrivate = await create(a.cookie, "OWNER PRIVATE"), ownerShared = await create(a.cookie, "OWNER FAMILY", "family");
    const alicePrivate = await create(alice.cookie, "ALICE PRIVATE"), aliceShared = await create(alice.cookie, "ALICE FAMILY", "family"), bobPrivate = await create(bob.cookie, "BOB PRIVATE");
    expect((await list(a.cookie)).map(n => n.id).sort()).toEqual([ownerPrivate.id, ownerShared.id, aliceShared.id].sort());
    expect((await list(alice.cookie)).map(n => n.id).sort()).toEqual([ownerShared.id, alicePrivate.id, aliceShared.id].sort());
    expect((await list(bob.cookie)).map(n => n.id).sort()).toEqual([ownerShared.id, aliceShared.id, bobPrivate.id].sort());
    expect(await list(foreign.cookie)).toEqual([]);
    const hidden = await notesApi.GET(request(`notes?id=${alicePrivate.id}`, "GET", a.cookie));
    const absent = await notesApi.GET(request("notes?id=nonexistent", "GET", a.cookie));
    expect(hidden.status).toBe(404); expect(absent.status).toBe(404); expect(await hidden.json()).toEqual(await absent.json());
    expect((await notesApi.GET(request(`notes?id=${ownerShared.id}&caseId=${a.caseId}`, "GET", foreign.cookie))).status).toBe(404);
    const chat = await listAccessibleNotes(request("chat", "GET", a.cookie));
    expect(chat.caseId).toBe(a.caseId); expect(chat.memberId).toBe("owner");
    expect(chat.notes.map(n => n.text).join(" ")).not.toMatch(/ALICE PRIVATE|BOB PRIVATE/);
    const exported = await notesApi.GET(request("notes?export=1", "GET", a.cookie));
    expect(exported.status).toBe(200); expect(exported.headers.get("Content-Disposition")).toContain("family-mind-notes.json");
    const bundle = await exported.json();
    expect(bundle.scope).toBe("accessible-to-current-member");
    expect(bundle.notes.map((n: MemberNote) => n.id).sort()).toEqual([ownerPrivate.id, ownerShared.id, aliceShared.id].sort());
    expect(JSON.stringify(bundle)).not.toMatch(/ALICE PRIVATE|BOB PRIVATE/);
    const aliceBundle = await (await notesApi.GET(request("notes?export=1", "GET", alice.cookie))).json();
    expect(JSON.stringify(aliceBundle)).not.toMatch(/OWNER PRIVATE|BOB PRIVATE/);
    expect((await new PrivateCaseStore(root).load(a.caseId))?.notes).toBe("");
  });

  it("permits only an author to edit/delete and rejects forged ownership, IDs and stale revisions", async () => {
    const a = await owner(), alice = await member(a.cookie, "Synthetic A"), bob = await member(a.cookie, "Synthetic B");
    const note = await create(alice.cookie, "Shared draft", "family");
    const body = { id: note.id, expectedRevision: note.revision, text: "Forged edit", visibility: "family" };
    expect((await notesApi.PATCH(request("notes", "PATCH", a.cookie, body))).status).toBe(404);
    expect((await notesApi.PATCH(request("notes", "PATCH", bob.cookie, body))).status).toBe(404);
    expect((await notesApi.POST(request("notes", "POST", alice.cookie, { personId: "synthetic_person", text: "Forged owner", visibility: "private", authorId: "owner" }))).status).toBe(400);
    expect((await notesApi.POST(request("notes", "POST", alice.cookie, { personId: "foreign_person", text: "Wrong person", visibility: "private" }))).status).toBe(404);
    const updated = await notesApi.PATCH(request("notes", "PATCH", alice.cookie, { ...body, text: "Now personal", visibility: "private" }));
    expect(updated.status).toBe(200); expect((await updated.json()).note.revision).toBe(2);
    expect(await list(a.cookie)).toEqual([]);
    expect((await notesApi.PATCH(request("notes", "PATCH", alice.cookie, body))).status).toBe(409);
    expect((await notesApi.DELETE(request("notes", "DELETE", bob.cookie, { id: note.id, expectedRevision: 2 }))).status).toBe(404);
    expect((await notesApi.DELETE(request("notes", "DELETE", alice.cookie, { id: note.id, expectedRevision: 2 }))).status).toBe(200);
    expect(await list(alice.cookie)).toEqual([]);
  });

  it("never grants owner APIs to member capabilities and requires authorization before data reads", async () => {
    const a = await owner(), alice = await member(a.cookie, "Synthetic member");
    expect((await notesApi.GET(request("notes"))).status).toBe(401);
    expect((await membersApi.GET(request("members"))).status).toBe(401);
    await expect(new LocalCaseAccess(root).require(request("case", "GET", alice.cookie))).rejects.toThrow("UNAUTHORIZED");
    expect((await membersApi.POST(request("members", "POST", alice.cookie, { action: "invite", displayName: "Forged invite" }))).status).toBe(401);
    const profile = await membersApi.GET(request("members", "GET", alice.cookie));
    expect(profile.status).toBe(200);
    const value = await profile.json();
    expect(value.principal.memberId).toBe(alice.memberId); expect(value.principal.role).toBe("member");
    expect(value.people).toEqual([{ id: "synthetic_person", name: "Учебный Человек" }]);
    expect(value.sources).toBeUndefined(); expect(value.notes).toBeUndefined();
    expect((await notesApi.GET(request(`notes?id=../../secret`, "GET", alice.cookie))).status).toBe(400);
  });

  it("revokes every subsequent read and write even with a cached principal", async () => {
    const a = await owner(), alice = await member(a.cookie, "Synthetic revoked");
    await create(alice.cookie, "Still private after revocation");
    const access = new MemberSessionAccess(root);
    const oldPrincipal = await access.require(request("notes", "GET", alice.cookie));
    const response = await membersApi.POST(request("members", "POST", a.cookie, { action: "revoke", memberId: alice.memberId }));
    expect(response.status).toBe(200);
    expect((await notesApi.GET(request("notes", "GET", alice.cookie))).status).toBe(401);
    expect((await membersApi.GET(request("members", "GET", alice.cookie))).status).toBe(401);
    expect((await notesApi.GET(request("notes?export=1", "GET", alice.cookie))).status).toBe(401);
    await expect(listAccessibleNotes(request("chat", "GET", alice.cookie))).rejects.toThrow("UNAUTHORIZED");
    await expect(new MemberNotesStore(root).list(oldPrincipal)).rejects.toThrow("UNAUTHORIZED");
    await expect(new MemberNotesStore(root).create(oldPrincipal, { personId: "synthetic_person", text: "Blocked", visibility: "private" }, ["synthetic_person"])).rejects.toThrow("UNAUTHORIZED");
    expect(await list(a.cookie)).toEqual([]);
    const clear = await membersApi.POST(request("members", "POST", alice.cookie, { action: "logout" }));
    expect(clear.status).toBe(200); expect(clear.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("persists original authors and serializes concurrent updates without lost changes", async () => {
    const a = await owner(), alice = await member(a.cookie, "Synthetic author");
    const note = await create(alice.cookie, "Persistent note");
    const access = new MemberSessionAccess(root), principal = await access.require(request("notes", "GET", alice.cookie));
    expect((await new MemberNotesStore(root).get(principal, note.id)).text).toBe("Persistent note");
    const results = await Promise.allSettled([new MemberNotesStore(root).update(principal, note.id, 1, { text: "A", visibility: "private" }), new MemberNotesStore(root).update(principal, note.id, 1, { text: "B", visibility: "private" })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const saved = await new MemberNotesStore(root).get(principal, note.id);
    expect(saved.revision).toBe(2); expect(saved.authorId).toBe(alice.memberId);
    expect((await stat(path.join(root, "member-notes"))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, "member-notes", `${a.caseId}.json`))).mode & 0o777).toBe(0o600);
  });
});

describe("separate local member sessions", () => {
  it("restores owner access after a stale member cookie only through a fresh owner capability", async () => {
    const a = await owner();
    const note = await create(a.cookie, "Synthetic owner-only note");
    const staleCookie = `${a.cookie}; ${MEMBER_COOKIE}=expired`;
    expect((await notesApi.GET(request("notes", "GET", staleCookie))).status).toBe(401);
    const failed = await sessionApi.POST(request("session", "POST", staleCookie, { token: "invalid" }));
    expect(failed.status).toBe(401);
    expect(failed.headers.get("Set-Cookie")).toBeNull();
    const bootstrap = await new LocalCaseAccess(root).createBootstrap(a.caseId);
    const response = await sessionApi.POST(request("session", "POST", staleCookie, { token: bootstrap.token }));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.find(value => value.startsWith(`${MEMBER_COOKIE}=`))).toContain("Max-Age=0");
    const ownerCookie = cookies.find(value => value.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0];
    expect((await list(ownerCookie)).map(value => value.id)).toEqual([note.id]);
    expect((await new MemberSessionAccess(root).require(request("notes", "GET", ownerCookie))).memberId).toBe("owner");
    expect((await sessionApi.POST(request("session", "POST", undefined, { token: bootstrap.token }))).status).toBe(401);
  });

  it("renews an existing member identity without losing personal notes or replaying an old invite", async () => {
    const a = await owner(), alice = await member(a.cookie, "Synthetic returning member");
    const note = await create(alice.cookie, "Personal note survives session renewal");
    await membersApi.POST(request("members", "POST", alice.cookie, { action: "logout" }));
    const first = await membersApi.POST(request("members", "POST", a.cookie, { action: "reinvite", memberId: alice.memberId }));
    const second = await membersApi.POST(request("members", "POST", a.cookie, { action: "reinvite", memberId: alice.memberId }));
    const oldInvite = await first.json(), freshInvite = await second.json();
    const access = new MemberSessionAccess(root);
    await expect(access.exchange(request("members", "POST"), oldInvite.token)).rejects.toThrow("UNAUTHORIZED");
    const session = await access.exchange(request("members", "POST"), freshInvite.token);
    expect(session.memberId).toBe(alice.memberId);
    expect((await list(`${MEMBER_COOKIE}=${session.token}`)).map(n => n.id)).toEqual([note.id]);
    expect(await list(a.cookie)).toEqual([]);
  });

  it("exchanges an invitation once and stores only hashed tokens with an 8-hour expiry", async () => {
    const a = await owner(); const access = new MemberSessionAccess(root);
    const inviteResponse = await membersApi.POST(request("members", "POST", a.cookie, { action: "invite", displayName: "Synthetic invite" }));
    expect(inviteResponse.status).toBe(201);
    const invitation = await inviteResponse.json();
    expect(Date.parse(invitation.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect((await notesApi.GET(request("notes", "GET", `${MEMBER_COOKIE}=${invitation.token}`))).status).toBe(401);
    const results = await Promise.allSettled([access.exchange(request("members", "POST"), invitation.token), access.exchange(request("members", "POST"), invitation.token)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const session = results.find(r => r.status === "fulfilled"); if (session?.status !== "fulfilled") throw new Error("Missing session");
    expect(Date.parse(session.value.expiresAt) - Date.now()).toBeLessThanOrEqual(8 * 60 * 60 * 1000);
    const stored = await readFile(path.join(root, "member-auth", "sessions.json"), "utf8");
    expect(stored).not.toContain(invitation.token); expect(stored).not.toContain(session.value.token);
    expect(memberSessionCookie(session.value.token, session.value.expiresAt)).toContain("HttpOnly; SameSite=Strict; Path=/api/private");
    const disk = JSON.parse(stored); disk.sessions[0].expiresAt = "2000-01-01T00:00:00.000Z";
    await writeFile(path.join(root, "member-auth", "sessions.json"), JSON.stringify(disk));
    await expect(access.require(request("notes", "GET", `${MEMBER_COOKIE}=${session.value.token}`))).rejects.toThrow("UNAUTHORIZED");
  });

  it("blocks CSRF/foreign hosts and malformed duplicate cookies, without falling back to owner", async () => {
    const a = await owner(), alice = await member(a.cookie, "Synthetic member");
    expect((await notesApi.POST(request("notes", "POST", alice.cookie, { personId: "synthetic_person", text: "Blocked", visibility: "family" }, { origin: "https://attacker.invalid" }))).status).toBe(403);
    expect((await notesApi.GET(request("notes", "GET", alice.cookie, undefined, { host: "attacker.invalid:3000" }))).status).toBe(403);
    expect((await notesApi.GET(request("notes", "GET", `${alice.cookie}; ${alice.cookie}`))).status).toBe(401);
    expect((await notesApi.GET(request("notes", "GET", `${a.cookie}; ${MEMBER_COOKIE}=bad`))).status).toBe(401);
    const invite = await new MemberSessionAccess(root).invite(request("members", "POST", a.cookie), "Synthetic switch");
    const exchanged = await membersApi.POST(request("members", "POST", a.cookie, { action: "exchange", token: invite.token }));
    expect(exchanged.status).toBe(200); expect(exchanged.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=;`);
  });
});
