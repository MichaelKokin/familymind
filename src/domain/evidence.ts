import {
  DomainError,
  independentSupportCount,
  newId,
  parseWorkspace,
  type Workspace,
  type ReviewDecision,
} from "./model";

export function evidenceSummary(workspace: Workspace, targetId: string) {
  const links = workspace.evidence.filter((e) => e.targetId === targetId);
  const supports = links.filter((e) => e.polarity === "supports");
  const independentCount = independentSupportCount(workspace, targetId);
  return {
    independentCount,
    supports,
    contradicts: links.filter((e) => e.polarity === "contradicts"),
    leads: links.filter((e) => e.polarity === "lead"),
    duplicateCount: Math.max(0, supports.length - independentCount),
  };
}

export function findConflicts(workspace: Workspace) {
  const groups = new Map<
    string,
    {
      personId: string;
      predicate: string;
      claimIds: string[];
      values: string[];
    }
  >();
  for (const c of workspace.claims) {
    const key = `${c.personId}\u0000${c.predicate}`;
    const group = groups.get(key) ?? {
      personId: c.personId,
      predicate: c.predicate,
      claimIds: [],
      values: [],
    };
    group.claimIds.push(c.id);
    if (!group.values.includes(c.value)) group.values.push(c.value);
    groups.set(key, group);
  }
  return [...groups.values()].filter((g) => g.values.length > 1);
}

export function reviewProposal(
  workspace: Workspace,
  targetId: string,
  decision: ReviewDecision["decision"],
  reason: string,
): Workspace {
  if (!reason.trim()) throw new DomainError("REVIEW_REASON_REQUIRED");
  const target = [...workspace.claims, ...workspace.relationships].find(
    (t) => t.id === targetId,
  );
  if (!target) throw new DomainError("DANGLING_REFERENCE");
  return parseWorkspace({
    ...workspace,
    claims: workspace.claims.map((c) =>
      c.id === targetId ? { ...c, workflowStatus: decision } : c,
    ),
    relationships: workspace.relationships.map((r) =>
      r.id === targetId ? { ...r, workflowStatus: decision } : r,
    ),
    reviews: [
      ...workspace.reviews,
      {
        id: newId("review"),
        targetId,
        decision,
        reason: reason.trim(),
        reviewer: "local-demo-user",
        createdAt: new Date().toISOString(),
        evidenceStatusAtDecision: target.evidenceStatus,
      },
    ],
  });
}
