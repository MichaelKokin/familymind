import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexArguments, executeCaseRun, invokeCodex, researchPrompt } from "../src/private-case/codex-runner";
import { boundedJson, loadOwnedCase, privateFailure, privateJson } from "../src/private-case/runtime";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import { PrivateCaseStore } from "../src/private-case/server-store";
import { PrivateCaseError, type AIResult, type PrivateCase } from "../src/private-case/model";

function fixture(id = "case_synthetic"): PrivateCase {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, id, title: "Synthetic runner test", revision: 0, updatedAt: now,
    subject: { personId: "person_synthetic", name: "Вымышленный человек", dateText: "около 1900", livingStatus: "unknown" },
    sources: ["selected", "unselected"].map((suffix) => ({ id: `source_${suffix}`, title: `synthetic_${suffix}`, url: `https://example.test/${suffix}`, locator: "", excerpt: `SOURCE_MARKER_${suffix}`, kind: "user_tree", observedAt: now })),
    known: [
      { id: "known_selected", text: "KNOWN_SELECTED", sourceIds: ["source_selected"], status: "tree_assertion" },
      { id: "known_mixed", text: "KNOWN_MIXED_PRIVATE", sourceIds: ["source_selected", "source_unselected"], status: "tree_assertion" },
      { id: "known_unselected", text: "KNOWN_UNSELECTED_PRIVATE", sourceIds: ["source_unselected"], status: "tree_assertion" },
    ],
    question: "CASE_QUESTION_PRIVATE", notes: "CASE_NOTES_PRIVATE",
    aiRuns: [{ id: "run_synthetic", status: "running", mode: "codex-cli", provider: "synthetic-test", model: null, question: "SELECTED_QUESTION", sourceIds: ["source_selected"], startedAt: now, completedAt: null, result: null, resultDigest: null, error: null }],
    reviews: [],
  };
}
const result: AIResult = {
  summary: "Synthetic result; no research performed.",
  observations: [{ text: "Synthetic observation", sourceIds: ["source_selected"] }],
  gaps: [], nextSteps: [], proposals: [],
};

// This executable is test-owned, local and deterministic. It never calls Codex or a network service.
const fakeExecutable = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const directory = args[args.indexOf('--cd') + 1];
const mode = process.env.FAMILYMIND_TEST_FAKE_BEHAVIOR || 'success';
if (args.includes('login')) {
  if ('OPENAI_API_KEY' in process.env || 'CODEX_API_KEY' in process.env) process.exit(9);
  process.stdout.write(mode === 'api-login' ? 'Logged in using an API key' : 'Logged in using ChatGPT');
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(directory, 'test-observation.json'), JSON.stringify({ apiKeyPresent: 'OPENAI_API_KEY' in process.env, codexKeyPresent: 'CODEX_API_KEY' in process.env, args, input }));
  const result = ${JSON.stringify(result)};
  if (mode === 'foreign-source') result.observations[0].sourceIds = ['source_unselected'];
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result));
  if (mode === 'tool') {
    process.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'synthetic marker; not executed' } }) + '\\n');
    setTimeout(() => process.exit(0), 1000);
    return;
  }
  if (mode !== 'no-completion') process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
  if (mode === 'trailing-tool') process.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call' } }));
  if (mode === 'failed-event') process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'SYNTHETIC_PRIVATE_DIAGNOSTIC' } }) + '\\n');
  if (mode === 'exit-error') process.exitCode = 7;
});
`;

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "family-mind-synthetic-runner-"));
  const executable = path.join(directory, "fake-codex.cjs");
  await writeFile(executable, fakeExecutable, { mode: 0o700 });
  vi.stubEnv("FAMILYMIND_CODEX_BINARY", executable);
  vi.stubEnv("FAMILYMIND_PRIVATE_ROOT", path.join(directory, "private-store"));
  vi.stubEnv("FAMILYMIND_ORIGIN", "http://127.0.0.1:3000");
  vi.stubEnv("FAMILYMIND_TEST_FAKE_BEHAVIOR", "success");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("scoped Codex research adapter", () => {
  it("only includes the selected sources, their complete claims and the submitted question", () => {
    const value = fixture();
    const prompt = researchPrompt(value, value.aiRuns[0]);
    expect(prompt).toContain("SOURCE_MARKER_selected");
    expect(prompt).toContain("KNOWN_SELECTED");
    expect(prompt).toContain("SELECTED_QUESTION");
    for (const marker of ["SOURCE_MARKER_unselected", "KNOWN_MIXED_PRIVATE", "KNOWN_UNSELECTED_PRIVATE", "CASE_QUESTION_PRIVATE", "CASE_NOTES_PRIVATE"]) expect(prompt).not.toContain(marker);
    expect(() => researchPrompt(value, { ...value.aiRuns[0], sourceIds: [] })).toThrow("SOURCE_SCOPE_VIOLATION");
    expect(() => researchPrompt(value, { ...value.aiRuns[0], sourceIds: ["not_in_case"] })).toThrow("SOURCE_SCOPE_VIOLATION");
  });
  it("bounds the full selected prompt before starting a child", () => {
    const value = fixture();
    value.sources[0].excerpt = "x".repeat(180_001);
    expect(() => researchPrompt(value, value.aiRuns[0])).toThrow("AI_INPUT_TOO_LARGE");
  });
  it("disables tools/config and removes both API key fallbacks from the child environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-key");
    vi.stubEnv("CODEX_API_KEY", "synthetic-not-a-key-either");
    const job = path.join(directory, "job");
    expect(await invokeCodex(job, "Synthetic prompt")).toEqual(result);
    const observation = JSON.parse(await readFile(path.join(job, "test-observation.json"), "utf8"));
    expect(observation.apiKeyPresent).toBe(false);
    expect(observation.codexKeyPresent).toBe(false);
    expect(observation.input).toBe("Synthetic prompt");
    expect(observation.args).toEqual(codexArguments(job));
    expect(observation.args).toContain("--ignore-user-config");
    expect(observation.args).toContain("--ignore-rules");
    expect(observation.args).toContain('web_search="disabled"');
    for (const capability of ["apps", "plugins", "shell_tool", "unified_exec", "browser_use", "multi_agent"]) expect(observation.args).toContain(capability);
    expect((await stat(path.join(job, "result.json"))).mode & 0o777).toBe(0o600);
  });
  it.each(["tool", "trailing-tool"])("fails closed on %s event rather than accepting a result file", async (behavior) => {
    vi.stubEnv("FAMILYMIND_TEST_FAKE_BEHAVIOR", behavior);
    await expect(invokeCodex(path.join(directory, "job"), "Synthetic prompt")).rejects.toThrow("CODEX_TOOL_USE_REFUSED");
  });
  it("refuses an existing API-key login before invoking any research run", async () => {
    vi.stubEnv("FAMILYMIND_TEST_FAKE_BEHAVIOR", "api-login");
    const store = new PrivateCaseStore(process.env.FAMILYMIND_PRIVATE_ROOT);
    const value = await store.save(fixture(), null);
    await executeCaseRun(store, value, value.aiRuns[0]);
    const saved = await store.load(value.id);
    expect(saved?.aiRuns[0].status).toBe("failed");
    expect(saved?.aiRuns[0].error).toBe("CODEX_CHATGPT_LOGIN_REQUIRED");
    expect(saved?.aiRuns[0].result).toBeNull();
    await expect(stat(path.join(store.root, "jobs", value.aiRuns[0].id))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["exit-error", "no-completion", "failed-event"])("records %s as failed without false completion or retained job files", async (behavior) => {
    vi.stubEnv("FAMILYMIND_TEST_FAKE_BEHAVIOR", behavior);
    const store = new PrivateCaseStore(process.env.FAMILYMIND_PRIVATE_ROOT);
    const value = await store.save(fixture(), null);
    await executeCaseRun(store, value, value.aiRuns[0]);
    const saved = await store.load(value.id);
    expect(saved?.aiRuns[0].status).toBe("failed");
    expect(saved?.aiRuns[0].result).toBeNull();
    expect(saved?.aiRuns[0].resultDigest).toBeNull();
    expect(saved?.aiRuns[0].error).toBe("CODEX_RUN_FAILED");
    expect(JSON.stringify(saved)).not.toContain("SYNTHETIC_PRIVATE_DIAGNOSTIC");
    await expect(stat(path.join(store.root, "jobs", value.aiRuns[0].id))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects output references outside the submitted source scope and preserves only an error code", async () => {
    vi.stubEnv("FAMILYMIND_TEST_FAKE_BEHAVIOR", "foreign-source");
    const store = new PrivateCaseStore(process.env.FAMILYMIND_PRIVATE_ROOT);
    const value = await store.save(fixture(), null);
    await executeCaseRun(store, value, value.aiRuns[0]);
    const saved = await store.load(value.id);
    expect(saved?.aiRuns[0].status).toBe("failed");
    expect(saved?.aiRuns[0].error).toBe("SOURCE_SCOPE_VIOLATION");
    expect(saved?.aiRuns[0].result).toBeNull();
  });
});

describe("private runtime boundaries", () => {
  it("bounds actual streamed bytes rather than trusting Content-Length", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"payload":"')); controller.enqueue(new Uint8Array(100)); },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://127.0.0.1:3000/api/private/import", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(boundedJson(request, 32)).rejects.toThrow("REQUEST_TOO_LARGE");
    expect(cancelled).toBe(true);
    await expect(boundedJson(new Request("http://127.0.0.1:3000", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }))).rejects.toThrow("JSON_REQUIRED");
    await expect(boundedJson(new Request("http://127.0.0.1:3000", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).rejects.toThrow("INVALID_REQUEST");
  });
  it("loads only the session-owned case and never selects a case by URL parameter", async () => {
    const root = process.env.FAMILYMIND_PRIVATE_ROOT!;
    const store = new PrivateCaseStore(root);
    const first = await store.save(fixture("case_first"), null);
    await store.save({ ...fixture("case_other"), title: "OTHER_PRIVATE_CASE_MARKER" }, null);
    const access = new LocalCaseAccess(root);
    const bootstrap = await access.createBootstrap(first.id);
    const session = await access.exchange(new Request("http://127.0.0.1:3000/api/private/session", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }), bootstrap.token);
    const url = "http://127.0.0.1:3000/api/private/case?caseId=case_other";
    await expect(loadOwnedCase(new Request(url, { headers: { host: "127.0.0.1:3000" } }))).rejects.toThrow("UNAUTHORIZED");
    const owned = await loadOwnedCase(new Request(url, { headers: { host: "127.0.0.1:3000", cookie: `${SESSION_COOKIE}=${session.token}` } }));
    expect(owned.value.id).toBe(first.id);
    expect(JSON.stringify(owned.value)).not.toContain("OTHER_PRIVATE_CASE_MARKER");
  });
  it("does not cache private responses or expose arbitrary exception details", async () => {
    expect(privateJson({ private: true }).headers.get("cache-control")).toContain("no-store");
    expect(privateJson({ private: true }).headers.get("vary")).toBe("Cookie");
    const failure = privateFailure(new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC"));
    expect(await failure.json()).toEqual({ error: "REQUEST_FAILED" });
    expect(privateFailure(new PrivateCaseError("UNAUTHORIZED")).status).toBe(401);
    expect(privateFailure(new PrivateCaseError("HOST_FORBIDDEN")).status).toBe(403);
    expect(privateFailure(new PrivateCaseError("STALE_REVISION")).status).toBe(409);
  });
});
