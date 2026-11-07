import { z } from "zod";

export class PrivateCaseError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PrivateCaseError";
  }
}

export const privateId = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const brief = z.string().trim().min(1).max(1000);
const text = z.string().max(30000);
const timestamp = z.iso.datetime();
const sourceIds = z
  .array(privateId)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length);
const safeUrl = z
  .string()
  .max(3000)
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
  });

export const privateSourceSchema = z
  .object({
    id: privateId,
    title: brief,
    url: safeUrl,
    locator: text,
    excerpt: text,
    kind: z.enum(["user_tree", "record", "document"]),
    independenceGroup: privateId.optional(),
    observedAt: timestamp,
  })
  .strict();

export const proposalSchema = z
  .object({
    id: privateId,
    kind: z.enum(["research", "identity", "relationship", "correction"]),
    text: brief,
    rationale: text.min(1),
    sourceIds,
    evidenceStatus: z.enum(["hypothesis", "unresolved"]),
    workflowStatus: z.enum(["proposed", "accepted", "rejected"]),
  })
  .strict();

export const aiResultSchema = z
  .object({
    summary: text.min(1),
    observations: z
      .array(
        z.object({ text: text.min(1), sourceIds: sourceIds.min(1) }).strict(),
      )
      .max(100),
    gaps: z
      .array(z.object({ question: brief, why: text.min(1) }).strict())
      .max(100),
    nextSteps: z
      .array(
        z.object({ title: brief, detail: text.min(1), sourceIds }).strict(),
      )
      .max(100),
    proposals: z.array(proposalSchema).max(100),
  })
  .strict();

export const aiRunSchema = z
  .object({
    id: privateId,
    status: z.enum([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    mode: z.enum(["codex-session", "codex-cli"]),
    provider: brief,
    model: z.string().max(200).nullable(),
    methodology: z
      .object({
        name: brief,
        version: brief,
        commit: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict()
      .optional(),
    question: brief,
    sourceIds,
    startedAt: timestamp,
    completedAt: timestamp.nullable(),
    result: aiResultSchema.nullable(),
    resultDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    error: z.string().max(2000).nullable(),
  })
  .strict();

export const caseReviewSchema = z
  .object({
    id: privateId,
    runId: privateId,
    proposalId: privateId,
    decision: z.enum(["accepted", "rejected"]),
    reason: text.min(1),
    createdAt: timestamp,
  })
  .strict();

export const privateCaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: privateId,
    title: brief,
    revision: z.number().int().nonnegative(),
    updatedAt: timestamp,
    subject: z
      .object({
        personId: privateId,
        name: brief,
        dateText: z.string().max(1000),
        livingStatus: z.enum(["deceased", "unknown"]),
      })
      .strict(),
    sources: z.array(privateSourceSchema).max(100),
    known: z
      .array(
        z
          .object({
            id: privateId,
            text: text.min(1),
            sourceIds: sourceIds.min(1),
            status: z.enum(["tree_assertion", "supported", "unresolved"]),
          })
          .strict(),
      )
      .max(500),
    question: brief,
    notes: text,
    aiRuns: z.array(aiRunSchema).max(100),
    reviews: z.array(caseReviewSchema).max(1000),
  })
  .strict();

export type PrivateCase = z.infer<typeof privateCaseSchema>;
export type PrivateSource = z.infer<typeof privateSourceSchema>;
export type AIResult = z.infer<typeof aiResultSchema>;
export type AIRun = z.infer<typeof aiRunSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type CaseReview = z.infer<typeof caseReviewSchema>;

export function assertPrivateId(value: string): string {
  const result = privateId.safeParse(value);
  if (!result.success) throw new PrivateCaseError("INVALID_ID");
  return result.data;
}

export function parseAIResult(
  input: unknown,
  allowedSourceIds: readonly string[],
): AIResult {
  const parsed = aiResultSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("INVALID_AI_RESULT");
  const result = parsed.data;
  if (
    new Set(result.proposals.map((p) => p.id)).size !== result.proposals.length
  )
    throw new PrivateCaseError("DUPLICATE_ID");
  for (const item of [
    ...result.observations,
    ...result.nextSteps,
    ...result.proposals,
  ]) {
    if (item.sourceIds.some((id) => !allowedSourceIds.includes(id)))
      throw new PrivateCaseError("SOURCE_SCOPE_VIOLATION");
  }
  return result;
}

export function parsePrivateCase(input: unknown): PrivateCase {
  const parsed = privateCaseSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("INVALID_CASE");
  const value = parsed.data;
  const ids = [
    ...value.sources,
    ...value.known,
    ...value.aiRuns,
    ...value.reviews,
  ].map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new PrivateCaseError("DUPLICATE_ID");
  const allowed = value.sources.map((s) => s.id);
  for (const item of [...value.known, ...value.aiRuns]) {
    if (item.sourceIds.some((id) => !allowed.includes(id)))
      throw new PrivateCaseError("SOURCE_SCOPE_VIOLATION");
  }
  for (const known of value.known) {
    if (
      known.status === "supported" &&
      known.sourceIds.every(
        (id) => value.sources.find((s) => s.id === id)?.kind === "user_tree",
      )
    )
      throw new PrivateCaseError("TREE_IS_NOT_DOCUMENTARY_SUPPORT");
  }
  for (const run of value.aiRuns) {
    if (run.result) parseAIResult(run.result, run.sourceIds);
    if (
      run.status === "completed" &&
      (!run.result || !run.resultDigest || !run.completedAt)
    )
      throw new PrivateCaseError("INCOMPLETE_RUN");
    if (run.status !== "completed" && (run.result || run.resultDigest))
      throw new PrivateCaseError("UNFINISHED_RUN_HAS_RESULT");
    if (
      ["queued", "running"].includes(run.status) &&
      (run.completedAt || run.error)
    )
      throw new PrivateCaseError("ACTIVE_RUN_HAS_TERMINAL_DATA");
    if (run.status === "completed" && run.error)
      throw new PrivateCaseError("COMPLETED_RUN_HAS_ERROR");
    if (
      ["failed", "cancelled", "interrupted"].includes(run.status) &&
      !run.completedAt
    )
      throw new PrivateCaseError("INCOMPLETE_RUN");
  }
  for (const review of value.reviews) {
    const proposal = value.aiRuns
      .find((run) => run.id === review.runId)
      ?.result?.proposals.find((p) => p.id === review.proposalId);
    if (!proposal) throw new PrivateCaseError("INVALID_REVIEW_REFERENCE");
  }
  for (const run of value.aiRuns) {
    for (const proposal of run.result?.proposals || []) {
      const latest = value.reviews
        .filter((r) => r.runId === run.id && r.proposalId === proposal.id)
        .at(-1);
      if ((latest?.decision ?? "proposed") !== proposal.workflowStatus)
        throw new PrivateCaseError("REVIEW_RECORD_REQUIRED");
    }
  }
  return value;
}
