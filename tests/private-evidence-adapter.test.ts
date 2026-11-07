import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEvidenceRegisters, EVIDENCE_COLUMNS, type EvidenceRegisters } from "../src/private-case/evidence-adapter";
import type { PrivateCase } from "../src/private-case/model";

const vendor = path.resolve("vendor/ex-ussr-kinship-research");
const now = "2026-11-06T00:00:00.000Z";
function fixture(): PrivateCase {
  return {
    schemaVersion: 1, id: "synthetic_case", title: "Только синтетические данные", revision: 0, updatedAt: now,
    subject: { personId: "synthetic_person", name: "Анна Тестовая", dateText: "около 1900, событие не установлено", livingStatus: "unknown" },
    sources: ["original", "copy"].map((suffix) => ({
      id: `source_${suffix}`, title: `Синтетическая копия ${suffix}`, url: `https://example.test/${suffix}`, locator: "Карточка, раздел 1", excerpt: "Условный текст, с запятой\nи \"кавычками\".", kind: "user_tree", observedAt: now, independenceGroup: "same_original",
    })),
    known: [{ id: "known_date", text: "=SYNTHETIC_FORMULA()", sourceIds: ["source_original", "source_copy"], status: "tree_assertion" }],
    question: "Что требуется проверить?", notes: "Полностью вымышленное дело.", aiRuns: [], reviews: [],
  };
}

async function audit(bundle: EvidenceRegisters) {
  const directory = await mkdtemp(path.join(tmpdir(), "family-mind-synthetic-audit-"));
  try {
    for (const [filename, content] of Object.entries(bundle.files)) await writeFile(path.join(directory, filename), content, { mode: 0o600 });
    const result = spawnSync("python3", ["-B", path.join(vendor, "scripts/audit_evidence.py"), "--case-dir", directory, "--json", "--strict"], { encoding: "utf8", timeout: 10_000 });
    if (result.error) throw result.error;
    expect(result.stderr).toBe("");
    return { status: result.status, result: JSON.parse(result.stdout) as { counts: Record<string, number>; errors: string[]; warnings: string[]; summary: { claims_by_status: Record<string, number> } } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("pinned evidence CSV adapter", () => {
  it("matches the exact pinned templates and verifies local audit code hashes", async () => {
    const provenance = JSON.parse(await readFile(path.join(vendor, "PROVENANCE.json"), "utf8")) as { files: Record<string, { sha256: string; bytes: number }> };
    for (const filename of [...Object.keys(EVIDENCE_COLUMNS).map((name) => `assets/${name}`), "scripts/audit_evidence.py", "scripts/research_common.py"]) {
      const raw = await readFile(path.join(vendor, filename));
      expect(raw.length).toBe(provenance.files[filename].bytes);
      expect(createHash("sha256").update(raw).digest("hex")).toBe(provenance.files[filename].sha256);
    }
    for (const [filename, header] of Object.entries(EVIDENCE_COLUMNS)) expect((await readFile(path.join(vendor, "assets", filename), "utf8")).trim()).toBe(header);
  });
  it("exports provenance without inventing relationships, dates or independent support", async () => {
    const value = fixture();
    const before = structuredClone(value);
    const bundle = buildEvidenceRegisters(value);
    expect(value).toEqual(before);
    expect(bundle.counts).toEqual({ persons: 1, artifacts: 2, claims: 1, relationships: 0 });
    expect(bundle.files["claims-register.csv"]).toContain('"\'=SYNTHETIC_FORMULA()"');
    expect(bundle.files["claims-register.csv"]).toContain('"same_original"');
    expect(bundle.files["claims-register.csv"]).toContain('"hypothesis"');
    expect(bundle.files["artifact-register.csv"]).toContain('"Условный текст, с запятой\nи ""кавычками""."');
    expect(bundle.files["relationship-register.csv"].trim()).toBe(EVIDENCE_COLUMNS["relationship-register.csv"]);
    expect(bundle.files["person-register.csv"]).toContain('"unknown"');
    const checked = await audit(bundle);
    expect(checked.status).toBe(0);
    expect(checked.result.errors).toEqual([]);
    expect(checked.result.warnings).toEqual([]);
    expect(checked.result.summary.claims_by_status).toEqual({ hypothesis: 1 });
    expect(checked.result.counts.relationships).toBe(0);
  });
  it("keeps unknown independence explicit and upstream audit flags inflated corroboration", async () => {
    const value = fixture();
    delete value.sources[0].independenceGroup;
    const unknown = buildEvidenceRegisters(value);
    expect(unknown.limitations.some((line) => line.includes("независимость не установлена"))).toBe(true);
    const unknownAudit = await audit(unknown);
    expect(unknownAudit.status).toBe(1);
    expect(unknownAudit.result.warnings.some((line) => line.includes("source_original") && line.includes("independence_group"))).toBe(true);
    const inflated = buildEvidenceRegisters(fixture());
    inflated.files["claims-register.csv"] = inflated.files["claims-register.csv"].replace('"hypothesis"', '"corroborated"');
    const inflatedAudit = await audit(inflated);
    expect(inflatedAudit.status).toBe(1);
    expect(inflatedAudit.result.warnings.some((line) => line.includes("независимых групп: 1"))).toBe(true);
  });
});
