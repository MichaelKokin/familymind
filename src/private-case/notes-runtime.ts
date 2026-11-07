import { PrivateCaseError } from "./model";
import { MemberSessionAccess } from "./member-access";
import { MemberNotesStore } from "./member-store";
import { readResearch } from "./research-server";
import { PrivateCaseStore } from "./server-store";
import { privateFailure, privateJson, privateRuntime } from "./runtime";
import type { MemberPerson, MemberPrincipal } from "./member-model";

export function memberRuntime() {
  const { store, access } = privateRuntime();
  return { store, access: new MemberSessionAccess(store.root, access.origin), notes: new MemberNotesStore(store.root) };
}

export async function peopleForMember(root: string, principal: MemberPrincipal, store = new PrivateCaseStore(root)): Promise<MemberPerson[]> {
  const value = await store.load(principal.caseId);
  if (!value) throw new PrivateCaseError("CASE_NOT_FOUND");
  let people: MemberPerson[] = [{ id: value.subject.personId, name: value.subject.name }];
  try {
    const research = await readResearch(root, principal.caseId);
    const ordered = [...research.people].sort((a, b) => Number(b.id === research.owner.personId) - Number(a.id === research.owner.personId));
    const byId = new Map(ordered.map(p => [p.id, { id: p.id, name: p.name }]));
    if (!byId.has(value.subject.personId)) byId.set(value.subject.personId, people[0]);
    people = [...byId.values()];
  } catch (error) {
    // Optional generated snapshot may not exist; corrupt existing snapshots fail closed.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return people;
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
