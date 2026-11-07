import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseAIResult,
  parsePrivateCase,
  type AIResult,
  type PrivateCase,
} from "../src/private-case/model";
import { PrivateCaseStore } from "../src/private-case/server-store";
import {
  assertLocalRequest,
  LocalCaseAccess,
  SESSION_COOKIE,
  sessionCookie,
} from "../src/private-case/access";

const now = "2026-11-06T00:00:00.000Z";
it("accepts Next's internal localhost URL only behind the exact loopback Host", () => {
  expect(() => assertLocalRequest(new Request("http://localhost:3000/api/private/case", { headers: { host: "127.0.0.1:3000" } }))).not.toThrow();
  expect(() => assertLocalRequest(new Request("http://localhost:3000/api/private/case", { headers: { host: "attacker.test:3000" } }))).toThrow("HOST_FORBIDDEN");
  expect(() => assertLocalRequest(new Request("http://localhost:3000/api/private/case", { headers: { host: "127.0.0.1:3000", origin: "http://attacker.test" } }))).toThrow("ORIGIN_FORBIDDEN");
});
export function syntheticPrivateCase(id = "case_synthetic"): PrivateCase {
  return {
    schemaVersion: 1,
    id,
    title: "SYNTHETIC · учебное исследование",
    revision: 0,
    updatedAt: now,
    subject: {
      personId: "person_synthetic",
      name: "Анна Синтетическая",
      dateText: "около 1900",
      livingStatus: "deceased",
    },
    sources: [
      {
        id: "source_tree",
        title: "Искусственная карточка",
        url: "https://example.test/tree",
        locator: "Учебная карточка 1",
        excerpt: "Полностью вымышленный человек; около 1900 года.",
        kind: "user_tree",
        observedAt: now,
      },
    ],
    known: [
      {
        id: "known_birth",
        text: "В искусственной карточке указан приблизительный год.",
        sourceIds: ["source_tree"],
        status: "tree_assertion",
      },
    ],
    question: "Как проверить приблизительный год по первоисточнику?",
    notes: "Только synthetic fixture, не настоящая семья.",
    aiRuns: [
      {
        id: "run_synthetic",
        status: "running",
        mode: "codex-session",
        provider: "synthetic-test",
        model: null,
        question: "Какие данные требуют проверки?",
        sourceIds: ["source_tree"],
        startedAt: now,
        completedAt: null,
        result: null,
        resultDigest: null,
        error: null,
      },
    ],
    reviews: [],
  };
}
export function syntheticAIResult(): AIResult {
  return {
    summary:
      "Синтетическая проверка: исходная карточка не является архивным подтверждением.",
    observations: [
      { text: "Год приблизительный.", sourceIds: ["source_tree"] },
    ],
    gaps: [
      {
        question: "Где первичная запись?",
        why: "Дерево содержит утверждение без приложенного документа.",
      },
    ],
    nextSteps: [
      {
        title: "Найти исходную запись",
        detail:
          "Сначала установить место; не делать внешний запрос по догадке.",
        sourceIds: ["source_tree"],
      },
    ],
    proposals: [
      {
        id: "proposal_source",
        kind: "research",
        text: "Запросить происхождение даты",
        rationale: "Нужен проверяемый источник.",
        sourceIds: ["source_tree"],
        evidenceStatus: "hypothesis",
        workflowStatus: "proposed",
      },
    ],
  };
}
function request(
  method = "GET",
  token?: string,
  headers: Record<string, string> = {},
) {
  return new Request("http://127.0.0.1:3000/api/private/case", {
    method,
    headers: {
      host: "127.0.0.1:3000",
      ...(method === "GET" ? {} : { origin: "http://127.0.0.1:3000" }),
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...headers,
    },
  });
}
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "family-mind-private-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("private case model", () => {
  it("keeps source assertions distinct and rejects invented source references", () => {
    const value = syntheticPrivateCase();
    expect(parsePrivateCase(value).subject.dateText).toBe("около 1900");
    value.known[0].status = "supported";
    expect(() => parsePrivateCase(value)).toThrow(
      "TREE_IS_NOT_DOCUMENTARY_SUPPORT",
    );
    const result = syntheticAIResult();
    result.observations[0].sourceIds = ["unread_source"];
    expect(() => parseAIResult(result, ["source_tree"])).toThrow(
      "SOURCE_SCOPE_VIOLATION",
    );
  });
  it("rejects invented certainty, unknown modes and malformed IDs", () => {
    const result = syntheticAIResult();
    expect(() =>
      parseAIResult({ ...result, confidence: 0.99 }, ["source_tree"]),
    ).toThrow("INVALID_AI_RESULT");
    expect(() =>
      parseAIResult(
        {
          ...result,
          proposals: [
            { ...result.proposals[0], evidenceStatus: "corroborated" },
          ],
        },
        ["source_tree"],
      ),
    ).toThrow("INVALID_AI_RESULT");
    expect(() =>
      parsePrivateCase({ ...syntheticPrivateCase(), id: "../escape" }),
    ).toThrow("INVALID_CASE");
    const value = syntheticPrivateCase();
    expect(() =>
      parsePrivateCase({
        ...value,
        aiRuns: [{ ...value.aiRuns[0], mode: "fake-online" }],
      }),
    ).toThrow("INVALID_CASE");
  });
});

describe("private filesystem store", () => {
  it("persists with private permissions, CAS and exact prior-revision backup", async () => {
    const store = new PrivateCaseStore(directory);
    const first = await store.save(syntheticPrivateCase(), null);
    const second = await store.save(
      { ...first, notes: "Synthetic edit" },
      first.revision,
    );
    expect(second.revision).toBe(2);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(path.join(directory, "cases", `${first.id}.json`))).mode &
        0o777,
    ).toBe(0o600);
    expect(
      JSON.parse(
        await readFile(
          path.join(directory, "backups", first.id, "1.json"),
          "utf8",
        ),
      ),
    ).toEqual(first);
    await expect(
      store.save({ ...first, notes: "stale" }, first.revision),
    ).rejects.toThrow("STALE_REVISION");
    expect(await new PrivateCaseStore(directory).load(first.id)).toEqual(
      second,
    );
  });
  it("serializes competing writers without lost changes", async () => {
    const store = new PrivateCaseStore(directory);
    const first = await store.save(syntheticPrivateCase(), null);
    const results = await Promise.allSettled([
      store.save({ ...first, notes: "A" }, first.revision),
      new PrivateCaseStore(directory).save(
        { ...first, notes: "B" },
        first.revision,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.load(first.id))?.revision).toBe(2);
  });
  it("invalid import and traversal never overwrite or read another file", async () => {
    const store = new PrivateCaseStore(directory);
    const first = await store.save(syntheticPrivateCase(), null);
    await expect(store.load("../escape")).rejects.toThrow("INVALID_ID");
    await expect(
      store.save(
        { ...first, known: [{ ...first.known[0], sourceIds: ["missing"] }] },
        first.revision,
      ),
    ).rejects.toThrow("SOURCE_SCOPE_VIOLATION");
    expect(await store.load(first.id)).toEqual(first);
    await symlink(
      path.join(directory, "cases", `${first.id}.json`),
      path.join(directory, "cases", "alias.json"),
    );
    await expect(store.load("alias")).rejects.toThrow("STORAGE_READ_FAILED");
  });
  it("completes real-result-shaped imports idempotently and reviews without changing evidence", async () => {
    const store = new PrivateCaseStore(directory);
    const first = await store.save(syntheticPrivateCase(), null);
    const result = syntheticAIResult();
    const completed = await store.completeRun(
      first.id,
      "run_synthetic",
      result,
    );
    expect(completed.aiRuns[0].status).toBe("completed");
    expect(completed.aiRuns[0].resultDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await store.completeRun(first.id, "run_synthetic", result)).toEqual(
      completed,
    );
    await expect(
      store.completeRun(first.id, "run_synthetic", {
        ...result,
        summary: "Different result",
      }),
    ).rejects.toThrow("RUN_ALREADY_COMPLETED");
    const reviewed = await store.applyReview(first.id, {
      expectedRevision: completed.revision,
      runId: "run_synthetic",
      proposalId: "proposal_source",
      decision: "accepted",
      reason: "Keep as a question.",
    });
    expect(reviewed.aiRuns[0].result?.proposals[0].workflowStatus).toBe(
      "accepted",
    );
    expect(reviewed.aiRuns[0].result?.proposals[0].evidenceStatus).toBe(
      "hypothesis",
    );
    expect(reviewed.known).toEqual(first.known);
    expect(reviewed.reviews).toHaveLength(1);
    expect(await store.completeRun(first.id, "run_synthetic", result)).toEqual(
      reviewed,
    );
  });
  it("refuses self-approved AI proposals and records interrupted jobs honestly", async () => {
    const store = new PrivateCaseStore(directory);
    const first = await store.save(syntheticPrivateCase(), null);
    const result = syntheticAIResult();
    result.proposals[0].workflowStatus = "accepted";
    await expect(
      store.completeRun(first.id, "run_synthetic", result),
    ).rejects.toThrow("AI_CANNOT_REVIEW_ITSELF");
    const recovered = await store.recoverInterruptedRuns(first.id);
    expect(recovered?.aiRuns[0].status).toBe("interrupted");
    expect(recovered?.aiRuns[0].result).toBeNull();
    expect(await store.recoverInterruptedRuns(first.id)).toEqual(recovered);
    await expect(
      store.completeRun(first.id, "run_synthetic", syntheticAIResult()),
    ).rejects.toThrow("RUN_NOT_ACTIVE");
  });
  it("preserves originals, run payloads and review history during snapshot imports", async () => {
    const store = new PrivateCaseStore(directory);
    const first = await store.save(syntheticPrivateCase(), null);
    await expect(
      store.save(
        {
          ...first,
          sources: [{ ...first.sources[0], excerpt: "Overwritten original" }],
        },
        first.revision,
      ),
    ).rejects.toThrow("ORIGINAL_SOURCE_IMMUTABLE");
    const completed = await store.completeRun(
      first.id,
      "run_synthetic",
      syntheticAIResult(),
    );
    const tampered = structuredClone(completed);
    tampered.aiRuns[0].result!.summary = "Tampered result";
    await expect(store.save(tampered, completed.revision)).rejects.toThrow(
      "RESULT_DIGEST_MISMATCH",
    );
    const reviewed = await store.applyReview(first.id, {
      expectedRevision: completed.revision,
      runId: "run_synthetic",
      proposalId: "proposal_source",
      decision: "rejected",
      reason: "Need a stronger proposal",
    });
    await expect(store.save(completed, reviewed.revision)).rejects.toThrow(
      "REVIEW_HISTORY_IMMUTABLE",
    );
    const resetWorkflow = structuredClone(reviewed);
    resetWorkflow.aiRuns[0].result!.proposals[0].workflowStatus = "proposed";
    await expect(store.save(resetWorkflow, reviewed.revision)).rejects.toThrow(
      "REVIEW_RECORD_REQUIRED",
    );
    expect(await store.load(first.id)).toEqual(reviewed);
  });
  it("refuses backup-directory symlinks and leaves the last revision readable", async () => {
    const root = path.join(directory, "private");
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    const store = new PrivateCaseStore(root);
    const first = await store.save(syntheticPrivateCase(), null);
    await symlink(outside, path.join(root, "backups"));
    await expect(
      store.save({ ...first, notes: "Blocked edit" }, first.revision),
    ).rejects.toThrow("UNSAFE_STORAGE_PATH");
    expect(await store.load(first.id)).toEqual(first);
  });
});

describe("local owner session", () => {
  it("requires a session, exchanges capability once, and stores no raw credentials", async () => {
    const access = new LocalCaseAccess(directory);
    await expect(access.require(request())).rejects.toThrow("UNAUTHORIZED");
    const bootstrap = await access.createBootstrap("case_one");
    const session = await access.exchange(request("POST"), bootstrap.token);
    await expect(
      access.exchange(request("POST"), bootstrap.token),
    ).rejects.toThrow("UNAUTHORIZED");
    expect(
      (await access.require(request("GET", session.token), "case_one")).caseId,
    ).toBe("case_one");
    await expect(
      access.require(request("GET", session.token), "case_two"),
    ).rejects.toThrow("CASE_FORBIDDEN");
    const disk = await readFile(
      path.join(directory, "auth", "sessions.json"),
      "utf8",
    );
    expect(disk).not.toContain(bootstrap.token);
    expect(disk).not.toContain(session.token);
    expect(
      (await stat(path.join(directory, "auth", "sessions.json"))).mode & 0o777,
    ).toBe(0o600);
    expect(sessionCookie(session.token, session.expiresAt)).toContain(
      "HttpOnly; SameSite=Strict; Path=/api/private",
    );
  });
  it("enforces exact host, mutation origin, and cross-site read refusal", () => {
    expect(() =>
      assertLocalRequest(request("GET", undefined, { host: "evil.test:3000" })),
    ).toThrow("HOST_FORBIDDEN");
    expect(() =>
      assertLocalRequest(
        request("GET", undefined, { "x-forwarded-host": "evil.test" }),
      ),
    ).toThrow("HOST_FORBIDDEN");
    expect(() =>
      assertLocalRequest(
        request("GET", undefined, { "sec-fetch-site": "cross-site" }),
      ),
    ).toThrow("ORIGIN_FORBIDDEN");
    expect(() =>
      assertLocalRequest(
        request("POST", undefined, { origin: "https://evil.test" }),
      ),
    ).toThrow("ORIGIN_FORBIDDEN");
    const missing = new Request("http://127.0.0.1:3000/api/private/review", {
      method: "POST",
      headers: { host: "127.0.0.1:3000" },
    });
    expect(() => assertLocalRequest(missing)).toThrow("ORIGIN_FORBIDDEN");
    expect(() => assertLocalRequest(request())).not.toThrow();
    expect(() => new LocalCaseAccess(directory, "http://0.0.0.0:3000")).toThrow(
      "INVALID_LOCAL_ORIGIN",
    );
  });
  it("rejects revoked and expired sessions on the next read", async () => {
    const access = new LocalCaseAccess(directory);
    const b = await access.createBootstrap("case_one");
    const s = await access.exchange(request("POST"), b.token);
    await access.revoke(request("POST", s.token));
    await expect(access.require(request("GET", s.token))).rejects.toThrow(
      "UNAUTHORIZED",
    );
    const b2 = await access.createBootstrap("case_one");
    const s2 = await access.exchange(request("POST"), b2.token);
    const file = path.join(directory, "auth", "sessions.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    state.sessions[0].expiresAt = "2000-01-01T00:00:00.000Z";
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    await expect(access.require(request("GET", s2.token))).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });
  it("only one concurrent exchange consumes a bootstrap", async () => {
    const access = new LocalCaseAccess(directory);
    const b = await access.createBootstrap("case_one");
    const results = await Promise.allSettled([
      access.exchange(request("POST"), b.token),
      access.exchange(request("POST"), b.token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
