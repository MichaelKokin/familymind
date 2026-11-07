import { describe, expect, it } from "vitest";
import { ANCESTRY_GENERATION_GAP } from "../src/private-case/ancestry-layout";
import { composeSpace, layoutSpace, materialNodeId, personNodeId, MATERIAL_CARD_WIDTH, type SpaceNode } from "../src/private-case/space-layout";
import { suggestNextStep } from "../src/private-case/space-guide";
import { applySpaceAction, initialSpace, type SpaceContext } from "../src/private-case/space-logic";
import type { PrivateSpace } from "../src/private-case/space-model";
import { syntheticResearch } from "../e2e/fixtures/private-research";

const now = "2026-11-07T10:00:00.000Z";
let counter = 0;
const context: SpaceContext = { now, snapshotPeopleIds: new Set(["synthetic-a", "synthetic-b"]), snapshotOwnerId: "synthetic-b", snapshotRelationships: [{ from: "synthetic-a", to: "synthetic-b", kind: "parent_child" }], newId: (prefix) => `${prefix}_${String(++counter).padStart(3, "0")}` };
const person = (name: string) => ({ name, dateText: "", livingStatus: "unknown" as const, notes: "" });
const overlaps = (a: SpaceNode, b: SpaceNode) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function family(): { space: PrivateSpace; ids: Record<string, string> } {
  let space = initialSpace("case_synthetic", "a".repeat(64), now);
  const ids: Record<string, string> = {};
  const add = (key: string, action: Parameters<typeof applySpaceAction>[1]) => { const result = applySpaceAction(space, action, context); space = result.space; ids[key] = result.created.personId ?? result.created.materialId ?? ""; };
  add("father", { action: "add_person", person: person("Отец Учебный"), asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "parent", parentRole: "father", label: "", rationale: "" } });
  add("child", { action: "add_person", person: person("Дочь Учебная"), asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "child", parentRole: "father", label: "", rationale: "" } });
  add("partner", { action: "add_person", person: person("Партнёр Учебный"), asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "partner", label: "", rationale: "" } });
  add("loose", { action: "add_person", person: person("Однофамилец Учебный"), asOwner: false });
  add("photo", { action: "add_material", material: { kind: "photo", title: "Фото отца", text: "", url: "", provenance: "Альбом", dateText: "", personIds: [ids.father] }, original: null });
  add("note", { action: "add_material", material: { kind: "note", title: "Заметка", text: "Текст", url: "", provenance: "", dateText: "", personIds: [] }, original: null });
  return { space, ids };
}

describe("private space composition and layout", () => {
  it("places ancestors, descendants, partners, unconnected people and materials without overlaps", () => {
    const { space, ids } = family();
    const composition = composeSpace(syntheticResearch(), space);
    expect(composition.rootPersonId).toBe("synthetic-b");
    expect(composition.people).toHaveLength(6);
    const layout = layoutSpace(composition, space.layout);
    const node = (id: string) => layout.nodes.find((item) => item.id === id)!;
    const byPerson = (personId: string) => layout.nodes.find((item) => item.kind === "person" && item.entityId === personId)!;
    const root = node("root:synthetic-b");
    expect(root.y).toBe(0);
    expect(byPerson(ids.father).occurrence?.branch).toBe("paternal");
    expect(byPerson(ids.father).y).toBe(-ANCESTRY_GENERATION_GAP);
    expect(byPerson("synthetic-a").occurrence?.branch).toBe("maternal");
    expect(byPerson(ids.child).id).toBe(personNodeId(ids.child));
    expect(byPerson(ids.child).y).toBe(root.y + ANCESTRY_GENERATION_GAP);
    expect(byPerson(ids.partner).y).toBe(root.y);
    expect(byPerson(ids.partner).x).toBeGreaterThan(root.x);
    expect(byPerson(ids.loose).branch).toBe("beyond");
    expect(byPerson(ids.loose).x).toBeGreaterThan(Math.max(...layout.nodes.filter((item) => item.branch !== "beyond" && item.kind === "person").map((item) => item.x)));
    const photo = node(materialNodeId(ids.photo));
    const father = byPerson(ids.father);
    expect(photo.x).toBe(father.x - MATERIAL_CARD_WIDTH - 36);
    expect(photo.y).toBe(father.y);
    expect(photo.width).toBe(MATERIAL_CARD_WIDTH);
    const note = node(materialNodeId(ids.note));
    expect(note.x).toBeLessThan(Math.min(...layout.nodes.filter((item) => item.kind === "person").map((item) => item.x)));
    for (const a of layout.nodes) for (const b of layout.nodes) if (a.id !== b.id) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    expect(layout.edges.filter((edge) => edge.kind === "parent_child")).toHaveLength(3);
    expect(layout.edges.find((edge) => edge.kind === "partner")).toMatchObject({ source: "root:synthetic-b", target: personNodeId(ids.partner) });
    expect(layout.edges.find((edge) => edge.kind === "material")).toMatchObject({ source: materialNodeId(ids.photo), target: father.id });
    expect(layout.edges.find((edge) => edge.relationshipId === "synthetic-relation")?.origin).toBe("snapshot");
  });

  it("keeps manual positions exactly, moves only automatic cards around them and preserves them when new cards appear", () => {
    const { space, ids } = family();
    const composition = composeSpace(syntheticResearch(), space);
    const auto = layoutSpace(composition, space.layout);
    const fatherNode = auto.nodes.find((item) => item.entityId === ids.father)!;
    const partnerAuto = auto.nodes.find((item) => item.entityId === ids.partner)!;
    const manual: PrivateSpace["layout"] = { positions: { [fatherNode.id]: { x: 1500, y: -900 }, [personNodeId(ids.partner)]: { x: fatherNode.x, y: fatherNode.y } } };
    const placed = layoutSpace(composition, manual);
    const father = placed.nodes.find((item) => item.entityId === ids.father)!;
    const partner = placed.nodes.find((item) => item.entityId === ids.partner)!;
    expect(father).toMatchObject({ x: 1500, y: -900, manual: true });
    expect(partner).toMatchObject({ x: fatherNode.x, y: fatherNode.y, manual: true });
    const photo = placed.nodes.find((item) => item.id === materialNodeId(ids.photo))!;
    expect(photo.manual).toBe(false);
    expect(photo.x).toBe(1500 - MATERIAL_CARD_WIDTH - 36);
    const mother = placed.nodes.find((item) => item.entityId === "synthetic-a")!;
    expect(mother.manual).toBe(false);
    for (const a of placed.nodes) for (const b of placed.nodes) if (a.id !== b.id && !(a.manual && b.manual)) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    expect(partnerAuto.x).not.toBe(partner.x);
    const grown = applySpaceAction(space, { action: "add_person", person: person("Сын Учебный"), asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "child", parentRole: "father", label: "", rationale: "" } }, context).space;
    const regrown = layoutSpace(composeSpace(syntheticResearch(), grown), manual);
    expect(regrown.nodes.find((item) => item.entityId === ids.father)).toMatchObject({ x: 1500, y: -900 });
    expect(regrown.nodes.find((item) => item.entityId === ids.partner)).toMatchObject({ x: fatherNode.x, y: fatherNode.y });
    expect(regrown.nodes.filter((item) => item.kind === "person")).toHaveLength(7);
  });

  it("hides removed records, tolerates dangling references and derives the owner only from explicit data", () => {
    const { space, ids } = family();
    const removed = applySpaceAction(space, { action: "remove_person", id: ids.father }, context).space;
    const composition = composeSpace(syntheticResearch(), removed);
    expect(composition.people.some((item) => item.id === ids.father)).toBe(false);
    expect(composition.relationships.some((item) => item.from === ids.father)).toBe(false);
    expect(composition.dangling).toContain(ids.photo);
    expect(composition.materials.find((item) => item.id === ids.photo)?.personIds).toEqual([]);
    expect(composition.removed.people.map((item) => item.id)).toEqual([ids.father]);
    const layout = layoutSpace(composition, removed.layout);
    expect(layout.nodes.some((item) => item.entityId === ids.father)).toBe(false);
    const withoutSnapshot = composeSpace(null, space);
    expect(withoutSnapshot.rootPersonId).toBeNull();
    expect(layoutSpace(withoutSnapshot, space.layout).nodes.filter((item) => item.kind === "person").every((item) => item.branch === "beyond")).toBe(true);
    const snapshot = syntheticResearch();
    snapshot.people.push({ ...snapshot.people[0], id: "person_001", name: "Коллизия ID" });
    expect(composeSpace(snapshot, space).people.filter((item) => item.id === "person_001")).toHaveLength(1);
  });
});

describe("guide", () => {
  it("proposes exactly one honest next step per selection and honours dismissals", () => {
    const { space, ids } = family();
    const composition = composeSpace(syntheticResearch(), space);
    expect(suggestNextStep(composition, { kind: "person", id: ids.partner }, [])).toMatchObject({ action: "add_parent", targetId: ids.partner });
    expect(suggestNextStep(composition, { kind: "person", id: ids.partner }, [`parent:${ids.partner}`])).toMatchObject({ action: "add_material" });
    expect(suggestNextStep(composition, { kind: "person", id: ids.partner }, [`parent:${ids.partner}`, `material:${ids.partner}`])).toMatchObject({ action: "ask_assistant", personName: "Партнёр Учебный" });
    expect(suggestNextStep(composition, { kind: "person", id: ids.child }, [])).toMatchObject({ action: "add_material", targetId: ids.child });
    expect(suggestNextStep(composition, { kind: "person", id: ids.father }, [`parent:${ids.father}`])).toMatchObject({ action: "add_lead", targetId: ids.father });
    expect(suggestNextStep(composition, { kind: "person", id: ids.father }, [`parent:${ids.father}`, `lead:${ids.father}`])).toMatchObject({ action: "ask_assistant" });
    expect(suggestNextStep(composition, { kind: "material", id: ids.note }, [])).toMatchObject({ action: "link_material", targetId: ids.note });
    expect(suggestNextStep(composition, null, [])).toMatchObject({ action: "add_lead", targetId: "synthetic-b", key: "first-lead" });
    expect(suggestNextStep(composition, null, ["first-lead"])).toBeNull();
    const fresh = composeSpace(syntheticResearch(), initialSpace("case_synthetic", "a".repeat(64), now));
    expect(suggestNextStep(fresh, null, [])).toMatchObject({ action: "add_material", targetId: "synthetic-b" });
    const only = composeSpace({ ...syntheticResearch(), people: [syntheticResearch().people[1]], relationships: [], photos: [] }, initialSpace("case_synthetic", "a".repeat(64), now));
    expect(suggestNextStep(only, null, [])).toMatchObject({ action: "add_first_person" });
    expect(suggestNextStep(composeSpace(null, initialSpace("case_synthetic", null, now)), null, [])).toMatchObject({ action: "set_owner" });
    expect(JSON.stringify(suggestNextStep(composition, { kind: "person", id: ids.father }, []))).not.toMatch(/search|поиск/i);
  });
});
