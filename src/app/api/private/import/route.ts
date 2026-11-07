import { z } from "zod";
import { parsePrivateCase, PrivateCaseError } from "@/private-case/model";
import { boundedJson, loadOwnedCase, privateFailure, privateJson } from "@/private-case/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { store, value } = await loadOwnedCase(request);
    const input = z.object({ expectedRevision: z.number().int(), case: z.unknown() }).strict().parse(await boundedJson(request, 4 * 1024 * 1024));
    const restored = parsePrivateCase(input.case);
    if (restored.id !== value.id) throw new PrivateCaseError("CASE_SCOPE_VIOLATION");
    if ([...value.aiRuns, ...restored.aiRuns].some(r => ["running", "queued"].includes(r.status))) throw new PrivateCaseError("ACTIVE_RUN");
    return privateJson(await store.save(restored, input.expectedRevision));
  } catch (error) { return privateFailure(error); }
}
