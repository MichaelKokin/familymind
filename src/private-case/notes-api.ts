import { z } from "zod";
import { privateId, PrivateCaseError } from "./model";
import { memberRuntime, memberFailure, peopleForMember } from "./notes-runtime";
import { boundedJson, privateJson } from "./runtime";

const content = { visibility: z.enum(["private", "family"]), text: z.string().trim().min(1).max(10000) };
const createSchema = z.object({ personId: privateId, ...content }).strict();
const updateSchema = z.object({ id: privateId, expectedRevision: z.number().int().positive(), ...content }).strict();
const deleteSchema = z.object({ id: privateId, expectedRevision: z.number().int().positive() }).strict();

async function context(request: Request) {
  const runtime = memberRuntime();
  const principal = await runtime.access.require(request);
  if (!await runtime.store.load(principal.caseId)) throw new PrivateCaseError("CASE_NOT_FOUND");
  return { ...runtime, principal };
}
export async function GET(request: Request) {
  try {
    const { notes, principal, store } = await context(request);
    const query = new URL(request.url).searchParams;
    const id = query.get("id");
    if (id) return privateJson({ note: await notes.get(principal, id) });
    const visibleNotes = await notes.list(principal, query.get("personId") || undefined);
    if (query.get("export") === "1") {
      const [people, account] = await Promise.all([peopleForMember(store.root, principal, store), notes.account(principal)]);
      // Reauthorize after export metadata reads: a revoked member cannot finish a new export.
      const fresh = await memberRuntime().access.require(request);
      if (fresh.caseId !== principal.caseId || fresh.memberId !== principal.memberId) throw new PrivateCaseError("UNAUTHORIZED");
      const currentNotes = await notes.list(fresh, query.get("personId") || undefined);
      return privateJson({ format: "family-mind-notes", schemaVersion: 1, exportedAt: new Date().toISOString(), caseId: principal.caseId, memberId: principal.memberId, scope: "accessible-to-current-member", notes: currentNotes, people: people.filter(p => currentNotes.some(n => n.personId === p.id)), authors: account.members.filter(m => currentNotes.some(n => n.authorId === m.id)).map(m => ({ id: m.id, displayName: m.displayName })) }, 200, { "Content-Disposition": 'attachment; filename="family-mind-notes.json"' });
    }
    return privateJson({ notes: visibleNotes, memberId: principal.memberId, caseId: principal.caseId });
  } catch (error) { return memberFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { notes, principal, store } = await context(request);
    const parsed = createSchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new PrivateCaseError("INVALID_NOTE");
    const people = await peopleForMember(store.root, principal, store);
    return privateJson({ note: await notes.create(principal, parsed.data, people.map(p => p.id)) }, 201);
  } catch (error) { return memberFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { notes, principal } = await context(request);
    const parsed = updateSchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new PrivateCaseError("INVALID_NOTE");
    const { id, expectedRevision, ...changes } = parsed.data;
    return privateJson({ note: await notes.update(principal, id, expectedRevision, changes) });
  } catch (error) { return memberFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const { notes, principal } = await context(request);
    const parsed = deleteSchema.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) throw new PrivateCaseError("INVALID_NOTE");
    await notes.remove(principal, parsed.data.id, parsed.data.expectedRevision);
    return privateJson({ ok: true });
  } catch (error) { return memberFailure(error); }
}
