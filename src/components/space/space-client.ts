import type { SpaceStateResponse } from "@/private-case/space-api";
import { MAX_MATERIAL_BYTES, type FindStatus, type MaterialKind } from "@/private-case/space-model";
import { spaceText as t } from "@/i18n/space";

export type SpaceState = SpaceStateResponse;
export type NewPersonIs = "parent" | "child" | "partner" | "other";
export type FindDecision = Exclude<FindStatus, "candidate">;
export type SpaceSelection =
  | { kind: "person"; id: string; nodeId: string | null }
  | { kind: "material"; id: string }
  | { kind: "find"; id: string }
  | { kind: "lead"; id: string }
  | null;
export type SpaceDialog =
  | { kind: "person"; anchorId: string | null; newPersonIs: NewPersonIs | null; editId: string | null }
  | { kind: "material"; personIds: string[]; editId: string | null; preset: MaterialKind | null }
  | { kind: "attach"; materialId: string }
  | { kind: "relationship"; editId: string | null; fromId: string | null }
  | { kind: "lead"; personId: string | null; editId: string | null; question: string }
  | { kind: "find"; leadId: string | null; personIds: string[] }
  | { kind: "decide"; findId: string; decision: FindDecision }
  | { kind: "leadOutcome"; leadId: string; outcome: "nothing_found" | "needs_detail" }
  | { kind: "import" }
  | { kind: "removed" }
  | null;

export class SpaceRequestError extends Error {
  constructor(readonly code: string, readonly status = 0) {
    super(code);
  }
}

export async function spaceApi<T>(path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/private/space${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result && typeof result === "object" && "error" in result && typeof (result as { error: unknown }).error === "string" ? (result as { error: string }).error : "REQUEST_FAILED";
      throw new SpaceRequestError(code, response.status);
    }
    return result as T;
  } catch (error) {
    if (controller.signal.aborted) throw new SpaceRequestError("REQUEST_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function spaceErrorText(error: unknown): string {
  const code = error instanceof SpaceRequestError ? error.code : "";
  return t.errors[code] ?? (error instanceof SpaceRequestError && error.status === 401 ? t.errors.UNAUTHORIZED : error instanceof SpaceRequestError && error.status === 403 ? t.errors.FORBIDDEN : t.errors.REQUEST_FAILED);
}

export const mediaUrl = (materialId: string) => `/api/private/space/media?id=${encodeURIComponent(materialId)}`;

export type MaterialFile = { name: string; mime: string; dataUrl: string };

export async function readMaterialFile(file: File): Promise<MaterialFile> {
  if (!file.size) throw new SpaceRequestError("EMPTY_FILE");
  if (file.size > MAX_MATERIAL_BYTES) throw new SpaceRequestError("INVALID_MATERIAL_FILE");
  const mime = file.type || (file.name.toLowerCase().endsWith(".txt") ? "text/plain" : "");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { name: file.name, mime, dataUrl: `data:${mime};base64,${btoa(binary)}` };
}

export function template(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "");
}

export function formatBytes(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatWhen(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(value));
}
