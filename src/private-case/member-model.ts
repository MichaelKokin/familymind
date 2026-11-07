import { z } from "zod";
import { privateId, PrivateCaseError } from "./model";

export const memberSchema = z.object({
  id: privateId, displayName: z.string().trim().min(1).max(120),
  role: z.enum(["owner", "member"]), active: z.boolean(), createdAt: z.iso.datetime(),
}).strict();
export const noteSchema = z.object({
  id: privateId, caseId: privateId, personId: privateId, authorId: privateId,
  visibility: z.enum(["private", "family"]), text: z.string().trim().min(1).max(10000),
  revision: z.number().int().positive(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export const memberSpaceSchema = z.object({
  schemaVersion: z.literal(1), caseId: privateId,
  members: z.array(memberSchema).max(50), notes: z.array(noteSchema).max(1000),
}).strict();
export type FamilyMember = z.infer<typeof memberSchema>;
export type MemberNote = z.infer<typeof noteSchema>;
export type MemberSpace = z.infer<typeof memberSpaceSchema>;
export type MemberPrincipal = { caseId: string; memberId: string; role: "owner" | "member"; sessionId: string };
export type MemberPerson = { id: string; name: string };
export type MemberAccount = { principal: MemberPrincipal; member: FamilyMember; members: FamilyMember[]; people: MemberPerson[] };

export function parseMemberSpace(input: unknown): MemberSpace {
  const parsed = memberSpaceSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("NOTES_STORAGE_CORRUPT");
  const space = parsed.data;
  if (new Set(space.members.map(m => m.id)).size !== space.members.length || new Set(space.notes.map(n => n.id)).size !== space.notes.length || space.members.filter(m => m.role === "owner" && m.id === "owner" && m.active).length !== 1 || space.members.some(m => m.role === "owner" && m.id !== "owner")) throw new PrivateCaseError("NOTES_STORAGE_CORRUPT");
  if (space.notes.some(n => n.caseId !== space.caseId || !space.members.some(m => m.id === n.authorId))) throw new PrivateCaseError("NOTES_STORAGE_CORRUPT");
  return space;
}

export function canReadNote(note: MemberNote, principal: MemberPrincipal): boolean {
  return note.caseId === principal.caseId && (note.authorId === principal.memberId || note.visibility === "family");
}
