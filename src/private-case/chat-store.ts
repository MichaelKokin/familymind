import path from "node:path";
import { assertPrivateId, PrivateCaseError } from "./model";
import { ensurePrivateRoot, ensurePrivateDir, readPrivateJson, writePrivateJson, withPrivateLock } from "./server-store";
import { CHAT_MAX_TURNS, parseChatState, type ChatState, type ChatTurn } from "./chat-model";

export class PrivateChatStore {
  constructor(readonly root: string) {}
  private directory() { return path.join(this.root, "chat"); }
  private filename(caseId: string) { return path.join(this.directory(), `${assertPrivateId(caseId)}.json`); }
  async load(caseId: string): Promise<ChatState> {
    await ensurePrivateRoot(this.root); await ensurePrivateDir(this.directory());
    const data = await readPrivateJson(this.filename(caseId));
    return data === null ? { schemaVersion: 1, caseId, revision: 0, turns: [] } : parseChatState(data, caseId);
  }
  private async mutate(caseId: string, fn: (state: ChatState) => ChatState): Promise<ChatState> {
    await ensurePrivateRoot(this.root);
    return withPrivateLock(this.directory(), assertPrivateId(caseId), async () => {
      const current = await this.load(caseId);
      const next = parseChatState(fn(structuredClone(current)), caseId);
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      next.revision = current.revision + 1;
      if (current.revision) {
        await ensurePrivateDir(path.join(this.root, "chat-backups"));
        await writePrivateJson(path.join(this.root, "chat-backups", caseId, `${current.revision}.json`), current);
      }
      await writePrivateJson(this.filename(caseId), next);
      return next;
    });
  }
  async begin(caseId: string, expectedRevision: number, turn: ChatTurn) {
    return this.mutate(caseId, state => {
      if (state.revision !== expectedRevision) throw new PrivateCaseError("STALE_REVISION");
      if (state.turns.some(t => t.status === "running")) throw new PrivateCaseError("CHAT_ACTIVE_RUN");
      if (state.turns.length >= CHAT_MAX_TURNS) throw new PrivateCaseError("CHAT_HISTORY_FULL");
      if (turn.status !== "running" || state.turns.some(t => t.id === turn.id)) throw new PrivateCaseError("INVALID_CHAT");
      return { ...state, turns: [...state.turns, turn] };
    });
  }
  async finish(caseId: string, turnId: string, update: Pick<ChatTurn, "status" | "answer" | "citations" | "error" | "web">) {
    assertPrivateId(turnId);
    return this.mutate(caseId, state => {
      const turn = state.turns.find(t => t.id === turnId);
      if (!turn) throw new PrivateCaseError("CHAT_TURN_NOT_FOUND");
      if (turn.status !== "running") return state; // cancellation/terminal answers cannot be overwritten.
      if (update.status === "running") throw new PrivateCaseError("INVALID_CHAT");
      return { ...state, turns: state.turns.map(t => t.id === turnId ? { ...t, ...update, completedAt: new Date().toISOString() } : t) };
    });
  }
  async cancel(caseId: string, turnId: string) {
    const state = await this.load(caseId), turn = state.turns.find(t => t.id === turnId);
    if (!turn) throw new PrivateCaseError("CHAT_TURN_NOT_FOUND");
    return this.finish(caseId, turnId, { status: "cancelled", answer: null, citations: [], error: null, web: turn.web });
  }
  async recoverExpired(caseId: string) {
    const state = await this.load(caseId);
    const active = state.turns.find(t => t.status === "running" && Date.now() - Date.parse(t.createdAt) > 360_000);
    return active ? this.finish(caseId, active.id, { status: "interrupted", answer: null, citations: [], error: "CHAT_INTERRUPTED", web: active.web }) : state;
  }
}
