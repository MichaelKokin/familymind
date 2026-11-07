import { z } from "zod";
import { privateId, PrivateCaseError } from "./model";

export const CHAT_MAX_QUESTION = 2000;
export const CHAT_MAX_CONTEXT_BYTES = 220_000;
export const CHAT_MAX_TURNS = 100;
export const referenceId = z.string().max(160).regex(/^(research|case|note):[a-zA-Z0-9_-]+$/);
export const chatAnswerSchema = z.object({
  paragraphs: z.array(z.object({ text: z.string().min(1).max(4000), sourceIds: z.array(referenceId).max(12) }).strict()).min(1).max(8),
  unknowns: z.array(z.string().min(1).max(1500)).max(8),
  nextSteps: z.array(z.string().min(1).max(1500)).max(6),
}).strict();
export const citationSchema = z.object({ id: referenceId, sourceId: privateId, scope: z.enum(["research", "case", "note"]), title: z.string().max(2000), url: z.string().max(4000), locator: z.string().max(50000) }).strict();
export const webLeadSchema = z.object({ title: z.string().min(1).max(500), url: z.string().max(4000), detail: z.string().max(2000) }).strict();
export const webAnswerSchema = z.object({ leads: z.array(webLeadSchema).max(8), limitation: z.string().max(2000) }).strict();
export const turnSchema = z.object({
  id: privateId, question: z.string().min(1).max(CHAT_MAX_QUESTION), searchWeb: z.boolean(),
  status: z.enum(["running", "completed", "failed", "cancelled", "interrupted"]),
  createdAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
  answer: chatAnswerSchema.nullable(), citations: z.array(citationSchema).max(100),
  web: z.object({ status: z.enum(["not_requested", "performed", "unavailable", "failed"]), subject: z.string().max(1000), subjectId: privateId.optional(), queries: z.array(z.string().max(2000)).max(6), leads: z.array(webLeadSchema).max(8), limitation: z.string().max(2000) }).strict(),
  context: z.object({ sourceCount: z.number().int().nonnegative(), peopleCount: z.number().int().nonnegative(), noteCount: z.number().int().nonnegative(), noteIds: z.array(privateId).max(1000), noteVersions: z.array(z.object({ id: privateId, revision: z.number().int().positive() }).strict()).max(1000).default([]), historyTurns: z.number().int().nonnegative(), omittedHistoryTurns: z.number().int().nonnegative().default(0), summarizedRuns: z.number().int().nonnegative().default(0), deduplicatedSourceTexts: z.number().int().nonnegative().default(0), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  error: z.string().max(100).nullable(),
}).strict();
export const chatStateSchema = z.object({ schemaVersion: z.literal(1), caseId: privateId, revision: z.number().int().nonnegative(), turns: z.array(turnSchema).max(CHAT_MAX_TURNS) }).strict();
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;
export type ChatCitation = z.infer<typeof citationSchema>;
export type ChatTurn = z.infer<typeof turnSchema>;
export type ChatState = z.infer<typeof chatStateSchema>;
export type ChatWeb = ChatTurn["web"];
export type ChatCapabilities = { provider: "codex-chatgpt"; webSearch: "cached" | "unavailable"; publicSearchSubject: string; publicSearchSubjects: Array<{ id: string; name: string }> };
export type ChatResponse = ChatState & { capabilities: ChatCapabilities };

export function parseChatState(input: unknown, caseId: string): ChatState {
  const parsed = chatStateSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("INVALID_CHAT");
  const state = parsed.data;
  if (state.caseId !== caseId) throw new PrivateCaseError("CASE_SCOPE_VIOLATION");
  if (new Set(state.turns.map(t => t.id)).size !== state.turns.length || state.turns.filter(t => t.status === "running").length > 1) throw new PrivateCaseError("INVALID_CHAT");
  for (const turn of state.turns) {
    if ((turn.status === "running") !== (turn.completedAt === null)) throw new PrivateCaseError("INVALID_CHAT");
    if ((turn.status === "completed") !== (turn.answer !== null)) throw new PrivateCaseError("INVALID_CHAT");
    if (turn.status === "completed" && turn.error) throw new PrivateCaseError("INVALID_CHAT");
    if (turn.answer) validateChatAnswer(turn.answer, turn.citations);
  }
  return state;
}

export function validateChatAnswer(input: unknown, citations: ChatCitation[]): ChatAnswer {
  const parsed = chatAnswerSchema.safeParse(input);
  if (!parsed.success) throw new PrivateCaseError("INVALID_CHAT_ANSWER");
  const allowed = new Set(citations.map(c => c.id));
  if (parsed.data.paragraphs.some(p => p.sourceIds.some(id => !allowed.has(id)))) throw new PrivateCaseError("SOURCE_SCOPE_VIOLATION");
  return parsed.data;
}

/** No fetching: reject private/local destinations before exposing model-proposed links. */
export function safePublicChatUrl(value: string): boolean {
  try {
    const u = new URL(value), host = u.hostname.toLowerCase().replace(/\.$/, "");
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && (!u.port || ["80", "443"].includes(u.port)) && host.includes(".") && !/^\d|:|\[/.test(host) && !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host);
  } catch { return false; }
}
