import { z } from "zod";
import { privateId, PrivateCaseError } from "./model";
import {
  MAX_GUIDE_DISMISSED,
  MAX_JOURNAL_ENTRIES,
  MAX_LAYOUT_NODES,
  MAX_MATERIAL_TOTAL_BYTES,
  availablePeople,
  findInputSchema,
  leadInputSchema,
  leadPatchSchema,
  leadStatusSchema,
  materialPatchSchema,
  nodeIdSchema,
  parentRoleSchema,
  parsePrivateSpace,
  personInputSchema,
  personPatchSchema,
  positionSchema,
  relationshipInputSchema,
  relationshipPatchSchema,
  spaceFindSchema,
  spaceMaterialSchema,
  spaceRelationshipSchema,
  totalMaterialBytes,
  type MaterialInput,
  type MaterialOriginal,
  type PrivateSpace,
  type RelationKind,
  type SpaceJournalEntry,
  type SpaceLead,
  type SpaceMaterial,
  type SpacePerson,
  type SpaceRelationship,
} from "./space-model";

const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** Pure reducer shared by the server, tests and (for previews) the client.
 * Every mutation is explicit; nothing is inferred from names, positions or order. */
const relationStatement = z.object({
  anchorPersonId: privateId,
  newPersonIs: z.enum(["parent", "child", "partner", "other"]),
  parentRole: parentRoleSchema.optional(),
  label: z.string().trim().max(300).default(""),
  rationale: z.string().trim().max(5000).default(""),
}).strict();

export const spaceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_person"), person: personInputSchema, asOwner: z.boolean().default(false), relation: relationStatement.optional() }).strict(),
  z.object({ action: z.literal("update_person"), id: privateId, person: personPatchSchema }).strict(),
  z.object({ action: z.literal("remove_person"), id: privateId }).strict(),
  z.object({ action: z.literal("restore_person"), id: privateId }).strict(),
  z.object({ action: z.literal("add_relationship"), from: privateId, to: privateId, relation: relationshipInputSchema }).strict(),
  z.object({ action: z.literal("update_relationship"), id: privateId, relation: relationshipPatchSchema }).strict(),
  z.object({ action: z.literal("remove_relationship"), id: privateId }).strict(),
  z.object({ action: z.literal("restore_relationship"), id: privateId }).strict(),
  z.object({ action: z.literal("update_material"), id: privateId, material: materialPatchSchema }).strict(),
  z.object({ action: z.literal("remove_material"), id: privateId }).strict(),
  z.object({ action: z.literal("restore_material"), id: privateId }).strict(),
  z.object({ action: z.literal("add_lead"), lead: leadInputSchema }).strict(),
  z.object({ action: z.literal("update_lead"), id: privateId, lead: leadPatchSchema.default({}), status: leadStatusSchema.optional() }).strict(),
  z.object({ action: z.literal("add_find"), find: findInputSchema }).strict(),
  z.object({ action: z.literal("decide_find"), id: privateId, decision: z.enum(["accepted", "contested", "rejected"]), reason: z.string().trim().min(1).max(5000), personIds: z.array(privateId).max(50).refine(unique).optional(), nextQuestion: z.string().trim().max(1000).default("") }).strict(),
  z.object({ action: z.literal("layout"), positions: z.record(nodeIdSchema, positionSchema).refine((positions) => Object.keys(positions).length > 0 && Object.keys(positions).length <= 500) }).strict(),
  z.object({ action: z.literal("reset_layout"), nodeIds: z.array(nodeIdSchema).min(1).max(500) }).strict(),
  z.object({ action: z.literal("guide_dismiss"), key: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("guide_reset") }).strict(),
]);
export type SpaceAction = z.infer<typeof spaceActionSchema>;
export type AddMaterialAction = { action: "add_material"; material: MaterialInput; original: MaterialOriginal | null };
export type AttachOriginalAction = { action: "attach_original"; id: string; original: MaterialOriginal };
export type SpaceIdPrefix = "person" | "relationship" | "material" | "lead" | "find" | "journal";
export type SpaceContext = {
  now: string;
  snapshotPeopleIds: ReadonlySet<string>;
  snapshotOwnerId: string | null;
  snapshotRelationships: ReadonlyArray<{ from: string; to: string; kind: string | undefined }>;
  newId: (prefix: SpaceIdPrefix) => string;
};
export type SpaceMutation = { space: PrivateSpace; created: { personId?: string; relationshipId?: string; materialId?: string; leadId?: string; findId?: string } };

export function initialSpace(caseId: string, snapshotDigest: string | null, now: string): PrivateSpace {
  return parsePrivateSpace({
    schemaVersion: 1,
    caseId,
    revision: 0,
    updatedAt: now,
    base: { kind: snapshotDigest ? "research-snapshot" : "none", snapshotDigest, migratedAt: now },
    ownerPersonId: null,
    people: [],
    relationships: [],
    materials: [],
    leads: [],
    finds: [],
    layout: { positions: {} },
    guide: { dismissed: [] },
    journal: [],
  });
}

function entry(context: SpaceContext, action: SpaceJournalEntry["action"], targetId: string, detail: string): SpaceJournalEntry {
  return { id: context.newId("journal"), at: context.now, action, targetId: targetId.slice(0, 200), detail: detail.slice(0, 1000) };
}

function requireAvailable(space: PrivateSpace, context: SpaceContext, personId: string): void {
  if (!availablePeople(space, context.snapshotPeopleIds).has(personId)) throw new PrivateCaseError("PERSON_NOT_FOUND");
}

function ownPerson(space: PrivateSpace, context: SpaceContext, id: string): SpacePerson {
  if (context.snapshotPeopleIds.has(id)) throw new PrivateCaseError("SNAPSHOT_READ_ONLY");
  const person = space.people.find((item) => item.id === id);
  if (!person) throw new PrivateCaseError("PERSON_NOT_FOUND");
  return person;
}

function ownRelationship(space: PrivateSpace, id: string): SpaceRelationship {
  const relationship = space.relationships.find((item) => item.id === id);
  if (!relationship) throw new PrivateCaseError("RELATIONSHIP_NOT_FOUND");
  return relationship;
}

function ownLead(space: PrivateSpace, id: string): SpaceLead {
  const lead = space.leads.find((item) => item.id === id);
  if (!lead) throw new PrivateCaseError("LEAD_NOT_FOUND");
  return lead;
}

function ownMaterial(space: PrivateSpace, id: string): SpaceMaterial {
  const material = space.materials.find((item) => item.id === id);
  if (!material) throw new PrivateCaseError("MATERIAL_NOT_FOUND");
  return material;
}

function buildRelationship(space: PrivateSpace, context: SpaceContext, from: string, to: string, input: { kind: RelationKind; parentRole?: SpaceRelationship["parentRole"]; label: string; rationale: string }): SpaceRelationship {
  if (from === to) throw new PrivateCaseError("SELF_RELATIONSHIP");
  requireAvailable(space, context, from);
  requireAvailable(space, context, to);
  const kind = input.kind;
  const parentRole = kind === "parent_child" ? (input.parentRole ?? "parent") : undefined;
  const label = input.label.trim();
  if (kind === "other" && !label) throw new PrivateCaseError("LABEL_REQUIRED");
  const duplicate = (candidate: { from: string; to: string; kind: string | undefined }) =>
    candidate.kind === kind && ((candidate.from === from && candidate.to === to) || (kind !== "parent_child" && candidate.from === to && candidate.to === from));
  if (space.relationships.some((item) => !item.removedAt && duplicate(item)) || context.snapshotRelationships.some(duplicate)) throw new PrivateCaseError("DUPLICATE_RELATIONSHIP");
  const parsed = spaceRelationshipSchema.safeParse({
    id: context.newId("relationship"),
    from,
    to,
    kind,
    ...(parentRole ? { parentRole } : {}),
    label,
    rationale: input.rationale.trim(),
    evidenceStatus: "hypothesis",
    origin: "owner_statement",
    createdAt: context.now,
    updatedAt: context.now,
    removedAt: null,
  });
  if (!parsed.success) throw new PrivateCaseError("INVALID_RELATIONSHIP");
  return parsed.data;
}

function replaceById<T extends { id: string }>(items: T[], next: T): T[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

export function applySpaceAction(input: PrivateSpace, action: SpaceAction | AddMaterialAction | AttachOriginalAction, context: SpaceContext): SpaceMutation {
  let space = input;
  const entries: SpaceJournalEntry[] = [];
  const created: SpaceMutation["created"] = {};
  if (space.revision === 0 && space.journal.length === 0) entries.push(entry(context, "migrated", space.base.snapshotDigest ?? "", space.base.kind));
  switch (action.action) {
    case "add_person": {
      const person: SpacePerson = { id: context.newId("person"), ...action.person, name: action.person.name.trim(), createdAt: context.now, updatedAt: context.now, removedAt: null };
      let ownerPersonId = space.ownerPersonId;
      if (action.asOwner) {
        if (context.snapshotOwnerId || ownerPersonId) throw new PrivateCaseError("OWNER_ALREADY_SET");
        ownerPersonId = person.id;
      }
      space = { ...space, people: [...space.people, person], ownerPersonId };
      entries.push(entry(context, "add_person", person.id, ""));
      if (action.asOwner) entries.push(entry(context, "set_owner", person.id, ""));
      if (action.relation) {
        const statement = action.relation;
        const [from, to] = statement.newPersonIs === "parent" ? [person.id, statement.anchorPersonId] : [statement.anchorPersonId, person.id];
        const kind: RelationKind = statement.newPersonIs === "parent" || statement.newPersonIs === "child" ? "parent_child" : statement.newPersonIs;
        const relationship = buildRelationship(space, context, from, to, { kind, parentRole: statement.parentRole, label: statement.label, rationale: statement.rationale });
        space = { ...space, relationships: [...space.relationships, relationship] };
        created.relationshipId = relationship.id;
        entries.push(entry(context, "add_relationship", relationship.id, kind));
      }
      created.personId = person.id;
      break;
    }
    case "update_person": {
      const current = ownPerson(space, context, action.id);
      const next: SpacePerson = { ...current, ...action.person, name: (action.person.name ?? current.name).trim(), updatedAt: context.now };
      space = { ...space, people: replaceById(space.people, next) };
      entries.push(entry(context, "update_person", current.id, Object.keys(action.person).sort().join(",")));
      break;
    }
    case "remove_person": {
      const current = ownPerson(space, context, action.id);
      if (space.ownerPersonId === current.id) throw new PrivateCaseError("OWNER_REQUIRED");
      if (!current.removedAt) {
        space = { ...space, people: replaceById(space.people, { ...current, removedAt: context.now, updatedAt: context.now }) };
        entries.push(entry(context, "remove_person", current.id, ""));
      }
      break;
    }
    case "restore_person": {
      const current = ownPerson(space, context, action.id);
      if (current.removedAt) {
        space = { ...space, people: replaceById(space.people, { ...current, removedAt: null, updatedAt: context.now }) };
        entries.push(entry(context, "restore_person", current.id, ""));
      }
      break;
    }
    case "add_relationship": {
      const relationship = buildRelationship(space, context, action.from, action.to, action.relation);
      space = { ...space, relationships: [...space.relationships, relationship] };
      created.relationshipId = relationship.id;
      entries.push(entry(context, "add_relationship", relationship.id, relationship.kind));
      break;
    }
    case "update_relationship": {
      const current = ownRelationship(space, action.id);
      const kind = action.relation.kind ?? current.kind;
      const parentRole = kind === "parent_child" ? (action.relation.parentRole ?? current.parentRole ?? "parent") : undefined;
      const { parentRole: _previousRole, ...rest } = current;
      void _previousRole;
      const label = (action.relation.label ?? current.label).trim();
      if (kind === "other" && !label) throw new PrivateCaseError("LABEL_REQUIRED");
      const parsed = spaceRelationshipSchema.safeParse({ ...rest, kind, ...(parentRole ? { parentRole } : {}), label, rationale: (action.relation.rationale ?? current.rationale).trim(), updatedAt: context.now });
      if (!parsed.success) throw new PrivateCaseError("INVALID_RELATIONSHIP");
      space = { ...space, relationships: replaceById(space.relationships, parsed.data) };
      entries.push(entry(context, "update_relationship", current.id, Object.keys(action.relation).sort().join(",")));
      break;
    }
    case "remove_relationship": {
      const current = ownRelationship(space, action.id);
      if (!current.removedAt) {
        space = { ...space, relationships: replaceById(space.relationships, { ...current, removedAt: context.now, updatedAt: context.now }) };
        entries.push(entry(context, "remove_relationship", current.id, ""));
      }
      break;
    }
    case "restore_relationship": {
      const current = ownRelationship(space, action.id);
      if (current.removedAt) {
        space = { ...space, relationships: replaceById(space.relationships, { ...current, removedAt: null, updatedAt: context.now }) };
        entries.push(entry(context, "restore_relationship", current.id, ""));
      }
      break;
    }
    case "add_material": {
      for (const personId of action.material.personIds) requireAvailable(space, context, personId);
      const parsed = spaceMaterialSchema.safeParse({ id: context.newId("material"), ...action.material, title: action.material.title.trim(), original: action.original, createdAt: context.now, updatedAt: context.now, removedAt: null });
      if (!parsed.success) throw new PrivateCaseError("INVALID_MATERIAL");
      const materials = [...space.materials, parsed.data];
      if (totalMaterialBytes({ materials }) > MAX_MATERIAL_TOTAL_BYTES) throw new PrivateCaseError("MATERIALS_TOO_LARGE");
      space = { ...space, materials };
      created.materialId = parsed.data.id;
      entries.push(entry(context, "add_material", parsed.data.id, parsed.data.kind));
      break;
    }
    case "update_material": {
      const current = ownMaterial(space, action.id);
      for (const personId of action.material.personIds ?? []) requireAvailable(space, context, personId);
      const parsed = spaceMaterialSchema.safeParse({ ...current, ...action.material, title: (action.material.title ?? current.title).trim(), updatedAt: context.now });
      if (!parsed.success) throw new PrivateCaseError("INVALID_MATERIAL");
      space = { ...space, materials: replaceById(space.materials, parsed.data) };
      entries.push(entry(context, "update_material", current.id, Object.keys(action.material).sort().join(",")));
      break;
    }
    case "remove_material": {
      const current = ownMaterial(space, action.id);
      if (!current.removedAt) {
        space = { ...space, materials: replaceById(space.materials, { ...current, removedAt: context.now, updatedAt: context.now }) };
        entries.push(entry(context, "remove_material", current.id, ""));
      }
      break;
    }
    case "restore_material": {
      const current = ownMaterial(space, action.id);
      if (current.removedAt) {
        space = { ...space, materials: replaceById(space.materials, { ...current, removedAt: null, updatedAt: context.now }) };
        entries.push(entry(context, "restore_material", current.id, ""));
      }
      break;
    }
    case "attach_original": {
      const current = ownMaterial(space, action.id);
      if (current.original) throw new PrivateCaseError("ORIGINAL_ALREADY_SET");
      const parsed = spaceMaterialSchema.safeParse({ ...current, original: action.original, updatedAt: context.now });
      if (!parsed.success) throw new PrivateCaseError("INVALID_MATERIAL");
      const materials = replaceById(space.materials, parsed.data);
      if (totalMaterialBytes({ materials }) > MAX_MATERIAL_TOTAL_BYTES) throw new PrivateCaseError("MATERIALS_TOO_LARGE");
      space = { ...space, materials };
      entries.push(entry(context, "attach_original", current.id, action.original.mime));
      break;
    }
    case "add_lead": {
      if (action.lead.personId) requireAvailable(space, context, action.lead.personId);
      const lead: SpaceLead = { id: context.newId("lead"), ...action.lead, question: action.lead.question.trim(), mode: "manual", status: "open", coverage: "", missingDetail: "", nextQuestion: "", createdAt: context.now, updatedAt: context.now, removedAt: null };
      space = { ...space, leads: [...space.leads, lead] };
      created.leadId = lead.id;
      entries.push(entry(context, "add_lead", lead.id, lead.personId ?? ""));
      break;
    }
    case "update_lead": {
      const current = ownLead(space, action.id);
      const next: SpaceLead = { ...current, ...action.lead, question: (action.lead.question ?? current.question).trim(), updatedAt: context.now };
      if (action.status) {
        // "candidate" is derived from pending finds, never set by hand.
        if (action.status === "candidate") throw new PrivateCaseError("LEAD_STATUS_DERIVED");
        if (action.status === "nothing_found" && !next.coverage.trim()) throw new PrivateCaseError("LEAD_COVERAGE_REQUIRED");
        if (action.status === "needs_detail" && !next.missingDetail.trim()) throw new PrivateCaseError("LEAD_DETAIL_REQUIRED");
        next.status = action.status;
      }
      space = { ...space, leads: replaceById(space.leads, next) };
      entries.push(entry(context, "update_lead", current.id, [...Object.keys(action.lead), ...(action.status ? [`status=${action.status}`] : [])].sort().join(",")));
      break;
    }
    case "add_find": {
      for (const personId of action.find.personIds) requireAvailable(space, context, personId);
      if (action.find.leadId && ownLead(space, action.find.leadId).status === "cancelled") throw new PrivateCaseError("LEAD_CLOSED");
      const parsed = spaceFindSchema.safeParse({ id: context.newId("find"), ...action.find, title: action.find.title.trim(), why: action.find.why.trim(), performedBy: "operator_manual", status: "candidate", decisionReason: "", decidedAt: null, materialId: null, createdAt: context.now, updatedAt: context.now, removedAt: null });
      if (!parsed.success) throw new PrivateCaseError("INVALID_FIND");
      space = { ...space, finds: [...space.finds, parsed.data] };
      if (action.find.leadId) space = { ...space, leads: space.leads.map((lead) => (lead.id === action.find.leadId && lead.status !== "done" ? { ...lead, status: "candidate" as const, updatedAt: context.now } : lead)) };
      created.findId = parsed.data.id;
      entries.push(entry(context, "add_find", parsed.data.id, action.find.leadId ?? ""));
      break;
    }
    case "decide_find": {
      const current = space.finds.find((item) => item.id === action.id);
      if (!current) throw new PrivateCaseError("FIND_NOT_FOUND");
      if (current.status !== "candidate") throw new PrivateCaseError("FIND_NOT_PENDING");
      let materialId: string | null = null;
      if (action.decision === "accepted") {
        const personIds = action.personIds ?? current.personIds;
        for (const personId of personIds) requireAvailable(space, context, personId);
        // Acceptance places the source next to the person as a material with external provenance; it is the owner's decision, not evidence.
        const material = spaceMaterialSchema.safeParse({ id: context.newId("material"), kind: current.source.url ? "link" : "document", title: current.title, text: current.source.excerpt, url: current.source.url, provenance: [current.source.title, current.source.locator, current.source.kind].filter(Boolean).join(" · "), dateText: current.source.dateText, personIds, original: null, origin: "external_find", findId: current.id, createdAt: context.now, updatedAt: context.now, removedAt: null });
        if (!material.success) throw new PrivateCaseError("INVALID_MATERIAL");
        materialId = material.data.id;
        space = { ...space, materials: [...space.materials, material.data] };
        created.materialId = materialId;
        entries.push(entry(context, "add_material", materialId, "external_find"));
      }
      const decided = spaceFindSchema.safeParse({ ...current, status: action.decision, decisionReason: action.reason.trim(), decidedAt: context.now, materialId, updatedAt: context.now });
      if (!decided.success) throw new PrivateCaseError("INVALID_FIND");
      space = { ...space, finds: replaceById(space.finds, decided.data) };
      if (current.leadId) {
        const stillPending = space.finds.some((item) => item.leadId === current.leadId && item.status === "candidate");
        space = { ...space, leads: space.leads.map((lead) => (lead.id !== current.leadId ? lead : { ...lead, status: action.decision === "accepted" ? "done" as const : stillPending || lead.status !== "candidate" ? lead.status : "open" as const, nextQuestion: action.nextQuestion || lead.nextQuestion, updatedAt: context.now })) };
      }
      entries.push(entry(context, "decide_find", current.id, action.decision));
      break;
    }
    case "layout": {
      const positions = { ...space.layout.positions, ...action.positions };
      if (Object.keys(positions).length > MAX_LAYOUT_NODES) throw new PrivateCaseError("LAYOUT_FULL");
      space = { ...space, layout: { positions } };
      break;
    }
    case "reset_layout": {
      const positions = { ...space.layout.positions };
      for (const nodeId of action.nodeIds) delete positions[nodeId];
      space = { ...space, layout: { positions } };
      entries.push(entry(context, "reset_layout", String(action.nodeIds.length), action.nodeIds.slice(0, 8).join(",")));
      break;
    }
    case "guide_dismiss": {
      if (!space.guide.dismissed.includes(action.key)) space = { ...space, guide: { dismissed: [...space.guide.dismissed, action.key].slice(-MAX_GUIDE_DISMISSED) } };
      break;
    }
    case "guide_reset": {
      space = { ...space, guide: { dismissed: [] } };
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new PrivateCaseError(`UNKNOWN_ACTION_${String((exhaustive as { action?: string }).action)}`);
    }
  }
  const journal = [...space.journal, ...entries];
  if (journal.length > MAX_JOURNAL_ENTRIES) throw new PrivateCaseError("JOURNAL_FULL");
  return { space: parsePrivateSpace({ ...space, journal, updatedAt: context.now }), created };
}
