import { describe, expect, it } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace } from "../src/domain/seed";
import { parseWorkspace } from "../src/domain/model";
import {
  evidenceSummary,
  findConflicts,
  reviewProposal,
} from "../src/domain/evidence";
import { exportPackage, importPackage } from "../src/data/transfer";
import { readArtifactFile, validateWorkspaceFiles } from "../src/data/files";

describe("evidence invariants", () => {
  it("keeps namesakes separate and exposes contradictory dates", () => {
    const w = createDemoWorkspace();
    const namesakes = w.people.filter((p) => p.name === "Алексей Ветров");
    expect(namesakes).toHaveLength(2);
    expect(new Set(namesakes.map((p) => p.id)).size).toBe(2);
    expect(findConflicts(w)).toEqual([
      {
        personId: "person-alexey",
        predicate: "Год рождения",
        claimIds: ["claim-birth-1898", "claim-birth-1900"],
        values: ["1898", "1900"],
      },
    ]);
    expect(w.people[0].calendar).toBe("unknown");
    expect(w.people[2].dateText).toBe("около 1870");
  });

  it("does not count a mirror as an independent original, even with a different group label", () => {
    const summary = evidenceSummary(createDemoWorkspace(), "claim-birth-1898");
    expect(summary.supports).toHaveLength(2);
    expect(summary.independentCount).toBe(1);
    expect(summary.duplicateCount).toBe(1);
    expect(summary.contradicts).toHaveLength(1);
  });

  it("collapses claim-specific shared origins and case variants transitively", () => {
    const w = createDemoWorkspace();
    w.evidence.find((e) => e.id === "evidence-birth-copy")!.independenceGroup =
      "BIRTH-CHAIN";
    w.sources.find((s) => s.id === "source-birth-copy")!.originalId =
      "another-original";
    expect(evidenceSummary(w, "claim-birth-1898").independentCount).toBe(1);
  });

  it("records an acceptance or rejection without upgrading evidence or merging people", () => {
    const w = createDemoWorkspace();
    const accepted = reviewProposal(
      w,
      "relationship-parent",
      "accepted",
      "Сохраняем версию для дальнейшей проверки.",
    );
    expect(accepted.relationships[0].workflowStatus).toBe("accepted");
    expect(accepted.relationships[0].evidenceStatus).toBe("hypothesis");
    expect(accepted.reviews.at(-1)?.evidenceStatusAtDecision).toBe(
      "hypothesis",
    );
    expect(accepted.people).toEqual(w.people);
    expect(w.relationships[0].workflowStatus).toBe("proposed");
    const rejected = reviewProposal(
      accepted,
      "relationship-parent",
      "rejected",
      "Недостаточно данных.",
    );
    expect(rejected.relationships[0].evidenceStatus).toBe("hypothesis");
    expect(rejected.reviews).toHaveLength(w.reviews.length + 2);
    expect(() =>
      reviewProposal(w, "relationship-parent", "accepted", "  "),
    ).toThrow("REVIEW_REASON_REQUIRED");
  });

  it("blocks an inflated corroboration status and unsupported single-source claims", () => {
    const w = createDemoWorkspace();
    w.claims[0].evidenceStatus = "corroborated";
    expect(() => parseWorkspace(w)).toThrow("CORROBORATION_REQUIREMENTS");
    const other = createDemoWorkspace();
    other.relationships[0].evidenceStatus = "single-source";
    expect(() => parseWorkspace(other)).toThrow("SUPPORT_REQUIRED");
    const unlogged = createDemoWorkspace();
    unlogged.relationships[0].workflowStatus = "accepted";
    expect(() => parseWorkspace(unlogged)).toThrow("REVIEW_RECORD_REQUIRED");
  });

  it("accepts independent support only after conflicts are addressed, with a rationale", () => {
    const w = createDemoWorkspace();
    w.sources.push({
      ...w.sources[0],
      id: "source-other",
      originalId: "original-other",
    });
    w.evidence.push({
      ...w.evidence.find((e) => e.id === "evidence-place")!,
      id: "evidence-other",
      sourceId: "source-other",
      artifactId: null,
      independenceGroup: "other-chain",
    });
    w.claims.find((c) => c.id === "claim-place")!.evidenceStatus =
      "corroborated";
    expect(parseWorkspace(w).claims[2].evidenceStatus).toBe("corroborated");
    w.claims[2].evidenceStatus = "strongly-corroborated";
    expect(() => parseWorkspace(w)).toThrow(
      "STRONG_CORROBORATION_REQUIREMENTS",
    );
    w.claims[2].alternativesReviewed = true;
    expect(parseWorkspace(w).claims[2].evidenceStatus).toBe(
      "strongly-corroborated",
    );
  });

  it("rejects duplicate IDs, dangling references, incompatible artifact links and non-synthetic data", () => {
    const duplicate = createDemoWorkspace();
    duplicate.people[1].id = duplicate.people[0].id;
    expect(() => parseWorkspace(duplicate)).toThrow("DUPLICATE_ID");
    const dangling = createDemoWorkspace();
    dangling.claims[0].personId = "foreign-person";
    expect(() => parseWorkspace(dangling)).toThrow("DANGLING_REFERENCE");
    const wrongArtifact = createDemoWorkspace();
    wrongArtifact.evidence[0].artifactId = "artifact-census";
    expect(() => parseWorkspace(wrongArtifact)).toThrow("DANGLING_REFERENCE");
    expect(() =>
      parseWorkspace({ ...createEmptyWorkspace(), synthetic: false }),
    ).toThrow("INVALID_SCHEMA");
    expect(() =>
      parseWorkspace({ ...createEmptyWorkspace(), unexpected: "field" }),
    ).toThrow("INVALID_SCHEMA");
    const unsafeSource = createDemoWorkspace();
    unsafeSource.sources[0].url = "javascript:alert(1)";
    expect(() => parseWorkspace(unsafeSource)).toThrow("INVALID_SCHEMA");
    unsafeSource.sources[0].url = "https://";
    expect(() => parseWorkspace(unsafeSource)).toThrow("INVALID_SCHEMA");
    unsafeSource.sources[0].url = "https://secret@example.test/";
    expect(() => parseWorkspace(unsafeSource)).toThrow("INVALID_SCHEMA");
  });

  it("requires coverage for negative research and explicit results before resolution", () => {
    const w = createDemoWorkspace();
    w.runs[0].outcome = "not_found";
    w.runs[0].coverage = "";
    expect(() => parseWorkspace(w)).toThrow("SEARCH_COVERAGE_REQUIRED");
    w.runs[0].outcome = "blocked";
    expect(parseWorkspace(w).runs[0].outcome).toBe("blocked");
    w.questions[0].status = "resolved";
    expect(() => parseWorkspace(w)).toThrow("RESEARCH_RESULT_REQUIRED");
  });
});

describe("portable packages and attachment safety", () => {
  it("round-trips all metadata, original bytes, positions, review logs and research", () => {
    const w = reviewProposal(
      createDemoWorkspace(),
      "relationship-parent",
      "accepted",
      "Только версия.",
    );
    w.positions["person-alexey"] = { x: 12.5, y: -80 };
    expect(importPackage(exportPackage(w))).toEqual(w);
  });

  it("omits only files without export permission, preserving provenance and transcription", () => {
    const w = createDemoWorkspace();
    w.artifacts[0].exportAllowed = false;
    const encoded = exportPackage(w);
    const decoded = importPackage(encoded);
    expect(JSON.parse(encoded).omittedFiles).toEqual(["artifact-birth"]);
    expect(decoded.artifacts[0]).toEqual({ ...w.artifacts[0], dataUrl: null });
    expect(decoded.evidence).toEqual(w.evidence);
    expect(w.artifacts[0].dataUrl).not.toBeNull();
  });

  it("rejects unknown schema versions, corrupt bytes, deceptive MIME and unsafe filenames", () => {
    const input = JSON.parse(exportPackage(createDemoWorkspace()));
    input.version = 2;
    expect(() => importPackage(JSON.stringify(input))).toThrow(
      "INVALID_PACKAGE",
    );
    input.version = 1;
    input.workspace.schemaVersion = 2;
    expect(() => importPackage(JSON.stringify(input))).toThrow(
      "INVALID_SCHEMA",
    );
    const w = createDemoWorkspace();
    w.artifacts[0].mime = "image/png";
    w.artifacts[0].dataUrl = w.artifacts[0].dataUrl!.replace(
      "text/plain",
      "image/png",
    );
    expect(() => validateWorkspaceFiles(w)).toThrow("INVALID_ATTACHMENT");
    w.artifacts[0].name = "../payload.txt";
    expect(() => validateWorkspaceFiles(w)).toThrow("UNSAFE_FILENAME");
    expect(() => importPackage("{")).toThrow("INVALID_JSON");
  });

  it("checks upload size and content before creating an attachment", async () => {
    const valid = await readArtifactFile(
      new File(["Синтетический текст"], "demo.txt", { type: "text/plain" }),
    );
    expect(valid.dataUrl).toMatch(/^data:text\/plain;base64,/);
    await expect(
      readArtifactFile(
        new File(["<svg></svg>"], "demo.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow("UNSUPPORTED_FILE");
    await expect(
      readArtifactFile(
        new File(["not a png"], "fake.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("UNSUPPORTED_FILE");
    await expect(
      readArtifactFile(new File([""], "empty.txt", { type: "text/plain" })),
    ).rejects.toThrow("EMPTY_FILE");
    await expect(
      readArtifactFile(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.txt", {
          type: "text/plain",
        }),
      ),
    ).rejects.toThrow("FILE_TOO_LARGE");
  });

  it("validates an allowed maximum-sized file without regex stack exhaustion", async () => {
    const file = await readArtifactFile(
      new File(["x".repeat(5 * 1024 * 1024)], "limit.txt", {
        type: "text/plain",
      }),
    );
    const w = createDemoWorkspace();
    w.artifacts[0] = { ...w.artifacts[0], ...file };
    expect(() => validateWorkspaceFiles(w)).not.toThrow();
    w.artifacts = Array.from({ length: 5 }, (_, index) => ({
      ...w.artifacts[0],
      id: `large-${index}`,
    }));
    expect(() => validateWorkspaceFiles(w)).toThrow("FILES_TOTAL_TOO_LARGE");
  });
});
