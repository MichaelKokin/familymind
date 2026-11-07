import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  assertPrivateId,
  parseAIResult,
  parsePrivateCase,
  PrivateCaseError,
  type PrivateCase,
} from "./model";

export const DEFAULT_PRIVATE_ROOT = path.join(
  homedir(),
  "Library",
  "Application Support",
  "FamilyMind",
  "private-cases",
);
export const MAX_PRIVATE_CASE_BYTES = 4 * 1024 * 1024;

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function ensurePrivateDir(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new PrivateCaseError("UNSAFE_STORAGE_PATH");
  await fs.chmod(directory, 0o700);
}

export async function ensurePrivateRoot(root: string): Promise<void> {
  if (!path.isAbsolute(root)) throw new PrivateCaseError("UNSAFE_STORAGE_PATH");
  await ensurePrivateDir(root);
  const [actual, checkout] = await Promise.all([
    fs.realpath(root),
    fs.realpath(process.cwd()),
  ]);
  if (actual === checkout || actual.startsWith(`${checkout}${path.sep}`))
    throw new PrivateCaseError("PRIVATE_DATA_IN_CHECKOUT");
}

export async function readPrivateJson(file: string): Promise<unknown | null> {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw new PrivateCaseError("STORAGE_READ_FAILED");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PRIVATE_CASE_BYTES)
      throw new PrivateCaseError("INVALID_STORED_DATA");
    try {
      return JSON.parse(await handle.readFile("utf8"));
    } catch {
      throw new PrivateCaseError("INVALID_STORED_DATA");
    }
  } finally {
    await handle.close();
  }
}

export async function writePrivateJson(
  file: string,
  value: unknown,
): Promise<void> {
  const data = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(data) > MAX_PRIVATE_CASE_BYTES)
    throw new PrivateCaseError("CASE_TOO_LARGE");
  const directory = path.dirname(file);
  await ensurePrivateDir(directory);
  const temp = path.join(directory, `.write-${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, file);
    renamed = true;
  } finally {
    if (!renamed) await fs.unlink(temp).catch(() => undefined);
  }
  const parent = await fs.open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

// Review changes workflow only. Hash the original proposed payload so a later
// export still detects edits to the AI's observations, rationale or evidence.
function resultDigest(
  result: NonNullable<PrivateCase["aiRuns"][number]["result"]>,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...result,
        proposals: result.proposals.map((proposal) => ({
          ...proposal,
          workflowStatus: "proposed",
        })),
      }),
    )
    .digest("hex");
}

function assertResultDigests(value: PrivateCase): void {
  for (const run of value.aiRuns) {
    if (run.result && run.resultDigest !== resultDigest(run.result))
      throw new PrivateCaseError("RESULT_DIGEST_MISMATCH");
  }
}

function assertHistoryPreserved(current: PrivateCase, next: PrivateCase): void {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  for (const source of current.sources) {
    if (
      !same(
        source,
        next.sources.find((item) => item.id === source.id),
      )
    )
      throw new PrivateCaseError("ORIGINAL_SOURCE_IMMUTABLE");
  }
  if (!same(current.reviews, next.reviews.slice(0, current.reviews.length)))
    throw new PrivateCaseError("REVIEW_HISTORY_IMMUTABLE");
  for (const run of current.aiRuns) {
    const replacement = next.aiRuns.find((item) => item.id === run.id);
    if (!replacement) throw new PrivateCaseError("RUN_HISTORY_IMMUTABLE");
    // Runs retain the exact selection/question submitted to the model.
    const metadata = (item: typeof run) => ({
      id: item.id,
      mode: item.mode,
      provider: item.provider,
      model: item.model,
      methodology: item.methodology,
      question: item.question,
      sourceIds: item.sourceIds,
      startedAt: item.startedAt,
    });
    if (!same(metadata(run), metadata(replacement)))
      throw new PrivateCaseError("RUN_HISTORY_IMMUTABLE");
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(run.status)
    ) {
      const withoutWorkflow = (item: typeof run) => ({
        ...item,
        result: item.result
          ? {
              ...item.result,
              proposals: item.result.proposals.map((p) => ({
                ...p,
                workflowStatus: "proposed",
              })),
            }
          : null,
      });
      if (!same(withoutWorkflow(run), withoutWorkflow(replacement)))
        throw new PrivateCaseError("RUN_HISTORY_IMMUTABLE");
    }
    if (run.status === "running" && replacement.status === "queued")
      throw new PrivateCaseError("INVALID_RUN_TRANSITION");
  }
}

/** Cross-process exclusion: stale locks fail closed, never guessed away. */
export async function withPrivateLock<T>(
  directory: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensurePrivateDir(directory);
  const filename = path.join(directory, `.${assertPrivateId(key)}.lock`);
  let lock;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      lock = await fs.open(filename, "wx", 0o600);
      break;
    } catch (error) {
      if (!isErrno(error, "EEXIST"))
        throw new PrivateCaseError("STORAGE_WRITE_FAILED");
      if (attempt === 99) throw new PrivateCaseError("STORE_BUSY");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!lock) throw new PrivateCaseError("STORE_BUSY");
  try {
    return await fn();
  } finally {
    await lock.close();
    await fs.unlink(filename);
  }
}

export class PrivateCaseStore {
  readonly root: string;
  constructor(root = DEFAULT_PRIVATE_ROOT) {
    if (!path.isAbsolute(root)) throw new PrivateCaseError("UNSAFE_STORAGE_PATH");
    this.root = root;
  }
  private casePath(caseId: string) {
    return path.join(this.root, "cases", `${assertPrivateId(caseId)}.json`);
  }
  private async prepare() {
    await ensurePrivateRoot(this.root);
    await ensurePrivateDir(path.join(this.root, "cases"));
  }

  async load(caseId: string): Promise<PrivateCase | null> {
    const filename = this.casePath(caseId);
    await this.prepare();
    const raw = await readPrivateJson(filename);
    if (raw === null) return null;
    const value = parsePrivateCase(raw);
    if (value.id !== caseId) throw new PrivateCaseError("CASE_ID_MISMATCH");
    assertResultDigests(value);
    return value;
  }

  async save(
    input: PrivateCase,
    expectedRevision: number | null,
  ): Promise<PrivateCase> {
    const value = parsePrivateCase(input);
    assertResultDigests(value);
    await this.prepare();
    return withPrivateLock(
      path.join(this.root, "cases"),
      value.id,
      async () => {
        const current = await this.load(value.id);
        if ((current?.revision ?? null) !== expectedRevision)
          throw new PrivateCaseError("STALE_REVISION");
        if (current) assertHistoryPreserved(current, value);
        const saved = parsePrivateCase({
          ...value,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
        // A failed write leaves the current case intact; backup is the prior whole revision.
        if (current) {
          await ensurePrivateDir(path.join(this.root, "backups"));
          await writePrivateJson(
            path.join(
              this.root,
              "backups",
              value.id,
              `${current.revision}.json`,
            ),
            current,
          );
        }
        await writePrivateJson(this.casePath(value.id), saved);
        return saved;
      },
    );
  }

  async completeRun(
    caseId: string,
    runId: string,
    input: unknown,
  ): Promise<PrivateCase> {
    const value = await this.load(caseId);
    if (!value) throw new PrivateCaseError("CASE_NOT_FOUND");
    const run = value.aiRuns.find((r) => r.id === runId);
    if (!run) throw new PrivateCaseError("RUN_NOT_FOUND");
    const result = parseAIResult(input, run.sourceIds);
    if (result.proposals.some((p) => p.workflowStatus !== "proposed"))
      throw new PrivateCaseError("AI_CANNOT_REVIEW_ITSELF");
    const digest = resultDigest(result);
    if (run.status === "completed") {
      if (run.resultDigest === digest) return value;
      throw new PrivateCaseError("RUN_ALREADY_COMPLETED");
    }
    if (!["queued", "running"].includes(run.status))
      throw new PrivateCaseError("RUN_NOT_ACTIVE");
    const updated = {
      ...value,
      aiRuns: value.aiRuns.map((r) =>
        r.id === runId
          ? {
              ...r,
              status: "completed" as const,
              completedAt: new Date().toISOString(),
              result,
              resultDigest: digest,
              error: null,
            }
          : r,
      ),
    };
    return this.save(updated, value.revision);
  }

  async applyReview(
    caseId: string,
    input: {
      expectedRevision: number;
      runId: string;
      proposalId: string;
      decision: "accepted" | "rejected";
      reason: string;
    },
  ): Promise<PrivateCase> {
    const value = await this.load(caseId);
    if (!value) throw new PrivateCaseError("CASE_NOT_FOUND");
    if (value.revision !== input.expectedRevision)
      throw new PrivateCaseError("STALE_REVISION");
    const run = value.aiRuns.find((item) => item.id === input.runId);
    const proposal = run?.result?.proposals.find(
      (item) => item.id === input.proposalId,
    );
    if (!proposal || !run?.result)
      throw new PrivateCaseError("INVALID_REVIEW_REFERENCE");
    if (
      !["accepted", "rejected"].includes(input.decision) ||
      !input.reason.trim()
    )
      throw new PrivateCaseError("REVIEW_REASON_REQUIRED");
    const updated = {
      ...value,
      aiRuns: value.aiRuns.map((item) =>
        item.id === input.runId && item.result
          ? {
              ...item,
              result: {
                ...item.result,
                proposals: item.result.proposals.map((p) =>
                  p.id === input.proposalId
                    ? { ...p, workflowStatus: input.decision }
                    : p,
                ),
              },
            }
          : item,
      ),
      reviews: [
        ...value.reviews,
        {
          id: `review_${randomUUID()}`,
          runId: input.runId,
          proposalId: input.proposalId,
          decision: input.decision,
          reason: input.reason.trim(),
          createdAt: new Date().toISOString(),
        },
      ],
    };
    return this.save(updated, input.expectedRevision);
  }

  /** Call only at an explicit process-recovery boundary, not on ordinary reads. */
  async recoverInterruptedRuns(caseId: string): Promise<PrivateCase | null> {
    const value = await this.load(caseId);
    if (
      !value ||
      !value.aiRuns.some((r) => ["queued", "running"].includes(r.status))
    )
      return value;
    return this.save(
      {
        ...value,
        aiRuns: value.aiRuns.map((r) =>
          ["queued", "running"].includes(r.status)
            ? {
                ...r,
                status: "interrupted",
                completedAt: new Date().toISOString(),
                error: "PROCESS_RESTARTED",
              }
            : r,
        ),
      },
      value.revision,
    );
  }
}
