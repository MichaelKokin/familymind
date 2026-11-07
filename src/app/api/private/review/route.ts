import { z } from "zod";
import { privateId } from "@/private-case/model";
import { boundedJson, loadOwnedCase, privateFailure, privateJson } from "@/private-case/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { store, value } = await loadOwnedCase(request);
    const input = z.object({ expectedRevision: z.number().int(), runId: privateId, proposalId: privateId, decision: z.enum(["accepted", "rejected"]), reason: z.string().trim().min(1).max(30000) }).strict().parse(await boundedJson(request));
    return privateJson(await store.applyReview(value.id, input));
  } catch (error) { return privateFailure(error); }
}
