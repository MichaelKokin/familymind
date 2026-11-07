import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
const short = z.string().max(1000);
const text = z.string().max(20000);
const name = z.string().trim().min(1).max(300);
export const evidenceStatusSchema = z.enum([
  "hypothesis",
  "single-source",
  "corroborated",
  "strongly-corroborated",
  "contradicted",
  "unresolved",
]);
export const workflowStatusSchema = z.enum([
  "proposed",
  "accepted",
  "rejected",
  "needs_review",
]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
const synthetic = z.literal(true);
const personSchema = z
  .object({
    id,
    name,
    variants: z.array(short).max(100),
    dateText: short,
    calendar: z.enum(["unknown", "gregorian", "julian"]),
    livingStatus: z.enum(["living", "deceased", "unknown"]),
    notes: text,
    synthetic,
  })
  .strict();
const sourceSchema = z
  .object({
    id,
    title: name,
    citation: text,
    url: z
      .string()
      .max(2000)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "URL_PROTOCOL"),
    originalId: id,
    notes: text,
    synthetic,
  })
  .strict();
export const allowedMimeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/plain",
]);
const artifactSchema = z
  .object({
    id,
    sourceId: id,
    name,
    mime: allowedMimeSchema,
    size: z
      .number()
      .int()
      .min(0)
      .max(5 * 1024 * 1024),
    dataUrl: z
      .string()
      .max(7 * 1024 * 1024)
      .nullable(),
    transcription: text,
    exportAllowed: z.boolean(),
    synthetic,
  })
  .strict();
const evidenceFields = {
  evidenceStatus: evidenceStatusSchema,
  rationale: text,
  workflowStatus: workflowStatusSchema,
  alternativesReviewed: z.boolean(),
  synthetic,
};
const claimSchema = z
  .object({ id, personId: id, predicate: name, value: name, ...evidenceFields })
  .strict();
const relationshipSchema = z
  .object({
    id,
    fromPersonId: id,
    toPersonId: id,
    kind: z.enum(["parent", "spouse", "adoptive", "guardian"]),
    ...evidenceFields,
  })
  .strict();
const evidenceSchema = z
  .object({
    id,
    targetId: id,
    sourceId: id,
    artifactId: id.nullable(),
    polarity: z.enum(["supports", "contradicts", "lead"]),
    locator: short,
    excerpt: text,
    independenceGroup: id,
    rationale: text,
    direct: z.boolean(),
  })
  .strict();
const reviewSchema = z
  .object({
    id,
    targetId: id,
    decision: z.enum(["accepted", "rejected", "needs_review"]),
    reason: z.string().trim().min(1).max(20000),
    reviewer: name,
    createdAt: z.iso.datetime(),
    evidenceStatusAtDecision: evidenceStatusSchema,
  })
  .strict();
const questionSchema = z
  .object({
    id,
    personId: id.nullable(),
    question: name,
    known: text,
    place: short,
    period: short,
    plan: text,
    status: z.enum(["open", "in_progress", "resolved"]),
    sourceIds: z.array(id).max(500),
    outcome: text,
    limitations: text,
    archivistDraft: text,
    synthetic,
  })
  .strict();
const runSchema = z
  .object({
    id,
    questionId: id,
    mode: z.enum(["manual", "demo"]),
    action: name,
    coverage: text,
    outcome: z.enum(["found", "not_found", "blocked", "pending"]),
    notes: text,
    sourceIds: z.array(id).max(500),
    createdAt: z.iso.datetime(),
  })
  .strict();

const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    title: name,
    synthetic,
    revision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
    people: z.array(personSchema).max(500),
    sources: z.array(sourceSchema).max(500),
    artifacts: z.array(artifactSchema).max(500),
    claims: z.array(claimSchema).max(2000),
    relationships: z.array(relationshipSchema).max(2000),
    evidence: z.array(evidenceSchema).max(5000),
    reviews: z.array(reviewSchema).max(5000),
    questions: z.array(questionSchema).max(500),
    runs: z.array(runSchema).max(2000),
    positions: z.record(
      id,
      z
        .object({
          x: z.number().finite().min(-100000).max(100000),
          y: z.number().finite().min(-100000).max(100000),
        })
        .strict(),
    ),
  })
  .strict();

export type Person = z.infer<typeof personSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type RelationshipClaim = z.infer<typeof relationshipSchema>;
export type EvidenceLink = z.infer<typeof evidenceSchema>;
export type ReviewDecision = z.infer<typeof reviewSchema>;
export type ResearchQuestion = z.infer<typeof questionSchema>;
export type ResearchRun = z.infer<typeof runSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type AllowedMime = z.infer<typeof allowedMimeSchema>;

export class DomainError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "DomainError";
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Chain identity is claim-specific, but copies of one original always collapse. */
export function independentSupportCount(
  workspace: Workspace,
  targetId: string,
): number {
  const links = workspace.evidence.filter(
    (e) => e.targetId === targetId && e.polarity === "supports",
  );
  const parents = new Map<string, string>();
  const root = (key: string): string => {
    const p = parents.get(key);
    if (!p) {
      parents.set(key, key);
      return key;
    }
    return p === key ? key : root(p);
  };
  for (const link of links) {
    const original = workspace.sources.find(
      (s) => s.id === link.sourceId,
    )?.originalId;
    if (original)
      parents.set(
        root(`group:${link.independenceGroup.toLowerCase()}`),
        root(`original:${original}`),
      );
  }
  return new Set(
    links.map((e) => root(`group:${e.independenceGroup.toLowerCase()}`)),
  ).size;
}

export function parseWorkspace(input: unknown): Workspace {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_SCHEMA");
  const w = parsed.data;
  const collections = [
    w.people,
    w.sources,
    w.artifacts,
    w.claims,
    w.relationships,
    w.evidence,
    w.reviews,
    w.questions,
    w.runs,
  ];
  const allIds = collections.flatMap((items) => items.map((item) => item.id));
  if (new Set(allIds).size !== allIds.length)
    throw new DomainError("DUPLICATE_ID");
  const has = (items: { id: string }[], candidate: string) =>
    items.some((item) => item.id === candidate);
  const requireRef = (ok: boolean) => {
    if (!ok) throw new DomainError("DANGLING_REFERENCE");
  };
  const targets = [...w.claims, ...w.relationships];
  for (const a of w.artifacts) requireRef(has(w.sources, a.sourceId));
  for (const c of w.claims) requireRef(has(w.people, c.personId));
  for (const r of w.relationships) {
    requireRef(has(w.people, r.fromPersonId) && has(w.people, r.toPersonId));
    if (r.fromPersonId === r.toPersonId)
      throw new DomainError("SELF_RELATIONSHIP");
  }
  for (const e of w.evidence) {
    requireRef(has(targets, e.targetId) && has(w.sources, e.sourceId));
    if (e.artifactId)
      requireRef(
        w.artifacts.some(
          (a) => a.id === e.artifactId && a.sourceId === e.sourceId,
        ),
      );
    if (
      e.polarity !== "lead" &&
      (!e.locator.trim() || !e.excerpt.trim() || !e.rationale.trim())
    )
      throw new DomainError("EVIDENCE_CONTEXT_REQUIRED");
  }
  for (const r of w.reviews) requireRef(has(targets, r.targetId));
  for (const q of w.questions) {
    if (q.personId) requireRef(has(w.people, q.personId));
    for (const sourceId of q.sourceIds) requireRef(has(w.sources, sourceId));
    if (q.status === "resolved" && (!q.outcome.trim() || !q.limitations.trim()))
      throw new DomainError("RESEARCH_RESULT_REQUIRED");
  }
  for (const r of w.runs) {
    requireRef(has(w.questions, r.questionId));
    for (const sourceId of r.sourceIds) requireRef(has(w.sources, sourceId));
    if (r.outcome === "not_found" && !r.coverage.trim())
      throw new DomainError("SEARCH_COVERAGE_REQUIRED");
    if (r.outcome === "found" && r.sourceIds.length === 0)
      throw new DomainError("FINDING_SOURCE_REQUIRED");
  }
  const canvasEntities = [
    ...w.people,
    ...w.sources,
    ...w.claims,
    ...w.relationships,
    ...w.questions,
  ];
  for (const key of Object.keys(w.positions))
    requireRef(has(canvasEntities, key));
  for (const target of targets) {
    if (
      target.workflowStatus === "accepted" ||
      target.workflowStatus === "rejected"
    ) {
      const latestReview = w.reviews
        .filter((r) => r.targetId === target.id)
        .at(-1);
      if (!latestReview || latestReview.decision !== target.workflowStatus)
        throw new DomainError("REVIEW_RECORD_REQUIRED");
    }
    const links = w.evidence.filter((e) => e.targetId === target.id);
    const count = independentSupportCount(w, target.id);
    if (target.evidenceStatus === "single-source" && count < 1)
      throw new DomainError("SUPPORT_REQUIRED");
    if (
      target.evidenceStatus === "corroborated" ||
      target.evidenceStatus === "strongly-corroborated"
    ) {
      const conflictingClaim =
        "personId" in target &&
        w.claims.some(
          (c) =>
            c.id !== target.id &&
            c.personId === target.personId &&
            c.predicate === target.predicate &&
            c.value !== target.value &&
            c.workflowStatus !== "rejected",
        );
      if (
        count < 2 ||
        links.some((e) => e.polarity === "contradicts") ||
        conflictingClaim ||
        !target.rationale.trim()
      )
        throw new DomainError("CORROBORATION_REQUIREMENTS");
    }
    if (
      target.evidenceStatus === "strongly-corroborated" &&
      (!target.alternativesReviewed ||
        !links.some((e) => e.direct && e.polarity === "supports"))
    )
      throw new DomainError("STRONG_CORROBORATION_REQUIREMENTS");
  }
  return w;
}
