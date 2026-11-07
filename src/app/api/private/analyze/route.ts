import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { PrivateCaseError, privateId, type AIRun } from "@/private-case/model";
import { executeCaseRun, researchPrompt } from "@/private-case/codex-runner";
import { methodology } from "@/private-case/methodology";
import { boundedJson, loadOwnedCase, privateFailure, privateJson } from "@/private-case/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { store, value } = await loadOwnedCase(request);
    const input = z.object({ expectedRevision: z.number().int(), question: z.string().trim().min(5).max(1000), sourceIds: z.array(privateId).min(1).max(100) }).strict().parse(await boundedJson(request));
    if (input.expectedRevision !== value.revision) throw new PrivateCaseError("STALE_REVISION");
    if (value.aiRuns.some(r => ["queued", "running"].includes(r.status))) throw new PrivateCaseError("ACTIVE_RUN");
    if (new Set(input.sourceIds).size !== input.sourceIds.length || input.sourceIds.some(id => !value.sources.some(s => s.id === id))) throw new PrivateCaseError("SOURCE_SCOPE_VIOLATION");
    const run: AIRun = { id: randomUUID(), status: "running", mode: "codex-cli", provider: "Codex · текущая авторизация ChatGPT", model: null, methodology, question: input.question, sourceIds: input.sourceIds, startedAt: new Date().toISOString(), completedAt: null, result: null, resultDigest: null, error: null };
    researchPrompt(value, run); // Validate scope and size before recording/starting a call.
    const saved = await store.save({ ...value, question: input.question, aiRuns: [...value.aiRuns, run] }, input.expectedRevision);
    after(() => executeCaseRun(store, saved, run));
    return privateJson(saved, 202);
  } catch (error) { return privateFailure(error); }
}
