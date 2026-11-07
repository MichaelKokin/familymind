import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRepository } from "../src/data/repository";
import { createDemoWorkspace, createEmptyWorkspace } from "../src/domain/seed";
import { exportPackage, importPackage } from "../src/data/transfer";

const repositories: WorkspaceRepository[] = [];
function repository(name = `test-${crypto.randomUUID()}`) {
  const repo = new WorkspaceRepository(name);
  repositories.push(repo);
  return repo;
}
afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => repo.close()));
});

describe("atomic IndexedDB repository", () => {
  it("saves an edited person and original file, then reloads through a new connection", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = repository(name);
    expect(await first.load()).toBeNull();
    const w = createDemoWorkspace();
    w.people[0].notes = "Синтетическое уточнение";
    w.positions["person-alexey"] = { x: 48, y: 96 };
    const saved = await first.save(w, null);
    expect(saved.revision).toBe(1);
    await first.close();
    expect(await repository(name).load()).toEqual(saved);
  });

  it("rejects a stale tab without overwriting the newer persisted change", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = repository(name),
      second = repository(name);
    const initial = await first.save(createDemoWorkspace(), null);
    const tabTwo = await second.load();
    const changed = await first.save(
      { ...initial, title: "Новая версия" },
      initial.revision,
    );
    await expect(
      second.save({ ...tabTwo!, title: "Устаревшая версия" }, tabTwo!.revision),
    ).rejects.toThrow("STALE_REVISION");
    expect(await second.load()).toEqual(changed);
  });

  it("serializes simultaneous writes so exactly one revision succeeds", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = repository(name),
      second = repository(name);
    const initial = await first.save(createEmptyWorkspace(), null);
    const results = await Promise.allSettled([
      first.save({ ...initial, title: "Первый" }, 1),
      second.save({ ...initial, title: "Второй" }, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await first.load())!.revision).toBe(2);
  });

  it("leaves the saved workspace untouched when import or validation fails", async () => {
    const repo = repository();
    const saved = await repo.save(createDemoWorkspace(), null);
    const invalid = JSON.parse(exportPackage(saved));
    invalid.workspace.evidence[0].sourceId = "missing-source";
    expect(() => importPackage(JSON.stringify(invalid))).toThrow(
      "DANGLING_REFERENCE",
    );
    await expect(
      repo.save(
        {
          ...saved,
          artifacts: saved.artifacts.map((a) => ({ ...a, size: a.size + 1 })),
        },
        saved.revision,
      ),
    ).rejects.toThrow("INVALID_ATTACHMENT");
    expect(await repo.load()).toEqual(saved);
  });

  it("replaces a workspace atomically with a portable import and monotonic local revision", async () => {
    const repo = repository();
    const original = await repo.save(createDemoWorkspace(), null);
    const portable = exportPackage(original);
    const empty = await repo.save(createEmptyWorkspace(), original.revision);
    expect(empty.people).toHaveLength(0);
    const restored = await repo.save(importPackage(portable), empty.revision);
    expect(restored.people).toEqual(original.people);
    expect(restored.artifacts).toEqual(original.artifacts);
    expect(restored.revision).toBe(3);
    expect(await repo.load()).toEqual(restored);
  });
});
