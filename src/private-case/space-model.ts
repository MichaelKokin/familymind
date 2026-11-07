import { z } from "zod";
import { privateId, PrivateCaseError } from "./model";

/** Editable private space: owner-added people, materials and the canvas layout.
 * The operator research snapshot stays a separate immutable original; this
 * model only references its person IDs and never copies its photos or text. */
export const SPACE_SCHEMA_VERSION = 1;
export const SPACE_EXPORT_FORMAT = "family-mind-space";
export const MAX_MATERIAL_BYTES = 5 * 1024 * 1024;
export const MAX_MATERIAL_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_SPACE_PEOPLE = 500;
export const MAX_SPACE_RELATIONSHIPS = 1000;
export const MAX_SPACE_MATERIALS = 500;
export const MAX_SPACE_LEADS = 500;
export const MAX_SPACE_FINDS = 1000;
export const MAX_LAYOUT_NODES = 3000;
export const MAX_JOURNAL_ENTRIES = 5000;
export const MAX_GUIDE_DISMISSED = 300;

const brief = z.string().trim().min(1).max(300);
const short = z.string().max(1000);
const text = z.string().max(20000);
const timestamp = z.iso.datetime();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const nodeIdSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:-]+$/);
export const materialMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);
export const livingStatusSchema = z.enum(["living", "deceased", "unknown"]);
export const relationKindSchema = z.enum(["parent_child", "partner", "other"]);
export const parentRoleSchema = z.enum(["father", "mother", "parent"]);
export const materialKindSchema = z.enum(["photo", "document", "note", "link"]);
export const safeUrlSchema = z.string().max(3000).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
});
export const safeFileNameSchema = z.string().min(1).max(300).refine((name) => !/[\\/\u0000-\u001f]/.test(name) && name !== "." && name !== "..");
const audit = { createdAt: timestamp, updatedAt: timestamp, removedAt: timestamp.nullable() };

export const personInputSchema = z.object({ name: brief, dateText: short, livingStatus: livingStatusSchema, notes: text }).strict();
export const personPatchSchema = personInputSchema.partial();
export const spacePersonSchema = z.object({ id: privateId, ...personInputSchema.shape, ...audit }).strict();

export const relationshipInputSchema = z.object({ kind: relationKindSchema, parentRole: parentRoleSchema.optional(), label: z.string().trim().max(300), rationale: z.string().trim().max(5000) }).strict();
export const relationshipPatchSchema = relationshipInputSchema.partial();
export const spaceRelationshipSchema = z.object({ id: privateId, from: privateId, to: privateId, ...relationshipInputSchema.shape, evidenceStatus: z.enum(["hypothesis", "unresolved"]), origin: z.literal("owner_statement"), ...audit }).strict()
  .refine((value) => value.from !== value.to)
  .refine((value) => (value.kind === "parent_child") === Boolean(value.parentRole));

export const materialOriginalSchema = z.object({ name: safeFileNameSchema, mime: materialMimeSchema, size: z.number().int().min(1).max(MAX_MATERIAL_BYTES), sha256: hex64 }).strict();
export const materialInputSchema = z.object({ kind: materialKindSchema, title: brief, text, url: safeUrlSchema, provenance: z.string().trim().max(5000), dateText: short, personIds: z.array(privateId).max(50).refine(unique) }).strict();
export const materialPatchSchema = materialInputSchema.omit({ kind: true }).partial();
export const materialOriginSchema = z.enum(["owner", "external_find"]);
export const spaceMaterialSchema = z.object({ id: privateId, ...materialInputSchema.shape, original: materialOriginalSchema.nullable(), origin: materialOriginSchema.default("owner"), findId: privateId.nullable().default(null), ...audit }).strict()
  .refine((material) => (material.origin === "external_find") === (material.findId !== null))
  .refine((material) => material.kind !== "link" || material.url.length > 0)
  .refine((material) => material.kind !== "note" || material.text.trim().length > 0)
  .refine((material) => (material.kind !== "note" && material.kind !== "link") || material.original === null)
  .refine((material) => material.kind !== "photo" || material.original === null || material.original.mime.startsWith("image/"));

/** A lead is one research question the owner formulates from a card. In this
 * delivery every search is performed manually by an operator outside the app;
 * the application records the question, what was checked and the outcome. */
export const leadStatusSchema = z.enum(["open", "needs_detail", "candidate", "nothing_found", "done", "cancelled"]);
export const leadInputSchema = z.object({ personId: privateId.nullable(), question: brief, placeText: short, periodText: short }).strict();
export const leadPatchSchema = z.object({ question: brief, placeText: short, periodText: short, coverage: text, missingDetail: short, nextQuestion: short }).partial().strict();
export const spaceLeadSchema = z.object({ id: privateId, ...leadInputSchema.shape, mode: z.literal("manual"), status: leadStatusSchema, coverage: text, missingDetail: short, nextQuestion: short, ...audit }).strict();
/** A find is a candidate match for a lead: a real source, who it may concern and
 * why. The owner decides; acceptance places a material and never proves kinship. */
export const findStatusSchema = z.enum(["candidate", "accepted", "contested", "rejected"]);
export const findNoveltySchema = z.enum(["new", "known"]);
export const findSourceSchema = z.object({ title: brief, url: safeUrlSchema, locator: short, excerpt: text, kind: short, dateText: short }).strict();
export const findInputSchema = z.object({ leadId: privateId.nullable(), personIds: z.array(privateId).max(50).refine(unique), title: brief, source: findSourceSchema, why: z.string().trim().min(1).max(5000), novelty: findNoveltySchema }).strict();
export const spaceFindSchema = z.object({ id: privateId, ...findInputSchema.shape, performedBy: z.literal("operator_manual"), status: findStatusSchema, decisionReason: text, decidedAt: timestamp.nullable(), materialId: privateId.nullable(), ...audit }).strict()
  .refine((find) => (find.status === "candidate") === (find.decidedAt === null))
  .refine((find) => (find.status === "accepted") === (find.materialId !== null))
  .refine((find) => find.status === "candidate" || find.decisionReason.trim().length > 0)
  .refine((find) => Boolean(find.source.url || find.source.locator || find.source.excerpt));

export const positionSchema = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();
export const spaceLayoutSchema = z.object({ positions: z.record(nodeIdSchema, positionSchema).refine((positions) => Object.keys(positions).length <= MAX_LAYOUT_NODES) }).strict();
export const journalActionSchema = z.enum(["migrated", "set_owner", "add_person", "update_person", "remove_person", "restore_person", "add_relationship", "update_relationship", "remove_relationship", "restore_relationship", "add_material", "update_material", "remove_material", "restore_material", "attach_original", "add_lead", "update_lead", "add_find", "decide_find", "reset_layout", "import"]);
export const journalEntrySchema = z.object({ id: privateId, at: timestamp, action: journalActionSchema, targetId: z.string().max(200), detail: z.string().max(1000) }).strict();
export const spaceBaseSchema = z.object({ kind: z.enum(["research-snapshot", "none"]), snapshotDigest: hex64.nullable(), migratedAt: timestamp }).strict()
  .refine((base) => (base.kind === "research-snapshot") === (base.snapshotDigest !== null));

export const privateSpaceSchema = z.object({
  schemaVersion: z.literal(SPACE_SCHEMA_VERSION),
  caseId: privateId,
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  base: spaceBaseSchema,
  ownerPersonId: privateId.nullable(),
  people: z.array(spacePersonSchema).max(MAX_SPACE_PEOPLE),
  relationships: z.array(spaceRelationshipSchema).max(MAX_SPACE_RELATIONSHIPS),
  materials: z.array(spaceMaterialSchema).max(MAX_SPACE_MATERIALS),
  leads: z.array(spaceLeadSchema).max(MAX_SPACE_LEADS).default([]),
  finds: z.array(spaceFindSchema).max(MAX_SPACE_FINDS).default([]),
  layout: spaceLayoutSchema,
  guide: z.object({ dismissed: z.array(z.string().min(1).max(160)).max(MAX_GUIDE_DISMISSED) }).strict(),
  journal: z.array(journalEntrySchema).max(MAX_JOURNAL_ENTRIES),
}).strict();

export type PrivateSpace = z.infer<typeof privateSpaceSchema>;
export type SpacePerson = z.infer<typeof spacePersonSchema>;
export type SpaceRelationship = z.infer<typeof spaceRelationshipSchema>;
export type SpaceMaterial = z.infer<typeof spaceMaterialSchema>;
export type MaterialOriginal = z.infer<typeof materialOriginalSchema>;
export type SpaceLead = z.infer<typeof spaceLeadSchema>;
export type SpaceFind = z.infer<typeof spaceFindSchema>;
export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type FindStatus = z.infer<typeof findStatusSchema>;
export type FindNovelty = z.infer<typeof findNoveltySchema>;
export type LeadInput = z.infer<typeof leadInputSchema>;
export type FindInput = z.infer<typeof findInputSchema>;
export type MaterialOrigin = z.infer<typeof materialOriginSchema>;
export type SpaceJournalEntry = z.infer<typeof journalEntrySchema>;
export type MaterialMime = z.infer<typeof materialMimeSchema>;
export type MaterialKind = z.infer<typeof materialKindSchema>;
export type RelationKind = z.infer<typeof relationKindSchema>;
export type LivingStatus = z.infer<typeof livingStatusSchema>;
export type ParentRole = z.infer<typeof parentRoleSchema>;
export type PersonInput = z.infer<typeof personInputSchema>;
export type MaterialInput = z.infer<typeof materialInputSchema>;
export type RelationshipInput = z.infer<typeof relationshipInputSchema>;
export type SpacePositions = PrivateSpace["layout"]["positions"];

export function totalMaterialBytes(space: Pick<PrivateSpace, "materials">): number {
  return space.materials.reduce((sum, material) => sum + (material.original?.size ?? 0), 0);
}

export function parsePrivateSpace(input: unknown): PrivateSpace {
  const parsed = privateSpaceSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("INVALID_SPACE");
  const space = parsed.data;
  const ids = [...space.people, ...space.relationships, ...space.materials, ...space.leads, ...space.finds, ...space.journal].map((item) => item.id);
  if (!unique(ids)) throw new PrivateCaseError("DUPLICATE_ID");
  const leadIds = new Set(space.leads.map((lead) => lead.id));
  const findIds = new Set(space.finds.map((find) => find.id));
  const materialIds = new Set(space.materials.map((material) => material.id));
  for (const find of space.finds) {
    if (find.leadId && !leadIds.has(find.leadId)) throw new PrivateCaseError("INVALID_SPACE");
    if (find.materialId && !materialIds.has(find.materialId)) throw new PrivateCaseError("INVALID_SPACE");
  }
  for (const material of space.materials) if (material.findId && !findIds.has(material.findId)) throw new PrivateCaseError("INVALID_SPACE");
  if (space.ownerPersonId && !space.people.some((person) => person.id === space.ownerPersonId && !person.removedAt)) throw new PrivateCaseError("INVALID_SPACE");
  if (totalMaterialBytes(space) > MAX_MATERIAL_TOTAL_BYTES) throw new PrivateCaseError("MATERIALS_TOO_LARGE");
  return space;
}

/** People a new statement may reference: snapshot people plus owner-added people that are not removed. */
export function availablePeople(space: Pick<PrivateSpace, "people">, snapshotPeopleIds: ReadonlySet<string>): Set<string> {
  const ids = new Set(snapshotPeopleIds);
  for (const person of space.people) if (!person.removedAt) ids.add(person.id);
  return ids;
}

/** People an existing record may still reference, including removed owner-added people. */
export function knownPeople(space: Pick<PrivateSpace, "people">, snapshotPeopleIds: ReadonlySet<string>): Set<string> {
  const ids = new Set(snapshotPeopleIds);
  for (const person of space.people) ids.add(person.id);
  return ids;
}

export function danglingSpaceReferences(space: PrivateSpace, snapshotPeopleIds: ReadonlySet<string>): { relationships: string[]; materials: string[]; leads: string[]; finds: string[] } {
  const ids = knownPeople(space, snapshotPeopleIds);
  return {
    relationships: space.relationships.filter((relationship) => !relationship.removedAt && (!ids.has(relationship.from) || !ids.has(relationship.to))).map((relationship) => relationship.id),
    materials: space.materials.filter((material) => !material.removedAt && material.personIds.some((id) => !ids.has(id))).map((material) => material.id),
    leads: space.leads.filter((lead) => !lead.removedAt && lead.personId !== null && !ids.has(lead.personId)).map((lead) => lead.id),
    finds: space.finds.filter((find) => !find.removedAt && find.personIds.some((id) => !ids.has(id))).map((find) => find.id),
  };
}

export function validateSpaceReferences(space: PrivateSpace, snapshotPeopleIds: ReadonlySet<string>): void {
  const dangling = danglingSpaceReferences(space, snapshotPeopleIds);
  if (dangling.relationships.length || dangling.materials.length || dangling.leads.length || dangling.finds.length) throw new PrivateCaseError("PERSON_NOT_FOUND");
}
