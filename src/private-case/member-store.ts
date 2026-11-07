import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertPrivateId, PrivateCaseError } from "./model";
import { DEFAULT_PRIVATE_ROOT, ensurePrivateDir, ensurePrivateRoot, readPrivateJson, withPrivateLock, writePrivateJson } from "./server-store";
import { canReadNote, memberSchema, noteSchema, parseMemberSpace, type FamilyMember, type MemberNote, type MemberPrincipal, type MemberSpace } from "./member-model";

/** Notes are deliberately separate from owner-only case exports and AI run files. */
export class MemberNotesStore {
  constructor(readonly root = DEFAULT_PRIVATE_ROOT) { if (!path.isAbsolute(root)) throw new PrivateCaseError("UNSAFE_STORAGE_PATH"); }
  private get directory() { return path.join(this.root, "member-notes"); }
  private file(caseId: string) { return path.join(this.directory, `${assertPrivateId(caseId)}.json`); }
  private async prepare() { await ensurePrivateRoot(this.root); await ensurePrivateDir(this.directory); }
  private async read(caseId: string): Promise<MemberSpace> {
    await this.prepare();
    const raw = await readPrivateJson(this.file(caseId));
    const value = raw === null ? { schemaVersion: 1, caseId, members: [{ id: "owner", displayName: "Владелец дела", role: "owner", active: true, createdAt: new Date().toISOString() }], notes: [] } : raw;
    const space = parseMemberSpace(value);
    if (space.caseId !== caseId) throw new PrivateCaseError("NOTES_STORAGE_CORRUPT");
    return space;
  }
  private requireMember(space: MemberSpace, principal: MemberPrincipal): FamilyMember {
    const member = space.members.find(m => m.id === principal.memberId && m.active && m.role === principal.role);
    if (!member || space.caseId !== principal.caseId) throw new PrivateCaseError("UNAUTHORIZED");
    return member;
  }
  async account(principal: MemberPrincipal) {
    const space = await this.read(principal.caseId);
    const member = this.requireMember(space, principal);
    return { member, members: space.members.filter(m => principal.role === "owner" || m.active) };
  }
  async activeMember(caseId: string, memberId: string): Promise<FamilyMember> {
    const member = (await this.read(caseId)).members.find(m => m.id === memberId && m.active && m.role === "member");
    if (!member) throw new PrivateCaseError("UNAUTHORIZED");
    return member;
  }
  async addMember(owner: MemberPrincipal, displayName: string): Promise<FamilyMember> {
    if (owner.role !== "owner") throw new PrivateCaseError("MEMBER_FORBIDDEN");
    await this.prepare();
    return withPrivateLock(this.directory, owner.caseId, async () => {
      const space = await this.read(owner.caseId); this.requireMember(space, owner);
      if (space.members.length >= 50) throw new PrivateCaseError("MEMBER_LIMIT");
      const member = memberSchema.safeParse({ id: `member_${randomUUID()}`, displayName, role: "member", active: true, createdAt: new Date().toISOString() });
      if (!member.success) throw new PrivateCaseError("INVALID_MEMBER");
      space.members.push(member.data);
      await writePrivateJson(this.file(owner.caseId), parseMemberSpace(space));
      return member.data;
    });
  }
  async revokeMember(owner: MemberPrincipal, memberId: string): Promise<void> {
    if (owner.role !== "owner" || memberId === "owner") throw new PrivateCaseError("MEMBER_FORBIDDEN");
    assertPrivateId(memberId); await this.prepare();
    await withPrivateLock(this.directory, owner.caseId, async () => {
      const space = await this.read(owner.caseId); this.requireMember(space, owner);
      const member = space.members.find(m => m.id === memberId && m.role === "member");
      if (!member) throw new PrivateCaseError("MEMBER_NOT_FOUND");
      member.active = false;
      await writePrivateJson(this.file(owner.caseId), parseMemberSpace(space));
    });
  }
  async list(principal: MemberPrincipal, personId?: string): Promise<MemberNote[]> {
    if (personId) assertPrivateId(personId);
    const space = await this.read(principal.caseId); this.requireMember(space, principal);
    return space.notes.filter(n => canReadNote(n, principal) && (!personId || n.personId === personId));
  }
  async get(principal: MemberPrincipal, id: string): Promise<MemberNote> {
    assertPrivateId(id);
    const note = (await this.list(principal)).find(n => n.id === id);
    if (!note) throw new PrivateCaseError("NOTE_NOT_FOUND");
    return note;
  }
  async create(principal: MemberPrincipal, input: Pick<MemberNote, "personId" | "visibility" | "text">, allowedPersonIds: string[]): Promise<MemberNote> {
    if (!allowedPersonIds.includes(input.personId)) throw new PrivateCaseError("PERSON_NOT_FOUND");
    await this.prepare();
    return withPrivateLock(this.directory, principal.caseId, async () => {
      const space = await this.read(principal.caseId); this.requireMember(space, principal);
      if (space.notes.length >= 1000) throw new PrivateCaseError("NOTE_LIMIT");
      const now = new Date().toISOString();
      const parsed = noteSchema.safeParse({ ...input, id: `note_${randomUUID()}`, caseId: principal.caseId, authorId: principal.memberId, revision: 1, createdAt: now, updatedAt: now });
      if (!parsed.success) throw new PrivateCaseError("INVALID_NOTE");
      space.notes.push(parsed.data);
      await writePrivateJson(this.file(principal.caseId), parseMemberSpace(space));
      return parsed.data;
    });
  }
  async update(principal: MemberPrincipal, id: string, expectedRevision: number, changes: Pick<MemberNote, "text" | "visibility">): Promise<MemberNote> {
    assertPrivateId(id); await this.prepare();
    return withPrivateLock(this.directory, principal.caseId, async () => {
      const space = await this.read(principal.caseId); this.requireMember(space, principal);
      const current = space.notes.find(n => n.id === id && n.authorId === principal.memberId);
      // Same response for nonexistent notes, foreign-family IDs and another author's notes.
      if (!current) throw new PrivateCaseError("NOTE_NOT_FOUND");
      if (current.revision !== expectedRevision) throw new PrivateCaseError("STALE_REVISION");
      const parsed = noteSchema.safeParse({ ...current, text: changes.text, visibility: changes.visibility, revision: current.revision + 1, updatedAt: new Date().toISOString() });
      if (!parsed.success) throw new PrivateCaseError("INVALID_NOTE");
      space.notes = space.notes.map(n => n.id === id ? parsed.data : n);
      await writePrivateJson(this.file(principal.caseId), parseMemberSpace(space));
      return parsed.data;
    });
  }
  async remove(principal: MemberPrincipal, id: string, expectedRevision: number): Promise<void> {
    assertPrivateId(id); await this.prepare();
    await withPrivateLock(this.directory, principal.caseId, async () => {
      const space = await this.read(principal.caseId); this.requireMember(space, principal);
      const note = space.notes.find(n => n.id === id && n.authorId === principal.memberId);
      if (!note) throw new PrivateCaseError("NOTE_NOT_FOUND");
      if (note.revision !== expectedRevision) throw new PrivateCaseError("STALE_REVISION");
      space.notes = space.notes.filter(n => n.id !== id);
      await writePrivateJson(this.file(principal.caseId), parseMemberSpace(space));
    });
  }
}
