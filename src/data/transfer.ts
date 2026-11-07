import { DomainError, parseWorkspace, type Workspace } from "../domain/model";
import { MAX_PACKAGE_BYTES, validateWorkspaceFiles } from "./files";

export function exportPackage(workspace: Workspace): string {
  const validated = parseWorkspace(workspace);
  validateWorkspaceFiles(validated);
  const omittedFiles = validated.artifacts
    .filter((a) => a.dataUrl && !a.exportAllowed)
    .map((a) => a.id);
  const result = JSON.stringify(
    {
      format: "family-mind",
      version: 1,
      exportedAt: new Date().toISOString(),
      omittedFiles,
      workspace: {
        ...validated,
        artifacts: validated.artifacts.map((a) =>
          a.exportAllowed ? a : { ...a, dataUrl: null },
        ),
      },
    },
    null,
    2,
  );
  if (new TextEncoder().encode(result).length > MAX_PACKAGE_BYTES)
    throw new DomainError("PACKAGE_TOO_LARGE");
  return result;
}

export function importPackage(text: string): Workspace {
  if (
    text.length > MAX_PACKAGE_BYTES ||
    new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES
  )
    throw new DomainError("PACKAGE_TOO_LARGE");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new DomainError("INVALID_JSON");
  }
  if (!input || typeof input !== "object")
    throw new DomainError("INVALID_PACKAGE");
  const p = input as Record<string, unknown>;
  if (
    p.format !== "family-mind" ||
    p.version !== 1 ||
    !Array.isArray(p.omittedFiles) ||
    typeof p.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(p.exportedAt)) ||
    Object.keys(p).some(
      (k) =>
        ![
          "format",
          "version",
          "exportedAt",
          "omittedFiles",
          "workspace",
        ].includes(k),
    )
  )
    throw new DomainError("INVALID_PACKAGE");
  const workspace = parseWorkspace(p.workspace);
  for (const omitted of p.omittedFiles)
    if (
      typeof omitted !== "string" ||
      !workspace.artifacts.some(
        (a) => a.id === omitted && a.dataUrl === null && !a.exportAllowed,
      )
    )
      throw new DomainError("INVALID_PACKAGE");
  validateWorkspaceFiles(workspace);
  return workspace;
}
