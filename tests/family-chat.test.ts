import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildChatContext, chatPrompt, publicSearchPrompt, visibleChatState, type ChatNote } from "../src/private-case/chat-context";
import { parseChatState, safePublicChatUrl, validateChatAnswer, type ChatAnswer, type ChatState, type ChatTurn } from "../src/private-case/chat-model";
import { PrivateChatStore } from "../src/private-case/chat-store";
import { chatCodexArguments, executeChatTurn, invokeChatCodex } from "../src/private-case/chat-runner";
import { PrivateCaseStore } from "../src/private-case/server-store";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import type { PrivateCase } from "../src/private-case/model";
import type { PrivateResearch } from "../src/private-case/research-model";
import { GET, POST, DELETE } from "../src/app/api/private/chat/route";

const mocks = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>>, noteCase: "synthetic", memberId: "owner", notes: [] as ChatNote[] }));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => mocks.callbacks.push(callback) }));
vi.mock("../src/private-case/notes-runtime", () => ({ listAccessibleNotes: async () => ({ caseId: mocks.noteCase, memberId: mocks.memberId, notes: mocks.notes }) }));

const now = "2026-01-01T00:00:00.000Z";
const answer: ChatAnswer = { paragraphs: [{ text: "Синтетический ответ по источнику", sourceIds: ["case:source_one"] }], unknowns: ["Дата не установлена"], nextSteps: ["Сопоставить оригиналы"] };
function fixture(id = "synthetic"): PrivateCase {
  return { schemaVersion: 1, id, title: "Synthetic family", revision: 0, updatedAt: now, subject: { personId: "person_one", name: "PUBLIC_DECEASED_NAME", dateText: "1900–1950", livingStatus: "deceased" }, sources: [{ id: "source_one", title: "Synthetic document", url: "https://archive.example.org/record", kind: "document", locator: "folio1", excerpt: "SOURCE_PRIVATE_MARKER", observedAt: now }], known: [{ id: "claim_one", text: "KNOWN_MARKER", sourceIds: ["source_one"], status: "unresolved" }], question: "Initial question", notes: "CASE_NOTE_PRIVATE_MARKER", aiRuns: [], reviews: [] };
}
function research(): PrivateResearch {
  return { schemaVersion: 1, title: "Synthetic research", owner: { name: "Synthetic owner" }, summary: "SUMMARY_MARKER", people: [{ id: "person_one", name: "Person1", dates: "1900", relation: "ancestor", biography: "BIOGRAPHY_MARKER", branch: "synthetic", status: "unresolved", sourceIds: ["source_two"], photoIds: ["photo_one"], generation: 2 }], relationships: [], sources: [{ id: "source_two", title: "Research source", url: "https://museum.example.org/item", locator: "page2", text: "LETTER_PRIVATE_MARKER", kind: "document" }], photos: [{ id: "photo_one", title: "Portrait", caption: "CAPTION_MARKER", personIds: ["person_one"], sourceId: "source_two", dataUrl: "DO_NOT_SEND_IMAGE_BYTES" }], questions: [] };
}
function note(): ChatNote { return { id: "note_one", caseId: "synthetic", personId: "person_one", authorId: "owner", visibility: "private", text: "OWNER_NOTE_PRIVATE_MARKER", revision: 1 }; }
function empty(caseId = "synthetic"): ChatState { return { schemaVersion: 1, caseId, revision: 0, turns: [] }; }
function turn(id = "turn_one", overrides: Partial<ChatTurn> = {}): ChatTurn {
  const context = buildChatContext(fixture(), research(), [note()], empty());
  return { id, question: "Question_PRIVATE_MARKER", status: "running", searchWeb: false, createdAt: new Date().toISOString(), completedAt: null, answer: null, citations: [], web: { status: "not_requested", subject: "", queries: [], leads: [], limitation: "" }, context: context.metadata, error: null, ...overrides };
}
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "familymind-chat-test-"));
  vi.stubEnv("FAMILYMIND_PRIVATE_ROOT", root); vi.stubEnv("FAMILYMIND_ORIGIN", "http://127.0.0.1:3000");
  mocks.callbacks = []; mocks.noteCase = "synthetic"; mocks.memberId = "owner"; mocks.notes = [];
  const binary = path.join(root, "fake-codex.mjs");
  await writeFile(binary, `#!/usr/bin/env node\nimport fs from 'node:fs'; import path from 'node:path';
const args=process.argv.slice(2), behavior=process.env.FM_CHAT_FAKE || '';
if(args.includes('login')){process.stdout.write(behavior==='api-login'?'Logged in using API key':'Logged in using ChatGPT');process.exit(0);}
if(args.includes('mcp')&&args.includes('list')){process.stdout.write(JSON.stringify(['unsafe-mcp','configured-mcp'].includes(behavior)?[{name:'synthetic_server',enabled:behavior==='unsafe-mcp'||!args.includes('mcp_servers.synthetic_server.enabled=false'),transport:{type:'streamable_http',url:'https://sensitive.example.org/secret-placeholder'}}]:[]));process.exit(0);}
if(args.includes('features')&&args.includes('list')){for(let i=0;i<args.length;i++)if(args[i]==='--disable')process.stdout.write(args[i+1]+' stable '+(behavior==='unsafe-feature'?'true':'false')+'\\n');process.exit(0);}
const directory=args[args.indexOf('--cd')+1]; let input='';for await(const chunk of process.stdin)input+=chunk;
fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify({input,args,api:!!process.env.OPENAI_API_KEY,codex:!!process.env.CODEX_API_KEY,pid:process.pid}));
if(behavior==='hang'){setInterval(()=>{},1000);}else{
const web=args.includes('web_search="cached"');
const result=web?{leads:[{title:'Synthetic public lead',url:'https://archive.example.org/entry',detail:'Unverified index lead'}],limitation:'Original not read'}:${JSON.stringify(answer)};
if(behavior==='foreign-source'&&!web)result.paragraphs[0].sourceIds=['case:foreign'];
fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result));
if(['item-error','item-error-failed','item-error-exit'].includes(behavior))process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'warning1',type:'error',message:'Synthetic diagnostic'}})+'\\n');
if(behavior==='item-error-exit')process.exit(1);
if(behavior==='tool')process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'x',type:'command_execution'}})+'\\n');
if(web&&behavior!=='no-search-event')process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'search1',type:'web_search',query:'PUBLIC_DECEASED_NAME archive'}})+'\\n');
if(['failed','item-error-failed'].includes(behavior))process.stdout.write(JSON.stringify({type:'turn.failed'}));else process.stdout.write(JSON.stringify({type:'turn.completed'}));
}
`, { mode: 0o700 });
  vi.stubEnv("FAMILYMIND_CODEX_BINARY", binary);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("family chat context and evidence", () => {
  it("includes all scoped text and photo captions but excludes image payloads", () => {
    const context = buildChatContext(fixture(), research(), [note()], empty());
    for (const marker of ["SOURCE_PRIVATE_MARKER", "KNOWN_MARKER", "CASE_NOTE_PRIVATE_MARKER", "SUMMARY_MARKER", "BIOGRAPHY_MARKER", "LETTER_PRIVATE_MARKER", "CAPTION_MARKER", "OWNER_NOTE_PRIVATE_MARKER"]) expect(context.data).toContain(marker);
    expect(context.data).not.toContain("DO_NOT_SEND_IMAGE_BYTES");
    expect(context.citations.map(c => c.id)).toEqual(["research:source_two", "case:source_one", "note:note_one"]);
    expect(context.metadata.sourceCount).toBe(3);
    expect(() => buildChatContext(fixture(), null, [{ ...note(), caseId: "other" }], empty())).toThrow("CASE_SCOPE_VIOLATION");
  });
  it("separates the public-only search prompt from question, letters, notes and history", () => {
    const search = publicSearchPrompt(fixture().subject.name);
    expect(search).toContain("PUBLIC_DECEASED_NAME");
    for (const marker of ["PRIVATE_MARKER", "OWNER_NOTE", "LETTER_PRIVATE", "SOURCE_PRIVATE"]) expect(search).not.toContain(marker);
    expect(chatCodexArguments("/tmp/synthetic", false)).toContain('web_search="disabled"');
    expect(chatCodexArguments("/tmp/synthetic", true)).toContain('web_search="cached"');
    expect(chatCodexArguments("/tmp/synthetic", true)).toContain("shell_tool");
  });
  it("rejects foreign source ids and oversized context before any model invocation", () => {
    const context = buildChatContext(fixture(), null, [], empty());
    expect(validateChatAnswer(answer, context.citations)).toEqual(answer);
    expect(() => validateChatAnswer({ ...answer, paragraphs: [{ text: "fiction", sourceIds: ["case:foreign"] }] }, context.citations)).toThrow("SOURCE_SCOPE_VIOLATION");
    expect(() => buildChatContext({ ...fixture(), notes: "x".repeat(220001) }, null, [], empty())).toThrow("CHAT_CONTEXT_TOO_LARGE");
    expect(chatPrompt(context, "question", turn().web)).toContain("недоверенные данные");
  });
  it("hides prior answers and excludes them from context after note visibility is lost", () => {
    const state = { ...empty(), turns: [turn("old", { status: "completed", completedAt: now, answer, citations: buildChatContext(fixture(), null, [], empty()).citations })] };
    expect(visibleChatState(state, []).turns[0].answer).toBeNull();
    expect(visibleChatState(state, []).turns[0].error).toBe("CHAT_CONTEXT_CHANGED");
    expect(buildChatContext(fixture(), null, [], state).metadata.historyTurns).toBe(0);
    expect(visibleChatState(state, [note()]).turns[0].answer).toEqual(answer);
    expect(visibleChatState(state, [{ ...note(), revision: 2, text: "Corrected testimony" }]).turns[0].answer).toBeNull();
  });
  it.each(["http://127.0.0.1/", "http://2130706433/", "http://[::1]/", "https://user:secret@example.org", "javascript:alert(1)", "http://host.local/", "file:///tmp/x"])("rejects unsafe public result URL %s", url => expect(safePublicChatUrl(url)).toBe(false));
});

describe("durable local chat", () => {
  it("persists, checks revisions, prevents parallel turns and preserves terminal outcomes", async () => {
    const store = new PrivateChatStore(root), first = await store.begin("synthetic", 0, turn());
    expect(first.revision).toBe(1);
    await expect(store.begin("synthetic", 0, turn("stale"))).rejects.toThrow("STALE_REVISION");
    await expect(store.begin("synthetic", 1, turn("parallel"))).rejects.toThrow("CHAT_ACTIVE_RUN");
    await store.cancel("synthetic", "turn_one");
    await store.finish("synthetic", "turn_one", { status: "completed", answer, citations: buildChatContext(fixture(), null, [], empty()).citations, web: turn().web, error: null });
    expect((await new PrivateChatStore(root).load("synthetic")).turns[0].status).toBe("cancelled");
    expect((await stat(path.join(root, "chat", "synthetic.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(root, "chat"))).mode & 0o777).toBe(0o700);
    await expect(store.cancel("other", "turn_one")).rejects.toThrow("CHAT_TURN_NOT_FOUND");
  });
  it("rejects path traversal, symlink reads and foreign case payloads", async () => {
    const store = new PrivateChatStore(root); await store.load("synthetic");
    await expect(store.load("../outside")).rejects.toThrow("INVALID_ID");
    await writeFile(path.join(root, "outside.json"), JSON.stringify(empty("synthetic")));
    await symlink(path.join(root, "outside.json"), path.join(root, "chat", "synthetic.json"));
    await expect(store.load("synthetic")).rejects.toThrow("STORAGE_READ_FAILED");
    expect(() => parseChatState(empty("other"), "synthetic")).toThrow("CASE_SCOPE_VIOLATION");
  });
  it("recovers old active runs without claiming a completed answer", async () => {
    const store = new PrivateChatStore(root); await store.begin("synthetic", 0, turn("expired", { createdAt: now }));
    const value = await store.recoverExpired("synthetic");
    expect(value.turns[0].status).toBe("interrupted"); expect(value.turns[0].answer).toBeNull();
  });
});

describe("isolated CLI chat runner", () => {
  it("uses ChatGPT login without API fallback and rejects unexpected tools", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-not-key"); vi.stubEnv("CODEX_API_KEY", "synthetic-not-key");
    const directory = path.join(root, "job");
    const result = await invokeChatCodex(directory, "Synthetic prompt", { web: false, signal: new AbortController().signal });
    expect(result.result).toEqual(answer); expect(result.webPerformed).toBe(false);
    const observation = JSON.parse(await readFile(path.join(directory, "observation.json"), "utf8"));
    expect(observation.api).toBe(false); expect(observation.codex).toBe(false);
    vi.stubEnv("FM_CHAT_FAKE", "tool");
    await expect(invokeChatCodex(path.join(root, "bad"), "synthetic", { web: false, signal: new AbortController().signal })).rejects.toThrow("CODEX_TOOL_USE_REFUSED");
  });
  it("accepts non-tool diagnostic items only with successful completion and a valid result", async () => {
    vi.stubEnv("FM_CHAT_FAKE", "item-error");
    const result = await invokeChatCodex(path.join(root, "diagnostic"), "synthetic", { web: false, signal: new AbortController().signal });
    expect(result.result).toEqual(answer);
  });
  it.each(["item-error-failed", "item-error-exit"])("does not treat %s diagnostic as a successful answer", async behavior => {
    vi.stubEnv("FM_CHAT_FAKE", behavior);
    await expect(invokeChatCodex(path.join(root, "diagnostic-failure"), "synthetic", { web: false, signal: new AbortController().signal })).rejects.toThrow("CODEX_RUN_FAILED");
  });
  it("cancels the actual child process and refuses API-key login", async () => {
    vi.stubEnv("FM_CHAT_FAKE", "hang"); const controller = new AbortController(), directory = path.join(root, "hang");
    const pending = invokeChatCodex(directory, "synthetic", { web: false, signal: controller.signal });
    const check = expect(pending).rejects.toThrow("CHAT_CANCELLED");
    let pid = 0;
    await vi.waitFor(async () => { pid = JSON.parse(await readFile(path.join(directory, "observation.json"), "utf8")).pid; });
    controller.abort(); await check;
    expect(() => process.kill(pid, 0)).toThrow();
    vi.stubEnv("FM_CHAT_FAKE", "api-login");
    await expect(invokeChatCodex(path.join(root, "api"), "synthetic", { web: false, signal: new AbortController().signal })).rejects.toThrow("CODEX_CHATGPT_LOGIN_REQUIRED");
  });
  it.each(["unsafe-mcp", "unsafe-feature"])("refuses %s configuration before sending a prompt", async behavior => {
    vi.stubEnv("FM_CHAT_FAKE", behavior); const directory = path.join(root, "unsafe");
    await expect(invokeChatCodex(directory, "PRIVATE_PROMPT", { web: false, signal: new AbortController().signal })).rejects.toThrow("CHAT_TOOL_CONFIG_UNSAFE");
    await expect(stat(path.join(directory, "observation.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("passes complete disabled MCP transports without copying endpoint secrets into argv", async () => {
    vi.stubEnv("FM_CHAT_FAKE", "configured-mcp"); const directory = path.join(root, "configured");
    await invokeChatCodex(directory, "synthetic", { web: false, signal: new AbortController().signal });
    const observed = JSON.parse(await readFile(path.join(directory, "observation.json"), "utf8"));
    expect(observed.args).toContain("mcp_servers.synthetic_server.enabled=false");
    expect(observed.args).toContain('mcp_servers.synthetic_server.url="https://disabled.invalid"');
    expect(JSON.stringify(observed.args)).not.toContain("secret-placeholder");
  });
  it.each(["failed", "foreign-source"])("stores %s as failure without false answer and cleans temporary files", async behavior => {
    vi.stubEnv("FM_CHAT_FAKE", behavior); const store = new PrivateChatStore(root), context = buildChatContext(fixture(), research(), [note()], empty()), active = turn();
    await store.begin("synthetic", 0, active); await executeChatTurn(store, "synthetic", active, context, "");
    const saved = (await store.load("synthetic")).turns[0]; expect(saved.status).toBe("failed"); expect(saved.answer).toBeNull();
    await expect(stat(path.join(root, "chat-jobs", active.id))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not claim a search happened when the CLI produced no web-search event", async () => {
    vi.stubEnv("FM_CHAT_FAKE", "no-search-event"); const store = new PrivateChatStore(root), context = buildChatContext(fixture(), null, [], empty()), active = turn("web", { searchWeb: true, context: context.metadata });
    await store.begin("synthetic", 0, active); await executeChatTurn(store, "synthetic", active, context, "PUBLIC_DECEASED_NAME");
    const saved = (await store.load("synthetic")).turns[0]; expect(saved.status).toBe("completed"); expect(saved.web.status).toBe("unavailable"); expect(saved.web.leads).toEqual([]);
  });
});

async function request(method = "GET", body?: unknown, cookie = "", origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/private/chat?caseId=other", { method, headers: { host: "127.0.0.1:3000", origin, cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function ownerCookie() {
  await new PrivateCaseStore(root).save(fixture(), null);
  const access = new LocalCaseAccess(root), bootstrap = await access.createBootstrap("synthetic"), session = await access.exchange(await request("POST"), bootstrap.token);
  return `${SESSION_COOKIE}=${session.token}`;
}
describe("authenticated chat API", () => {
  it("denies unauthenticated reads and cross-origin writes; ignores URL case selection", async () => {
    const cookie = await ownerCookie();
    expect((await GET(await request())).status).toBe(401);
    const response = await GET(await request("GET", undefined, cookie)); expect(response.status).toBe(200); expect((await response.json()).caseId).toBe("synthetic");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await POST(await request("POST", { question: "Synthetic question", expectedRevision: 0 }, cookie, "https://attacker.example"))).status).toBe(403);
  });
  it("fails closed on mismatched case or member principal even with an owner cookie", async () => {
    const cookie = await ownerCookie(); mocks.noteCase = "other";
    expect((await GET(await request("GET", undefined, cookie))).status).toBe(403);
    mocks.noteCase = "synthetic"; mocks.memberId = "member_other";
    expect((await GET(await request("GET", undefined, cookie))).status).toBe(403);
  });
  it("keeps explicit deceased scope but refuses unverified search before queuing any model call", async () => {
    const cookie = await ownerCookie(), data = research(); data.photos = []; data.people[0].photoIds = [];
    const template = data.people[0];
    data.people.push({ ...template, id: "public_ancestor", name: "SECOND_PUBLIC_NAME", livingStatus: "deceased" }, { ...template, id: "unknown_person", name: "UNKNOWN_MARKER", dates: "1800–1890" });
    await mkdir(path.join(root, "research")); await writeFile(path.join(root, "research", "synthetic.json"), JSON.stringify(data));
    const state = await (await GET(await request("GET", undefined, cookie))).json();
    expect(state.capabilities.webSearch).toBe("unavailable");
    expect(state.capabilities.publicSearchSubjects.map((p: { id: string }) => p.id)).toEqual(["person_one", "public_ancestor"]);
    expect((await POST(await request("POST", { question: "Find records", expectedRevision: 0, searchWeb: true, searchSubjectId: "unknown_person" }, cookie))).status).toBe(400);
    expect(mocks.callbacks).toHaveLength(0);
    const result = await POST(await request("POST", { question: "PRIVATE_QUESTION", expectedRevision: 0, searchWeb: true, searchSubjectId: "public_ancestor" }, cookie));
    expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: "PUBLIC_SEARCH_UNAVAILABLE" });
    expect(mocks.callbacks).toHaveLength(0);
    const saved = await (await GET(await request("GET", undefined, cookie))).json();
    expect(saved.revision).toBe(0); expect(saved.turns).toEqual([]);
  });
  it("persists a real queued execution and returns validated answer; rejects foreign cancellation", async () => {
    const cookie = await ownerCookie();
    const response = await POST(await request("POST", { question: "Synthetic question", expectedRevision: 0, searchWeb: false }, cookie));
    expect(response.status).toBe(202); expect(mocks.callbacks).toHaveLength(1);
    await mocks.callbacks[0]();
    const state = await (await GET(await request("GET", undefined, cookie))).json(); expect(state.turns[0].status).toBe("completed"); expect(state.turns[0].answer).toEqual(answer);
    const foreign = await DELETE(await request("DELETE", { turnId: "foreign" }, cookie)); expect(foreign.status).toBe(400);
  });
});
