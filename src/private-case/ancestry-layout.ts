
export const ANCESTRY_CARD_WIDTH = 258;
export const ANCESTRY_CARD_HEIGHT = 228;
export const ANCESTRY_GENERATION_GAP = 360;
const SLOT_WIDTH = ANCESTRY_CARD_WIDTH + 76;
const BRANCH_GAP = 100;
const MAX_OCCURRENCES = 1000;
const MAX_DEPTH = 12;

export type AncestryBranch = "owner" | "paternal" | "maternal" | "unspecified";
export type ParentRole = "father" | "mother" | "parent";
export type AncestryPathStep = { personId: string; relationshipId: string; role: ParentRole };
export type AncestryNode = {
  id: string;
  personId: string;
  x: number;
  y: number;
  depth: number;
  branch: AncestryBranch;
  path: AncestryPathStep[];
  repeated: boolean;
};
export type AncestryEdge = { id: string; relationshipId: string; source: string; target: string; role: ParentRole };
/** Structural input: any people list with ids and typed directed relationships. */
export type AncestryRelationship = { id: string; from: string; to: string; kind?: string; parentRole?: ParentRole };
export type AncestryInput = { owner: { personId?: string }; people: ReadonlyArray<{ id: string }>; relationships: ReadonlyArray<AncestryRelationship> };
export type AncestryLayout = {
  rootPersonId: string | null;
  nodes: AncestryNode[];
  edges: AncestryEdge[];
  unplacedPersonIds: string[];
  omittedCycleIds: string[];
  truncated: boolean;
};
type TreeNode = AncestryNode & { parents: TreeNode[] };

const roleOrder = { father: 0, mother: 1, parent: 2 };
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Layout is derived only from typed, directed claims. Names, generations and
 * partner links never establish ancestry. Repeated ancestors get an occurrence
 * on each path so neither family branch is visually reassigned to the other. */
export function ancestryLayout(data: AncestryInput): AncestryLayout {
  const people = new Set(data.people.map(person => person.id));
  const rootPersonId = data.owner.personId && people.has(data.owner.personId) ? data.owner.personId : null;
  const result: AncestryLayout = { rootPersonId, nodes: [], edges: [], unplacedPersonIds: [], omittedCycleIds: [], truncated: false };
  if (!rootPersonId) return { ...result, unplacedPersonIds: [...people].sort(compareIds) };

  const byChild = new Map<string, AncestryRelationship[]>();
  for (const relation of data.relationships) {
    if (relation.kind !== "parent_child" || !people.has(relation.from) || !people.has(relation.to)) continue;
    const links = byChild.get(relation.to) ?? [];
    links.push(relation); byChild.set(relation.to, links);
  }
  for (const links of byChild.values()) links.sort((a, b) => roleOrder[a.parentRole ?? "parent"] - roleOrder[b.parentRole ?? "parent"] || compareIds(a.from, b.from) || compareIds(a.id, b.id));
  let count = 0;
  const cycles = new Set<string>();
  const build = (personId: string, path: AncestryPathStep[], branch: AncestryBranch, visited: Set<string>): TreeNode => {
    count += 1;
    const node: TreeNode = { id: path.length ? `ancestor:${path.map(step => step.relationshipId).join(":")}` : `root:${personId}`, personId, x: 0, y: path.length ? -path.length * ANCESTRY_GENERATION_GAP : 0, depth: path.length, branch, path, repeated: false, parents: [] };
    for (const relation of byChild.get(personId) ?? []) {
      if (visited.has(relation.from)) { cycles.add(relation.id); continue; }
      if (path.length >= MAX_DEPTH || count >= MAX_OCCURRENCES) { result.truncated = true; continue; }
      const role = relation.parentRole ?? "parent";
      const nextBranch = branch === "owner" ? role === "father" ? "paternal" : role === "mother" ? "maternal" : "unspecified" : branch;
      const parent = build(relation.from, [...path, { personId: relation.from, relationshipId: relation.id, role }], nextBranch, new Set([...visited, relation.from]));
      node.parents.push(parent);
      result.edges.push({ id: `edge:${parent.id}`, relationshipId: relation.id, source: parent.id, target: node.id, role });
    }
    return node;
  };
  const root = build(rootPersonId, [], "owner", new Set([rootPersonId]));
  root.x = -ANCESTRY_CARD_WIDTH / 2;
  const treeNodes: TreeNode[] = [];
  const visit = (node: TreeNode) => { treeNodes.push(node); node.parents.forEach(visit); };
  visit(root);
  const childByParent = new Map<string, TreeNode>();
  treeNodes.forEach(child => child.parents.forEach(parent => childByParent.set(parent.id, child)));
  // Pack each generation independently, outwards from the branch divider.
  // Deep, wide subtrees cannot push the owner's immediate parents off screen.
  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    const row = treeNodes.filter(node => node.depth === depth);
    const preferred = (node: TreeNode) => {
      const child = childByParent.get(node.id)!;
      return child.x + ANCESTRY_CARD_WIDTH / 2 + (child.parents.indexOf(node) - (child.parents.length - 1) / 2) * SLOT_WIDTH;
    };
    let rightBoundary = -BRANCH_GAP / 2 - ANCESTRY_CARD_WIDTH / 2;
    for (const node of row.filter(node => node.branch === "paternal").reverse()) {
      const center = Math.min(preferred(node), rightBoundary);
      node.x = center - ANCESTRY_CARD_WIDTH / 2; rightBoundary = center - SLOT_WIDTH;
    }
    let leftBoundary = BRANCH_GAP / 2 + ANCESTRY_CARD_WIDTH / 2;
    for (const node of row.filter(node => node.branch === "maternal")) {
      const center = Math.max(preferred(node), leftBoundary);
      node.x = center - ANCESTRY_CARD_WIDTH / 2; leftBoundary = center + SLOT_WIDTH;
    }
    leftBoundary += BRANCH_GAP;
    for (const node of row.filter(node => node.branch === "unspecified")) {
      const center = Math.max(preferred(node), leftBoundary);
      node.x = center - ANCESTRY_CARD_WIDTH / 2; leftBoundary = center + SLOT_WIDTH;
    }
  }
  const flatten = (node: TreeNode) => {
    const { parents, ...positioned } = node;
    result.nodes.push(positioned);
    parents.forEach(flatten);
  };
  flatten(root);
  const occurrences = new Map<string, number>();
  result.nodes.forEach(node => occurrences.set(node.personId, (occurrences.get(node.personId) ?? 0) + 1));
  result.nodes.forEach(node => { node.repeated = (occurrences.get(node.personId) ?? 0) > 1; });
  result.unplacedPersonIds = [...people].filter(id => !occurrences.has(id)).sort(compareIds);
  result.omittedCycleIds = [...cycles].sort(compareIds);
  return result;
}
