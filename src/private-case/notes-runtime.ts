import { PrivateCaseError } from "./model";
import { MemberSessionAccess } from "./member-access";
import { MemberNotesStore } from "./member-store";
import { readResearch } from "./research-server";
import { PrivateCaseStore } from "./server-store";
import { PrivateSpaceStore } from "./space-store";
import { privateFailure, privateJson, privateRuntime } from "./runtime";
import type { MemberPerson, MemberPrincipal } from "./member-model";

export function memberRuntime() {
  const { store, access } = privateRuntime();
  return { store, access: new MemberSessionAccess(store.root, access.origin), notes: new MemberNotesStore(store.root) };
}

/** People a note may be about: the case subject, the research snapshot and owner-added people that are not removed. */
export async function peopleForMember(root: string, principal: MemberPrincipal, store = new PrivateCaseStore(root)): Promise<MemberPerson[]> {
  const value = await store.load(principal.caseId);
  if (!value) throw new PrivateCaseError("CASE_NOT_FOUND");
  const byId = new Map<string, MemberPerson>();
  try {
    const research = await readResearch(root, principal.caseId);
    const ordered = [...research.people].sort((a, b) => Number(b.id === research.owner.personId) - Number(a.id === research.owner.personId));
    for (const person of ordered) byId.set(person.id, { id: person.id, name: person.name });
  } catch (error) {
    // Optional generated snapshot may not exist; corrupt existing snapshots fail closed.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (!byId.has(value.subject.personId)) byId.set(value.subject.personId, { id: value.subject.personId, name: value.subject.name });
  const space = await new PrivateSpaceStore(root).load(principal.caseId);
  for (const person of space?.people ?? []) if (!person.removedAt && !byId.has(person.id)) byId.set(person.id, { id: person.id, name: person.name });
  return [...byId.values()];
}

export async function listAccessibleNotes(request: Request) {
  const { access, notes, store } = memberRuntime();
  const principal = await access.require(request);
  if (!await store.load(principal.caseId)) throw new PrivateCaseError("CASE_NOT_FOUND");
  return { caseId: principal.caseId, memberId: principal.memberId, notes: await notes.list(principal) };
}

export function memberFailure(error: unknown) {
  if (error instanceof PrivateCaseError && ["NOTE_NOT_FOUND", "MEMBER_NOT_FOUND", "PERSON_NOT_FOUND"].includes(error.code)) return privateJson({ error: error.code }, 404);
  return privateFailure(error);
}
