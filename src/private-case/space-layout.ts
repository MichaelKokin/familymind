import { ancestryLayout, ANCESTRY_CARD_HEIGHT, ANCESTRY_CARD_WIDTH, ANCESTRY_GENERATION_GAP, type AncestryBranch, type AncestryNode, type ParentRole } from "./ancestry-layout";
import type { PrivateResearch, ResearchPerson } from "./research-model";
import type { PrivateSpace, SpaceFind, SpaceLead, SpaceMaterial, SpacePerson, SpaceRelationship } from "./space-model";

/** Composition merges the immutable snapshot with owner-added records; the
 * layout derives positions only for cards without a saved manual position. */
export const MATERIAL_CARD_WIDTH = 224;
export const MATERIAL_CARD_HEIGHT = 156;
export const FIND_CARD_WIDTH = 240;
export const FIND_CARD_HEIGHT = 176;
const PERSON_WIDTH = ANCESTRY_CARD_WIDTH;
const PERSON_HEIGHT = ANCESTRY_CARD_HEIGHT;
const ROW_GAP = ANCESTRY_GENERATION_GAP;
const SLOT_WIDTH = ANCESTRY_CARD_WIDTH + 76;
const MATERIAL_OFFSET = 36;
const MATERIAL_GAP = 14;
const COLLISION_PADDING = 12;
const COLUMN_STEP = PERSON_HEIGHT + 40;

export type RecordOrigin = "snapshot" | "space";
export type ComposedPerson = {
  id: string;
  name: string;
  dateText: string;
  livingStatus: "living" | "deceased" | "unknown" | null;
  status: string;
  origin: RecordOrigin;
  snapshot: ResearchPerson | null;
  record: SpacePerson | null;
};
export type ComposedRelationship = {
  id: string;
  from: string;
  to: string;
  kind: "parent_child" | "partner" | "other";
  parentRole?: ParentRole;
  label: string;
  status: string;
  rationale: string;
  sourceIds: string[];
  origin: RecordOrigin;
  record: SpaceRelationship | null;
};
export type SpaceComposition = {
  rootPersonId: string | null;
  people: ComposedPerson[];
  relationships: ComposedRelationship[];
  materials: SpaceMaterial[];
  leads: SpaceLead[];
  finds: SpaceFind[];
  removed: { people: SpacePerson[]; relationships: SpaceRelationship[]; materials: SpaceMaterial[] };
  dangling: string[];
};

export function composeSpace(snapshot: PrivateResearch | null, space: PrivateSpace): SpaceComposition {
  const people: ComposedPerson[] = [];
  for (const person of snapshot?.people ?? []) {
    people.push({ id: person.id, name: person.name, dateText: person.dates || person.birthDate || "", livingStatus: person.livingStatus ?? null, status: person.status, origin: "snapshot", snapshot: person, record: null });
  }
  const snapshotIds = new Set(people.map((person) => person.id));
  for (const person of space.people) {
    if (person.removedAt || snapshotIds.has(person.id)) continue;
    people.push({ id: person.id, name: person.name, dateText: person.dateText, livingStatus: person.livingStatus, status: "", origin: "space", snapshot: null, record: person });
  }
  const ids = new Set(people.map((person) => person.id));
  const relationships: ComposedRelationship[] = [];
  const dangling: string[] = [];
  for (const relation of snapshot?.relationships ?? []) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) continue;
    relationships.push({ id: relation.id, from: relation.from, to: relation.to, kind: relation.kind ?? "other", parentRole: relation.parentRole, label: relation.label, status: relation.status, rationale: "", sourceIds: relation.sourceIds, origin: "snapshot", record: null });
  }
  for (const relation of space.relationships) {
    if (relation.removedAt) continue;
    if (!ids.has(relation.from) || !ids.has(relation.to)) {
      dangling.push(relation.id);
      continue;
    }
    relationships.push({ id: relation.id, from: relation.from, to: relation.to, kind: relation.kind, parentRole: relation.parentRole, label: relation.label, status: relation.evidenceStatus, rationale: relation.rationale, sourceIds: [], origin: "space", record: relation });
  }
  const materials: SpaceMaterial[] = [];
  for (const material of space.materials) {
    if (material.removedAt) continue;
    if (material.personIds.some((id) => !ids.has(id))) dangling.push(material.id);
    materials.push({ ...material, personIds: material.personIds.filter((id) => ids.has(id)) });
  }
  const leads = space.leads.filter((lead) => !lead.removedAt).map((lead) => (lead.personId && !ids.has(lead.personId) ? { ...lead, personId: null } : lead));
  const finds: SpaceFind[] = [];
  for (const find of space.finds) {
    if (find.removedAt) continue;
    if (find.personIds.some((id) => !ids.has(id))) dangling.push(find.id);
    finds.push({ ...find, personIds: find.personIds.filter((id) => ids.has(id)) });
  }
  const snapshotOwner = snapshot?.owner.personId && ids.has(snapshot.owner.personId) ? snapshot.owner.personId : null;
  const rootPersonId = snapshotOwner ?? (space.ownerPersonId && ids.has(space.ownerPersonId) ? space.ownerPersonId : null);
  return {
    rootPersonId,
    people,
    relationships,
    materials,
    leads,
    finds,
    removed: { people: space.people.filter((person) => person.removedAt), relationships: space.relationships.filter((relation) => relation.removedAt), materials: space.materials.filter((material) => material.removedAt) },
    dangling,
  };
}

export type SpaceNode = {
  id: string;
  kind: "person" | "material" | "find";
  entityId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  manual: boolean;
  occurrence: AncestryNode | null;
  branch: AncestryBranch | "beyond";
  depth: number | null;
};
export type SpaceEdge = {
  id: string;
  kind: "parent_child" | "partner" | "other" | "material" | "find";
  source: string;
  target: string;
  relationshipId: string | null;
  materialId: string | null;
  role: ParentRole | null;
  label: string;
  status: string;
  origin: RecordOrigin;
};
export type SpaceLayout = {
  rootPersonId: string | null;
  nodes: SpaceNode[];
  edges: SpaceEdge[];
  primaryNodeId: Map<string, string>;
  omittedCycleIds: string[];
  truncated: boolean;
};
type Rect = { x: number; y: number; width: number; height: number };

export const personNodeId = (personId: string) => `person:${personId}`;
export const materialNodeId = (materialId: string) => `material:${materialId}`;
export const findNodeId = (findId: string) => `find:${findId}`;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width + COLLISION_PADDING && a.x + a.width + COLLISION_PADDING > b.x && a.y < b.y + b.height + COLLISION_PADDING && a.y + a.height + COLLISION_PADDING > b.y;
}

export function layoutSpace(composition: SpaceComposition, layout: PrivateSpace["layout"]): SpaceLayout {
  const manual = layout.positions;
  const occupied: Rect[] = [];
  const nodes: SpaceNode[] = [];
  const primary = new Map<string, string>();
  const byId = new Map<string, SpaceNode>();
  const free = (candidate: Rect, strategy: "row" | "column"): Rect => {
    let rect = { ...candidate };
    for (let step = 0; step < 240; step += 1) {
      if (!occupied.some((other) => overlaps(rect, other))) return rect;
      if (strategy === "row") rect = step % 24 === 23 ? { ...rect, x: candidate.x, y: rect.y + rect.height + 40 } : { ...rect, x: rect.x + SLOT_WIDTH };
      else rect = step % 24 === 23 ? { ...rect, x: rect.x + rect.width + 40, y: candidate.y } : { ...rect, y: rect.y + rect.height + MATERIAL_GAP };
    }
    return rect;
  };
  const commit = (node: SpaceNode) => {
    nodes.push(node);
    byId.set(node.id, node);
    occupied.push(node);
    if (node.kind === "person" && !primary.has(node.entityId)) primary.set(node.entityId, node.id);
  };
  const placePerson = (id: string, entityId: string, auto: Rect, strategy: "row" | "column", occurrence: AncestryNode | null, branch: SpaceNode["branch"], depth: number | null) => {
    const saved = manual[id];
    const rect = saved ? { ...auto, x: saved.x, y: saved.y } : free(auto, strategy);
    commit({ id, kind: "person", entityId, x: rect.x, y: rect.y, width: PERSON_WIDTH, height: PERSON_HEIGHT, manual: Boolean(saved), occurrence, branch, depth });
  };

  const ancestry = ancestryLayout({ owner: { personId: composition.rootPersonId ?? undefined }, people: composition.people, relationships: composition.relationships });
  // Manual tree cards are fixed first so automatic ones flow around them.
  for (const occurrence of ancestry.nodes) if (manual[occurrence.id]) placePerson(occurrence.id, occurrence.personId, { x: occurrence.x, y: occurrence.y, width: PERSON_WIDTH, height: PERSON_HEIGHT }, "row", occurrence, occurrence.branch, occurrence.depth);
  for (const occurrence of ancestry.nodes) if (!manual[occurrence.id]) placePerson(occurrence.id, occurrence.personId, { x: occurrence.x, y: occurrence.y, width: PERSON_WIDTH, height: PERSON_HEIGHT }, "row", occurrence, occurrence.branch, occurrence.depth);

  const pending = new Set(composition.people.filter((person) => !primary.has(person.id)).map((person) => person.id));
  const relations = [...composition.relationships].sort((a, b) => (a.kind === "parent_child" ? 0 : a.kind === "partner" ? 1 : 2) - (b.kind === "parent_child" ? 0 : b.kind === "partner" ? 1 : 2) || compareIds(a.id, b.id));
  let progress = true;
  for (let guard = 0; pending.size && progress && guard < 2000; guard += 1) {
    progress = false;
    for (const relation of relations) {
      const fromPlaced = primary.has(relation.from);
      const toPlaced = primary.has(relation.to);
      if (fromPlaced === toPlaced) continue;
      const anchorId = fromPlaced ? relation.from : relation.to;
      const newId = fromPlaced ? relation.to : relation.from;
      if (!pending.has(newId)) continue;
      const anchor = byId.get(primary.get(anchorId)!)!;
      const auto: Rect = relation.kind === "parent_child"
        ? { x: anchor.x, y: fromPlaced ? anchor.y + ROW_GAP : anchor.y - ROW_GAP, width: PERSON_WIDTH, height: PERSON_HEIGHT }
        : { x: anchor.x + SLOT_WIDTH, y: anchor.y, width: PERSON_WIDTH, height: PERSON_HEIGHT };
      const depth = anchor.depth === null ? null : anchor.depth + (relation.kind === "parent_child" ? (fromPlaced ? -1 : 1) : 0);
      placePerson(personNodeId(newId), newId, auto, "row", null, anchor.branch, depth);
      pending.delete(newId);
      progress = true;
    }
  }
  const rightEdge = () => occupied.reduce((max, rect) => Math.max(max, rect.x + rect.width), -PERSON_WIDTH / 2);
  let beyondX = rightEdge() + SLOT_WIDTH;
  let beyondY = 0;
  for (const id of [...pending].sort(compareIds)) {
    placePerson(personNodeId(id), id, { x: beyondX, y: beyondY, width: PERSON_WIDTH, height: PERSON_HEIGHT }, "column", null, "beyond", null);
    const placed = byId.get(personNodeId(id))!;
    if (!placed.manual) {
      beyondY = placed.y + COLUMN_STEP;
      beyondX = placed.x;
    }
  }

  const materialRows = new Map<string, number>();
  const leftEdge = occupied.reduce((min, rect) => Math.min(min, rect.x), -PERSON_WIDTH / 2);
  let looseY = 0;
  for (const material of [...composition.materials].sort((a, b) => compareIds(a.createdAt, b.createdAt) || compareIds(a.id, b.id))) {
    const id = materialNodeId(material.id);
    const anchorPersonId = material.personIds.find((personId) => primary.has(personId));
    const anchor = anchorPersonId ? byId.get(primary.get(anchorPersonId)!) : undefined;
    let auto: Rect;
    if (anchor) {
      const row = materialRows.get(anchor.id) ?? 0;
      materialRows.set(anchor.id, row + 1);
      // Materials sit on the outer side of the branch: paternal cards and the owner keep
      // their right-hand neighbours (the maternal line, partners) free of material stacks.
      const left = anchor.branch === "paternal" || anchor.branch === "owner";
      auto = { x: left ? anchor.x - MATERIAL_CARD_WIDTH - MATERIAL_OFFSET : anchor.x + anchor.width + MATERIAL_OFFSET, y: anchor.y + row * (MATERIAL_CARD_HEIGHT + MATERIAL_GAP), width: MATERIAL_CARD_WIDTH, height: MATERIAL_CARD_HEIGHT };
    } else {
      auto = { x: leftEdge - MATERIAL_CARD_WIDTH - 2 * MATERIAL_OFFSET, y: looseY, width: MATERIAL_CARD_WIDTH, height: MATERIAL_CARD_HEIGHT };
      looseY += MATERIAL_CARD_HEIGHT + MATERIAL_GAP;
    }
    const saved = manual[id];
    const rect = saved ? { ...auto, x: saved.x, y: saved.y } : free(auto, "column");
    commit({ id, kind: "material", entityId: material.id, x: rect.x, y: rect.y, width: MATERIAL_CARD_WIDTH, height: MATERIAL_CARD_HEIGHT, manual: Boolean(saved), occurrence: null, branch: anchor?.branch ?? "beyond", depth: null });
  }

  // Pending candidates sit in the same stack as the person's materials, on the outer side of the branch.
  for (const find of [...composition.finds].filter((find) => find.status === "candidate").sort((a, b) => compareIds(a.createdAt, b.createdAt) || compareIds(a.id, b.id))) {
    const id = findNodeId(find.id);
    const anchorPersonId = find.personIds.find((personId) => primary.has(personId));
    const anchor = anchorPersonId ? byId.get(primary.get(anchorPersonId)!) : undefined;
    let auto: Rect;
    if (anchor) {
      const row = materialRows.get(anchor.id) ?? 0;
      materialRows.set(anchor.id, row + 1);
      const left = anchor.branch === "paternal" || anchor.branch === "owner";
      auto = { x: left ? anchor.x - FIND_CARD_WIDTH - MATERIAL_OFFSET : anchor.x + anchor.width + MATERIAL_OFFSET, y: anchor.y + row * (MATERIAL_CARD_HEIGHT + MATERIAL_GAP), width: FIND_CARD_WIDTH, height: FIND_CARD_HEIGHT };
    } else {
      auto = { x: leftEdge - FIND_CARD_WIDTH - 2 * MATERIAL_OFFSET, y: looseY, width: FIND_CARD_WIDTH, height: FIND_CARD_HEIGHT };
      looseY += FIND_CARD_HEIGHT + MATERIAL_GAP;
    }
    const saved = manual[id];
    const rect = saved ? { ...auto, x: saved.x, y: saved.y } : free(auto, "column");
    commit({ id, kind: "find", entityId: find.id, x: rect.x, y: rect.y, width: FIND_CARD_WIDTH, height: FIND_CARD_HEIGHT, manual: Boolean(saved), occurrence: null, branch: anchor?.branch ?? "beyond", depth: null });
  }

  const relationById = new Map(composition.relationships.map((relation) => [relation.id, relation]));
  const edges: SpaceEdge[] = [];
  const covered = new Set<string>();
  for (const edge of ancestry.edges) {
    const relation = relationById.get(edge.relationshipId)!;
    covered.add(edge.relationshipId);
    edges.push({ id: edge.id, kind: "parent_child", source: edge.source, target: edge.target, relationshipId: relation.id, materialId: null, role: edge.role, label: relation.label, status: relation.status, origin: relation.origin });
  }
  for (const relation of composition.relationships) {
    if (covered.has(relation.id)) continue;
    const source = primary.get(relation.from);
    const target = primary.get(relation.to);
    if (!source || !target) continue;
    edges.push({ id: `relation:${relation.id}`, kind: relation.kind, source, target, relationshipId: relation.id, materialId: null, role: relation.kind === "parent_child" ? relation.parentRole ?? "parent" : null, label: relation.label, status: relation.status, origin: relation.origin });
  }
  for (const material of composition.materials) {
    for (const personId of material.personIds) {
      const target = primary.get(personId);
      if (target) edges.push({ id: `material:${material.id}:${personId}`, kind: "material", source: materialNodeId(material.id), target, relationshipId: null, materialId: material.id, role: null, label: "", status: "", origin: "space" });
    }
  }
  for (const find of composition.finds) {
    if (find.status !== "candidate" || !byId.has(findNodeId(find.id))) continue;
    for (const personId of find.personIds) {
      const target = primary.get(personId);
      if (target) edges.push({ id: `find:${find.id}:${personId}`, kind: "find", source: findNodeId(find.id), target, relationshipId: null, materialId: find.id, role: null, label: "", status: find.status, origin: "space" });
    }
  }
  return { rootPersonId: ancestry.rootPersonId, nodes, edges, primaryNodeId: primary, omittedCycleIds: ancestry.omittedCycleIds, truncated: ancestry.truncated };
}
