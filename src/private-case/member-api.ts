import { z } from "zod";
import { clearSessionCookie } from "./access";
import { memberSessionCookie, clearMemberCookie } from "./member-access";
import { memberRuntime, memberFailure, peopleForMember } from "./notes-runtime";
import { boundedJson, privateJson } from "./runtime";
import { privateId, PrivateCaseError } from "./model";


export async function GET(request: Request) {
  try {
    const { access, notes, store } = memberRuntime();
    const principal = await access.require(request);
    const [account, people] = await Promise.all([notes.account(principal), peopleForMember(store.root, principal, store)]);
    return privateJson({ principal, ...account, people });
  } catch (error) { return memberFailure(error); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), displayName: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal("exchange"), token: z.string().max(100) }).strict(),
  z.object({ action: z.literal("revoke"), memberId: privateId }).strict(),
  z.object({ action: z.literal("reinvite"), memberId: privateId }).strict(),
  z.object({ action: z.literal("logout") }).strict(),
]);
export async function POST(request: Request) {
  try {
    const parsed = actionSchema.safeParse(await boundedJson(request, 2048));
    if (!parsed.success) throw new PrivateCaseError("INVALID_REQUEST");
    const action = parsed.data;
    const { access, notes, store } = memberRuntime();
    if (action.action === "exchange") {
      const session = await access.exchange(request, action.token);
      if (!await store.load(session.caseId)) throw new PrivateCaseError("CASE_NOT_FOUND");
      const response = privateJson({ memberId: session.memberId, expiresAt: session.expiresAt });
      response.headers.append("Set-Cookie", memberSessionCookie(session.token, session.expiresAt));
      // An invitation is an explicit switch to a lesser notes-only identity in this browser.
      response.headers.append("Set-Cookie", clearSessionCookie());
      return response;
    }
    if (action.action === "logout") {
      await access.revokeSession(request);
      return privateJson({ ok: true }, 200, { "Set-Cookie": clearMemberCookie() });
    }
    const owner = await access.requireOwner(request);
    if (!await store.load(owner.caseId)) throw new PrivateCaseError("CASE_NOT_FOUND");
    if (action.action === "invite") return privateJson(await access.invite(request, action.displayName), 201);
    if (action.action === "reinvite") return privateJson(await access.reinvite(request, action.memberId), 201);
    await notes.revokeMember(owner, action.memberId);
    return privateJson({ ok: true });
  } catch (error) { return memberFailure(error); }
}
