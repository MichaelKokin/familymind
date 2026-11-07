import { describe, expect, it } from "vitest";
import { ancestryLayout, ANCESTRY_CARD_WIDTH, ANCESTRY_GENERATION_GAP } from "../src/private-case/ancestry-layout";
import { parseResearch, type PrivateResearch } from "../src/private-case/research-model";
import { syntheticResearch } from "../e2e/fixtures/private-research";

const person = (id: string, generation = 0): PrivateResearch["people"][number] => ({ id, name: `Synthetic ${id}`, dates: "", relation: "", biography: "", branch: "An arbitrary legacy branch", status: "Hypothesis", sourceIds: [], photoIds: [], generation });
const parent = (id: string, from: string, to: string, parentRole: "father" | "mother" | "parent" = "parent"): PrivateResearch["relationships"][number] => ({ id, from, to, parentRole, kind: "parent_child", label: "Unverified tree claim", status: "hypothesis", sourceIds: [] });
function family(): PrivateResearch {
  return { ...syntheticResearch(), owner: { name: "Synthetic owner", personId: "owner" }, people: [person("owner", 9), person("father", 0), person("mother", 0), person("paternal-grandmother", 1), person("maternal-grandmother", 1), person("unlinked", 1)], relationships: [parent("f-o", "father", "owner", "father"), parent("m-o", "mother", "owner", "mother"), parent("pg-f", "paternal-grandmother", "father", "mother"), parent("mg-m", "maternal-grandmother", "mother", "mother")], sources: [], photos: [], questions: [] };
}

describe("explicit ancestry layout", () => {
  it("keeps the mother's mother on the maternal branch and connects her only to her own child", () => {
    const layout = ancestryLayout(family());
    const byPerson = (id: string) => layout.nodes.find(node => node.personId === id)!;
    const father = byPerson("father"), mother = byPerson("mother"), grandmother = byPerson("maternal-grandmother");
    expect(ancestryLayout(family()).rootPersonId).toBe("owner");
    expect(father.x + ANCESTRY_CARD_WIDTH / 2).toBeLessThan(0);
    expect(mother.x + ANCESTRY_CARD_WIDTH / 2).toBeGreaterThan(0);
    expect(grandmother.branch).toBe("maternal");
    expect(grandmother.path.map(step => step.personId)).toEqual(["mother", "maternal-grandmother"]);
    expect(layout.edges.find(edge => edge.source === grandmother.id)?.target).toBe(mother.id);
    expect(layout.edges.some(edge => edge.source === grandmother.id && edge.target === father.id)).toBe(false);
    expect(layout.unplacedPersonIds).toContain("unlinked");
  });

  it("uses directed claims rather than generation, input order or partner labels", () => {
    const data = family();
    data.relationships.push({ id: "partner", from: "unlinked", to: "father", kind: "partner", label: "Mother", status: "unresolved", sourceIds: [] });
    const original = ancestryLayout(data);
    const reversed = ancestryLayout({ ...data, people: [...data.people].reverse(), relationships: [...data.relationships].reverse() });
    expect(reversed).toEqual(original);
    expect(original.nodes.some(node => node.personId === "unlinked")).toBe(false);
    expect(original.nodes.find(node => node.personId === "owner")?.y).toBe(0);
    expect(original.nodes.find(node => node.personId === "father")?.y).toBe(-ANCESTRY_GENERATION_GAP);
  });

  it("does not wrap a wide generation or move paternal descendants into the maternal half", () => {
    const data = family();
    const previousFather = ancestryLayout(data).nodes.find(node => node.personId === "father");
    for (let i = 0; i < 6; i += 1) { const id = `paternal-${i}`; data.people.push(person(id)); data.relationships.push(parent(`claim-${i}`, id, "paternal-grandmother")); }
    const nodes = ancestryLayout(data).nodes;
    const row = nodes.filter(node => node.depth === 3);
    expect(row).toHaveLength(6);
    expect(new Set(row.map(node => node.y)).size).toBe(1);
    expect(new Set(row.map(node => node.x)).size).toBe(6);
    expect(nodes.filter(node => node.branch === "paternal").every(node => node.x + ANCESTRY_CARD_WIDTH < 0)).toBe(true);
    expect(nodes.find(node => node.personId === "father")?.x).toBe(previousFather?.x);
  });

  it("keeps shared ancestors as explicit occurrences and omits cycles without reparenting", () => {
    const data = family(); data.people.push(person("shared"));
    data.relationships.push(parent("shared-f", "shared", "father"), parent("shared-m", "shared", "mother"), parent("cycle", "owner", "shared"));
    const layout = ancestryLayout(data), shared = layout.nodes.filter(node => node.personId === "shared");
    expect(shared).toHaveLength(2); expect(shared.every(node => node.repeated)).toBe(true);
    expect(new Set(shared.map(node => node.branch))).toEqual(new Set(["paternal", "maternal"]));
    expect(layout.omittedCycleIds).toEqual(["cycle"]);
    expect(layout.nodes.filter(node => node.personId === "owner")).toHaveLength(1);
    expect(layout.edges.every(edge => layout.nodes.some(node => node.id === edge.source) && layout.nodes.some(node => node.id === edge.target))).toBe(true);
  });

  it("does not guess an owner or interpret untyped historical labels as parent claims", () => {
    const data = family(); delete data.owner.personId;
    expect(ancestryLayout(data).nodes).toEqual([]);
    data.owner.personId = "owner"; data.relationships.forEach(relation => { delete relation.kind; delete relation.parentRole; });
    expect(ancestryLayout(data).nodes.map(node => node.personId)).toEqual(["owner"]);
  });

  it("bounds repeated ancestry paths while retaining all people in the data", () => {
    const data = family(); data.people = [person("owner")]; data.relationships = [];
    let previous = ["owner"];
    for (let depth = 1; depth <= 12; depth += 1) {
      const next = [`level-${depth}-a`, `level-${depth}-b`];
      next.forEach(id => data.people.push(person(id)));
      previous.forEach(child => next.forEach((id, index) => data.relationships.push(parent(`${id}-${child}`, id, child, index ? "mother" : "father"))));
      previous = next;
    }
    const layout = ancestryLayout(data);
    expect(layout.truncated).toBe(true);
    expect(layout.nodes.length).toBeLessThanOrEqual(1000);
    expect(layout.nodes.every(node => node.depth <= 12)).toBe(true);
    expect(data.people).toHaveLength(25);
  });

  it("validates owner, role and geographic provenance without normalizing uncertain dates", () => {
    const data = family(); data.people[0].birthDate = "около 1900";
    data.sources = syntheticResearch().sources;
    data.people[0].placeFacts = [{ kind: "birth", place: "Учебная губерния", dateText: "около 1900", sourceIds: ["synthetic-source"], status: "single-source" }];
    expect(parseResearch(data).people[0].birthDate).toBe("около 1900");
    expect(() => parseResearch({ ...data, owner: { ...data.owner, personId: "missing" } })).toThrow("INVALID_RESEARCH");
    data.people[0].placeFacts[0].sourceIds = ["missing"]; expect(() => parseResearch(data)).toThrow("INVALID_RESEARCH");
    const invalid = family(); invalid.relationships[0].kind = "partner";
    expect(() => parseResearch(invalid)).toThrow("INVALID_RESEARCH");
  });
});
