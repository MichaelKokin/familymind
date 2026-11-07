import type { SpaceComposition } from "./space-layout";

/** The guide proposes exactly one next step from saved data. It never claims a
 * search was performed and never invents facts; skipped steps stay skipped. */
export type GuideAction = "set_owner" | "add_first_person" | "add_parent" | "add_material" | "link_material" | "add_lead" | "review_find" | "lead_detail" | "ask_assistant";
export type GuideStep = { key: string; action: GuideAction; targetId: string | null; personName: string; detail: string };
export type GuideSelection = { kind: "person" | "material" | "find" | "lead"; id: string } | null;

export function guideCandidates(composition: SpaceComposition, selection: GuideSelection): GuideStep[] {
  const steps: GuideStep[] = [];
  const name = (id: string | null) => (id ? composition.people.find((person) => person.id === id)?.name ?? "" : "");
  const root = composition.people.find((person) => person.id === composition.rootPersonId);
  if (!root) steps.push({ key: "owner", action: "set_owner", targetId: null, personName: "", detail: "" });
  const pending = composition.finds.filter((find) => find.status === "candidate");
  const selectedPersonId = selection?.kind === "person" ? selection.id : null;
  const firstPending = pending.find((find) => !selectedPersonId || find.personIds.includes(selectedPersonId)) ?? pending[0];
  if (firstPending && selection?.kind !== "find") steps.push({ key: `review:${firstPending.id}`, action: "review_find", targetId: firstPending.id, personName: name(firstPending.personIds[0] ?? null), detail: firstPending.title });
  if (selection?.kind === "lead") {
    const lead = composition.leads.find((item) => item.id === selection.id);
    if (lead?.status === "needs_detail") steps.push({ key: `detail:${lead.id}`, action: "lead_detail", targetId: lead.id, personName: name(lead.personId), detail: lead.missingDetail });
  }
  if (selection?.kind === "material") {
    const material = composition.materials.find((item) => item.id === selection.id);
    if (material && !material.personIds.length) steps.push({ key: `material-link:${material.id}`, action: "link_material", targetId: material.id, personName: "", detail: material.title });
  }
  if (selection?.kind === "person") {
    const person = composition.people.find((item) => item.id === selection.id);
    if (person) {
      const hasParent = composition.relationships.some((relation) => relation.kind === "parent_child" && relation.to === person.id);
      if (!hasParent) steps.push({ key: `parent:${person.id}`, action: "add_parent", targetId: person.id, personName: person.name, detail: "" });
      const hasMaterial = composition.materials.some((material) => material.personIds.includes(person.id)) || (person.snapshot?.photoIds.length ?? 0) > 0;
      if (!hasMaterial) steps.push({ key: `material:${person.id}`, action: "add_material", targetId: person.id, personName: person.name, detail: "" });
      const hasLead = composition.leads.some((lead) => lead.personId === person.id && ["open", "needs_detail", "candidate"].includes(lead.status));
      if (!hasLead && (hasParent || hasMaterial)) steps.push({ key: `lead:${person.id}`, action: "add_lead", targetId: person.id, personName: person.name, detail: "" });
      steps.push({ key: `ask:${person.id}`, action: "ask_assistant", targetId: person.id, personName: person.name, detail: "" });
    }
  }
  if (root) {
    const others = composition.people.filter((person) => person.id !== root.id);
    if (!others.length) steps.push({ key: "first-person", action: "add_first_person", targetId: root.id, personName: root.name, detail: "" });
    else if (!composition.materials.length) steps.push({ key: "first-material", action: "add_material", targetId: root.id, personName: root.name, detail: "" });
    else if (!composition.leads.length) steps.push({ key: "first-lead", action: "add_lead", targetId: root.id, personName: root.name, detail: "" });
  }
  return steps;
}

export function suggestNextStep(composition: SpaceComposition, selection: GuideSelection, dismissed: readonly string[]): GuideStep | null {
  const skipped = new Set(dismissed);
  return guideCandidates(composition, selection).find((step) => !skipped.has(step.key)) ?? null;
}
