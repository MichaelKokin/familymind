import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrivateCaseError, privateSourceSchema } from "@/private-case/model";
import { boundedJson, loadOwnedCase, privateFailure, privateJson } from "@/private-case/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { store, value } = await loadOwnedCase(request);
    const { expectedRevision, source } = z.object({ expectedRevision: z.number().int(), source: privateSourceSchema.omit({ id: true, observedAt: true }) }).strict().parse(await boundedJson(request));
    if (value.revision !== expectedRevision) throw new PrivateCaseError("STALE_REVISION");
    return privateJson(await store.save({ ...value, sources: [...value.sources, { ...source, id: randomUUID(), observedAt: new Date().toISOString() }] }, expectedRevision));
  } catch (error) { return privateFailure(error); }
}
