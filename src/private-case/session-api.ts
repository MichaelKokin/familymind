import { z } from "zod";
import { sessionCookie } from "./access";
import { clearMemberCookie } from "./member-access";
import { boundedJson, privateFailure, privateJson, privateRuntime } from "./runtime";

export async function POST(request: Request) {
  try {
    const { token } = z.object({ token: z.string().max(100) }).strict().parse(await boundedJson(request, 1024));
    const { access, store } = privateRuntime();
    const session = await access.exchange(request, token);
    if (!await store.load(session.caseId)) throw new Error("missing case");
    const response = privateJson({ caseId: session.caseId });
    response.headers.append("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    // Explicit owner sign-in replaces the browser's previous member identity.
    // Ordinary requests with a stale member cookie still fail closed.
    response.headers.append("Set-Cookie", clearMemberCookie());
    return response;
  } catch (error) { return privateFailure(error); }
}
