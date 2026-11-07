import { loadOwnedCase, privateFailure, privateJson } from "@/private-case/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return privateJson((await loadOwnedCase(request)).value); }
  catch (error) { return privateFailure(error); }
}
