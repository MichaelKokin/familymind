import { clearSessionCookie } from "@/private-case/access";
import { privateFailure, privateJson, privateRuntime } from "@/private-case/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await privateRuntime().access.revoke(request);
    return privateJson({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  } catch (error) { return privateFailure(error); }
}
