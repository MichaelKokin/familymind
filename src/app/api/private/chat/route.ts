import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { PrivateCaseError, privateId } from "../../../../private-case/model";
import { boundedJson, loadOwnedCase, privateFailure, privateJson } from "../../../../private-case/runtime";
import { readResearch } from "../../../../private-case/research-server";
import { listAccessibleNotes } from "../../../../private-case/notes-runtime";
import { buildChatContext, visibleChatState } from "../../../../private-case/chat-context";
import { CHAT_MAX_QUESTION, type ChatCapabilities, type ChatState, type ChatTurn } from "../../../../private-case/chat-model";
import { PrivateChatStore } from "../../../../private-case/chat-store";
import { cancelChatProcess, executeChatTurn } from "../../../../private-case/chat-runner";

export const runtime = "nodejs";
export const maxDuration = 360;

async function ownedChat(request: Request) {
  const owned = await loadOwnedCase(request);
  const scoped = await listAccessibleNotes(request);
  if (scoped.caseId !== owned.value.id) throw new PrivateCaseError("CASE_SCOPE_VIOLATION");
  if (scoped.memberId !== "owner") throw new PrivateCaseError("CASE_ACCESS_FORBIDDEN");
  const chat = new PrivateChatStore(owned.store.root);
  let research = null;
  try { research = await readResearch(owned.store.root, owned.value.id); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const subjects = new Map<string, { id: string; name: string }>();
  if (owned.value.subject.livingStatus === "deceased") subjects.set(owned.value.subject.personId, { id: owned.value.subject.personId, name: owned.value.subject.name });
  for (const person of research?.people || []) {
    if (person.livingStatus === "deceased") subjects.set(person.id, { id: person.id, name: person.name });
    if (person.livingStatus === "living") subjects.delete(person.id);
  }
  const publicSearchSubjects = [...subjects.values()];
  // The installed CLI completed a cached-search pass without any web_search
  // events while Code Mode host was disabled. Keep the verified private-answer
  // boundary; do not advertise search until a compatible adapter is verified.
  const capabilities: ChatCapabilities = { provider: "codex-chatgpt", webSearch: "unavailable", publicSearchSubject: subjects.get(owned.value.subject.personId)?.name || publicSearchSubjects[0]?.name || "", publicSearchSubjects };
  const response = (state: ChatState, status = 200) => privateJson({ ...visibleChatState(state, scoped.notes), capabilities }, status);
  return { ...owned, chat, notes: scoped.notes, capabilities, research, response };
}

export async function GET(request: Request) {
  try { const owned = await ownedChat(request); return owned.response(await owned.chat.recoverExpired(owned.value.id)); }
  catch (error) { return privateFailure(error); }
}

export async function POST(request: Request) {
  try {
    const owned = await ownedChat(request);
    const input = z.object({ question: z.string().trim().min(2).max(CHAT_MAX_QUESTION), expectedRevision: z.number().int().nonnegative(), searchWeb: z.boolean().default(false), searchSubjectId: privateId.optional() }).strict().safeParse(await boundedJson(request, 12 * 1024));
    if (!input.success) throw new PrivateCaseError("INVALID_REQUEST");
    if (input.data.searchWeb && owned.capabilities.webSearch === "unavailable") throw new PrivateCaseError("PUBLIC_SEARCH_UNAVAILABLE");
    const searchSubject = owned.capabilities.publicSearchSubjects.find(person => person.id === (input.data.searchSubjectId || owned.value.subject.personId)) || (!input.data.searchSubjectId ? owned.capabilities.publicSearchSubjects[0] : undefined);
    if ((input.data.searchWeb || input.data.searchSubjectId) && !searchSubject) throw new PrivateCaseError("PUBLIC_SEARCH_SCOPE_REQUIRED");
    const state = await owned.chat.recoverExpired(owned.value.id);
    const context = buildChatContext(owned.value, owned.research, owned.notes, state);
    const turn: ChatTurn = { id: randomUUID(), question: input.data.question, searchWeb: input.data.searchWeb, status: "running", createdAt: new Date().toISOString(), completedAt: null, answer: null, citations: [], web: { status: "not_requested", subject: input.data.searchWeb ? searchSubject!.name : "", ...(input.data.searchWeb ? { subjectId: searchSubject!.id } : {}), queries: [], leads: [], limitation: "" }, context: context.metadata, error: null };
    const saved = await owned.chat.begin(owned.value.id, input.data.expectedRevision, turn);
    after(() => executeChatTurn(owned.chat, owned.value.id, turn, context, searchSubject?.name || ""));
    return owned.response(saved, 202);
  } catch (error) { return privateFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const owned = await ownedChat(request);
    const input = z.object({ turnId: privateId }).strict().safeParse(await boundedJson(request, 1024));
    if (!input.success) throw new PrivateCaseError("INVALID_REQUEST");
    const state = await owned.chat.cancel(owned.value.id, input.data.turnId);
    cancelChatProcess(owned.store.root, owned.value.id, input.data.turnId);
    return owned.response(state);
  } catch (error) { return privateFailure(error); }
}
