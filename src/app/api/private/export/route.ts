import { loadOwnedCase, privateFailure, privateHeaders } from "@/private-case/runtime";
import { buildEvidenceRegisters } from "@/private-case/evidence-adapter";
import { methodology } from "@/private-case/methodology";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { value } = await loadOwnedCase(request);
    if (new URL(request.url).searchParams.get("format") === "registers") {
      return new Response(JSON.stringify({ methodology, ...buildEvidenceRegisters(value) }, null, 2), { headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="familymind-evidence-registers.json"' } });
    }
    return new Response(JSON.stringify(value, null, 2), { headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="familymind-private-case.json"' } });
  } catch (error) { return privateFailure(error); }
}
