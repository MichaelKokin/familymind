import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PrivateCaseError } from "./model";
import { ensurePrivateDir } from "./server-store";
import { codexArguments } from "./codex-runner";
import { chatAnswerSchema, webAnswerSchema, validateChatAnswer, safePublicChatUrl, type ChatTurn, type ChatWeb } from "./chat-model";
import { chatPrompt, publicSearchPrompt, type ChatContext } from "./chat-context";
import { PrivateChatStore } from "./chat-store";

export const CHAT_ANSWER_TIMEOUT_MS = 180_000;
export const CHAT_SEARCH_TIMEOUT_MS = 90_000;
const controllers = new Map<string, AbortController>();
function jobKey(root: string, caseId: string, turnId: string) { return `${root}\0${caseId}\0${turnId}`; }
export function cancelChatProcess(root: string, caseId: string, turnId: string) { controllers.get(jobKey(root, caseId, turnId))?.abort(); }

export function chatCodexArguments(directory: string, web: boolean) {
  const args = codexArguments(directory).map(arg => arg === 'web_search="disabled"' && web ? 'web_search="cached"' : arg);
  args.splice(args.length - 1, 0, "--disable", "code_mode", "--disable", "code_mode_host", "--disable", "multi_agent_v2");
  return args;
}

/** Inspect configuration metadata only; never starts MCP servers or a model. */
export async function chatToolBoundary(directory: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string[]> {
  const binary = /* turbopackIgnore: true */ process.env.FAMILYMIND_CODEX_BINARY || "codex";
  const run = async (args: string[]) => (await promisify(execFile)(binary, ["--no-daemon", ...args], { cwd: directory, env, signal, timeout: 15_000, maxBuffer: 256 * 1024 })).stdout;
  const parseServers = (raw: string) => {
    const transport = z.discriminatedUnion("type", [z.object({ type: z.literal("stdio") }).passthrough(), z.object({ type: z.literal("streamable_http") }).passthrough()]);
    const parsed = z.array(z.object({ name: z.string().min(1).max(200), enabled: z.boolean(), transport }).passthrough()).max(100).safeParse(JSON.parse(raw));
    if (!parsed.success || new Set(parsed.data.map(s => s.name)).size !== parsed.data.length) throw new Error("format");
    return parsed.data;
  };
  let stage = "MCP_DISCOVERY";
  try {
    const args = chatCodexArguments(directory, false);
    const disabled = args.flatMap((arg, index) => arg === "--disable" ? [args[index + 1]] : []);
    const flags = disabled.flatMap(feature => ["--disable", feature]);
    // mcp list includes user config: a conservative superset of exec --ignore-user-config.
    // Empty mcp_servers={} does NOT clear merged tables, so disable every named server.
    // The same feature flags must remove implicit app/plugin servers before discovery.
    const servers = parseServers(await run([...flags, "mcp", "list", "--json"]));
    stage = "MCP_KEYS";
    if (servers.some(server => !/^[A-Za-z0-9_-]+$/.test(server.name))) throw new Error("unsupported server key");
    const overrides = servers.flatMap(server => ["-c", `mcp_servers.${server.name}.enabled=false`, "-c", server.transport.type === "stdio" ? `mcp_servers.${server.name}.command="/usr/bin/false"` : `mcp_servers.${server.name}.url="https://disabled.invalid"`]);
    stage = "MCP_DISABLE";
    const verified = parseServers(await run([...flags, ...overrides, "mcp", "list", "--json"]));
    stage = "MCP_VERIFY";
    if (verified.some(server => server.enabled) || verified.some(server => !servers.some(s => s.name === server.name))) throw new Error("enabled server");
    stage = "FEATURE_FLAGS";
    const features = await run([...overrides, ...flags, "features", "list"]);
    stage = "FEATURE_VERIFY";
    for (const feature of disabled) {
      // This CLI retains unified_exec=true as its backend choice; shell_tool=false
      // is the documented capability gate and must still be verified below.
      if (feature === "unified_exec") continue;
      const line = features.split("\n").find(row => row.trim().startsWith(`${feature} `));
      if (!line || !/\sfalse\s*$/.test(line)) throw new Error("enabled feature");
    }
    return overrides;
  } catch { throw new PrivateCaseError(signal.aborted ? "CHAT_CANCELLED" : `CHAT_TOOL_CONFIG_UNSAFE_${stage}`); }
}

export async function invokeChatCodex(directory: string, prompt: string, options: { web: boolean; signal: AbortSignal; timeoutMs?: number }): Promise<{ result: unknown; queries: string[]; webPerformed: boolean }> {
  if (options.signal.aborted) throw new PrivateCaseError("CHAT_CANCELLED");
  await ensurePrivateDir(path.dirname(directory)); await ensurePrivateDir(directory);
  await fs.writeFile(path.join(directory, "schema.json"), JSON.stringify(z.toJSONSchema(options.web ? webAnswerSchema : chatAnswerSchema)), { flag: "wx", mode: 0o600 });
  const env = { ...process.env };
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID"]) delete env[key];
  try {
    const status = await promisify(execFile)(/* turbopackIgnore: true */ process.env.FAMILYMIND_CODEX_BINARY || "codex", ["--no-daemon", "login", "status"], { env, signal: options.signal, timeout: 15_000, maxBuffer: 8192 });
    if (!/Logged in using ChatGPT/.test(status.stdout + status.stderr)) throw new Error("login");
  } catch { throw new PrivateCaseError(options.signal.aborted ? "CHAT_CANCELLED" : "CODEX_CHATGPT_LOGIN_REQUIRED"); }
  const overrides = await chatToolBoundary(directory, env, options.signal);
  const queries = new Set<string>(), webItems = new Set<string>(), completedWebItems = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    if (options.signal.aborted) { reject(new PrivateCaseError("CHAT_CANCELLED")); return; }
    const arguments_ = chatCodexArguments(directory, options.web); arguments_.splice(arguments_.length - 1, 0, ...overrides);
    const child = spawn(/* turbopackIgnore: true */ process.env.FAMILYMIND_CODEX_BINARY || "codex", arguments_, { cwd: directory, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    let bytes = 0, lines = "", completed = false, failure: string | null = null, hardTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); } catch { /* process already exited */ } };
    const stop = (code: string) => { if (failure) return; failure = code; kill("SIGTERM"); hardTimer = setTimeout(() => kill("SIGKILL"), 5000); };
    const abort = () => stop("CHAT_CANCELLED");
    options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("CHAT_TIMEOUT"), options.timeoutMs ?? (options.web ? CHAT_SEARCH_TIMEOUT_MS : CHAT_ANSWER_TIMEOUT_MS));
    const cleanup = () => { clearTimeout(timer); if (hardTimer) clearTimeout(hardTimer); options.signal.removeEventListener("abort", abort); };
    const consume = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "turn.completed") completed = true;
        if (["turn.failed", "error"].includes(event.type)) stop("CODEX_RUN_FAILED");
        const item = event.item;
        // CLI diagnostic items (for example a recoverable transport warning) are
        // not tool calls. Completion still requires exit 0, turn.completed and
        // a valid bounded result file; turn.failed/top-level error still fail.
        if (item?.type === "error") return;
        if (!item?.type || ["reasoning", "agent_message"].includes(item.type)) return;
        if (!options.web || item.type !== "web_search") {
          const knownType = ["command_execution", "mcp_tool_call", "file_change", "web_search", "todo_list", "plan", "context_compaction", "collab_tool_call"].includes(item.type) ? item.type.toUpperCase() : "UNKNOWN";
          stop(`CODEX_TOOL_USE_REFUSED_${knownType}`); return;
        }
        if (typeof item.id !== "string") { stop("CODEX_PROTOCOL_ERROR"); return; }
        webItems.add(item.id);
        if (event.type === "item.completed" && item.status !== "failed") completedWebItems.add(item.id);
        if (webItems.size > 3) { stop("CHAT_SEARCH_LIMIT"); return; }
        const query = item.query ?? item.action?.query;
        if (typeof query === "string") queries.add(query.slice(0, 2000));
        if (Array.isArray(item.action?.queries)) for (const q of item.action.queries) if (typeof q === "string") queries.add(q.slice(0, 2000));
        if (queries.size > 6) stop("CHAT_SEARCH_LIMIT");
      } catch { stop("CODEX_PROTOCOL_ERROR"); }
    };
    child.stdout.on("data", (data: Buffer) => {
      bytes += data.length; if (bytes > 2 * 1024 * 1024) { stop("CODEX_OUTPUT_TOO_LARGE"); return; }
      lines += data.toString("utf8"); let newline;
      while ((newline = lines.indexOf("\n")) >= 0) { consume(lines.slice(0, newline)); lines = lines.slice(newline + 1); }
    });
    child.stderr.on("data", (data: Buffer) => { bytes += data.length; if (bytes > 2 * 1024 * 1024) stop("CODEX_OUTPUT_TOO_LARGE"); });
    child.stdin.on("error", () => { /* outcome determined by close/error */ });
    child.on("error", () => { cleanup(); reject(new PrivateCaseError("CODEX_UNAVAILABLE")); });
    child.on("close", code => { consume(lines); cleanup(); if (failure || code !== 0 || !completed) reject(new PrivateCaseError(failure || "CODEX_RUN_FAILED")); else resolve(); });
    child.stdin.end(prompt);
  });
  const file = await fs.open(path.join(directory, "result.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat(); if (!stat.isFile() || stat.size > 128 * 1024) throw new PrivateCaseError("INVALID_CHAT_ANSWER");
    await file.chmod(0o600);
    const buffer = Buffer.alloc(128 * 1024 + 1); let size = 0;
    while (size < buffer.length) { const read = await file.read(buffer, size, buffer.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > 128 * 1024) throw new PrivateCaseError("INVALID_CHAT_ANSWER");
    try { return { result: JSON.parse(buffer.subarray(0, size).toString("utf8")), queries: [...queries], webPerformed: completedWebItems.size > 0 }; }
    catch { throw new PrivateCaseError("INVALID_CHAT_ANSWER"); }
  } finally { await file.close(); }
}

export async function executeChatTurn(store: PrivateChatStore, caseId: string, turn: ChatTurn, context: ChatContext, publicSubject: string) {
  const controller = new AbortController(), key = jobKey(store.root, caseId, turn.id);
  const directory = path.join(store.root, "chat-jobs", turn.id);
  controllers.set(key, controller);
  // Also honours cancellation handled by another server worker/process.
  const poll = setInterval(() => { void store.load(caseId).then(s => { if (s.turns.find(t => t.id === turn.id)?.status !== "running") controller.abort(); }).catch(() => controller.abort()); }, 1000);
  let web: ChatWeb = turn.web;
  let directoryCreated = false;
  try {
    if ((await store.load(caseId)).turns.find(t => t.id === turn.id)?.status !== "running") return;
    await ensurePrivateDir(path.join(store.root, "chat-jobs"));
    await ensurePrivateDir(directory); directoryCreated = true;
    if (turn.searchWeb && publicSubject) {
      try {
        const search = await invokeChatCodex(path.join(directory, "search"), publicSearchPrompt(publicSubject), { web: true, signal: controller.signal });
        const parsed = webAnswerSchema.safeParse(search.result);
        if (!parsed.success || parsed.data.leads.some(lead => !safePublicChatUrl(lead.url))) throw new PrivateCaseError("INVALID_SEARCH_RESULT");
        web = { ...web, status: search.webPerformed ? "performed" : "unavailable", subject: publicSubject, queries: search.queries, leads: search.webPerformed ? parsed.data.leads : [], limitation: search.webPerformed ? parsed.data.limitation : "CLI не зафиксировал выполнение веб-поиска. Зацепки не приняты." };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        web = { ...web, status: "failed", leads: [], limitation: "Внешний поиск не завершён. Ответ основан на материалах дела." };
      }
    }
    const output = await invokeChatCodex(path.join(directory, "answer"), chatPrompt(context, turn.question, web), { web: false, signal: controller.signal });
    const answer = validateChatAnswer(output.result, context.citations);
    const used = new Set(answer.paragraphs.flatMap(p => p.sourceIds));
    await store.finish(caseId, turn.id, { status: "completed", answer, citations: context.citations.filter(c => used.has(c.id)), web, error: null });
  } catch (error) {
    const code = error instanceof PrivateCaseError ? error.code : "CODEX_RUN_FAILED";
    await store.finish(caseId, turn.id, { status: controller.signal.aborted ? "cancelled" : "failed", answer: null, citations: [], web, error: code }).catch(() => undefined);
  } finally {
    clearInterval(poll); controllers.delete(key);
    if (directoryCreated) await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
