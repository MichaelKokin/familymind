import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import { PrivateCaseStore } from "../src/private-case/server-store";
import { applySpaceAction, initialSpace, spaceActionSchema, type SpaceContext } from "../src/private-case/space-logic";
import { parsePrivateSpace, type PrivateSpace } from "../src/private-case/space-model";
import { PrivateSpaceStore, detectMaterialMime } from "../src/private-case/space-store";
import { addMaterial, exportSpace, getSpace, importSpace, mergeImportedSpace, mutateSpace, serveMedia, type SpaceBundle, type SpaceStateResponse } from "../src/private-case/space-api";
import { peopleForMember } from "../src/private-case/notes-runtime";
import { syntheticResearch } from "../e2e/fixtures/private-research";

const now = "2026-11-07T10:00:00.000Z";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==", "base64");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let counter = 0;
const context = (overrides: Partial<SpaceContext> = {}): SpaceContext => ({
  now,
  snapshotPeopleIds: new Set(["synthetic-a", "synthetic-b"]),
  snapshotOwnerId: "synthetic-b",
  snapshotRelationships: [{ from: "synthetic-a", to: "synthetic-b", kind: "parent_child" }],
  newId: (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`,
  ...overrides,
});
const emptySpace = () => initialSpace("case_synthetic", "a".repeat(64), now);

describe("private space reducer", () => {
  it("adds an explicitly related person, keeps namesakes separate and records the journal", () => {
    let space = emptySpace();
    const first = applySpaceAction(space, { action: "add_person", person: { name: "Пётр Учебный", dateText: "около 1960", livingStatus: "unknown", notes: "" }, asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "parent", parentRole: "father", label: "", rationale: "" } }, context());
    space = first.space;
    expect(space.people).toHaveLength(1);
    expect(space.relationships[0]).toMatchObject({ from: first.created.personId, to: "synthetic-b", kind: "parent_child", parentRole: "father", evidenceStatus: "hypothesis", origin: "owner_statement" });
    expect(space.journal.map((entry) => entry.action)).toEqual(["migrated", "add_person", "add_relationship"]);
    const namesake = applySpaceAction(space, { action: "add_person", person: { name: "Пётр Учебный", dateText: "", livingStatus: "unknown", notes: "" }, asOwner: false }, context());
    expect(namesake.space.people).toHaveLength(2);
    expect(new Set(namesake.space.people.map((person) => person.id)).size).toBe(2);
    expect(() => applySpaceAction(space, { action: "add_person", person: { name: "X", dateText: "", livingStatus: "unknown", notes: "" }, asOwner: false, relation: { anchorPersonId: "missing", newPersonIs: "child", label: "", rationale: "" } }, context())).toThrow("PERSON_NOT_FOUND");
    expect(() => applySpaceAction(space, { action: "add_relationship", from: "synthetic-a", to: "synthetic-b", relation: { kind: "parent_child", parentRole: "mother", label: "", rationale: "" } }, context())).toThrow("DUPLICATE_RELATIONSHIP");
    expect(() => applySpaceAction(space, { action: "add_relationship", from: "synthetic-a", to: "synthetic-b", relation: { kind: "other", label: "", rationale: "" } }, context())).toThrow("LABEL_REQUIRED");
    expect(() => applySpaceAction(space, { action: "update_person", id: "synthetic-a", person: { name: "Переименован" } }, context())).toThrow("SNAPSHOT_READ_ONLY");
    expect(() => applySpaceAction(space, { action: "add_person", person: { name: "Я", dateText: "", livingStatus: "living", notes: "" }, asOwner: true }, context())).toThrow("OWNER_ALREADY_SET");
  });
  it("sets an owner only without a snapshot owner and never removes the centre", () => {
    const noSnapshot = context({ snapshotPeopleIds: new Set(), snapshotOwnerId: null, snapshotRelationships: [] });
    const owner = applySpaceAction(initialSpace("case_synthetic", null, now), { action: "add_person", person: { name: "Я", dateText: "", livingStatus: "living", notes: "" }, asOwner: true }, noSnapshot);
    expect(owner.space.ownerPersonId).toBe(owner.created.personId);
    expect(owner.space.base.kind).toBe("none");
    expect(() => applySpaceAction(owner.space, { action: "remove_person", id: owner.created.personId! }, noSnapshot)).toThrow("OWNER_REQUIRED");
  });
  it("soft-removes and restores records, keeps layout separate from facts and dismisses guide steps", () => {
    let space = emptySpace();
    const added = applySpaceAction(space, { action: "add_person", person: { name: "Ребёнок", dateText: "", livingStatus: "living", notes: "" }, asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "child", parentRole: "father", label: "", rationale: "" } }, context());
    space = added.space;
    expect(space.relationships[0]).toMatchObject({ from: "synthetic-b", to: added.created.personId, parentRole: "father" });
    space = applySpaceAction(space, { action: "layout", positions: { [`person:${added.created.personId}`]: { x: 10.4, y: -20 } } }, context()).space;
    expect(space.layout.positions[`person:${added.created.personId}`]).toEqual({ x: 10.4, y: -20 });
    const removed = applySpaceAction(space, { action: "remove_person", id: added.created.personId! }, context()).space;
    expect(removed.people[0].removedAt).toBe(now);
    expect(removed.relationships[0].removedAt).toBeNull();
    expect(removed.layout.positions).toEqual(space.layout.positions);
    const restored = applySpaceAction(removed, { action: "restore_person", id: added.created.personId! }, context()).space;
    expect(restored.people[0].removedAt).toBeNull();
    const reset = applySpaceAction(restored, { action: "reset_layout", nodeIds: [`person:${added.created.personId}`] }, context()).space;
    expect(reset.layout.positions).toEqual({});
    const dismissed = applySpaceAction(reset, { action: "guide_dismiss", key: "parent:synthetic-b" }, context()).space;
    expect(dismissed.guide.dismissed).toEqual(["parent:synthetic-b"]);
    expect(applySpaceAction(dismissed, { action: "guide_reset" }, context()).space.guide.dismissed).toEqual([]);
    expect(spaceActionSchema.safeParse({ action: "layout", positions: { "../x": { x: 0, y: 0 } } }).success).toBe(false);
    expect(spaceActionSchema.safeParse({ action: "add_person", person: { name: "A", dateText: "", livingStatus: "unknown", notes: "" }, caseId: "other" }).success).toBe(false);
  });
  it("validates materials by kind and refuses invented people", () => {
    const space = emptySpace();
    const original = { name: "demo.png", mime: "image/png" as const, size: PNG.length, sha256: sha(PNG) };
    const photo = applySpaceAction(space, { action: "add_material", material: { kind: "photo", title: "Фото", text: "", url: "", provenance: "Семейный альбом", dateText: "", personIds: ["synthetic-b"] }, original }, context());
    expect(photo.space.materials[0].original).toEqual(original);
    expect(() => applySpaceAction(space, { action: "add_material", material: { kind: "note", title: "Пустая", text: "", url: "", provenance: "", dateText: "", personIds: [] }, original: null }, context())).toThrow("INVALID_MATERIAL");
    expect(() => applySpaceAction(space, { action: "add_material", material: { kind: "link", title: "Ссылка", text: "", url: "javascript:alert(1)", provenance: "", dateText: "", personIds: [] }, original: null }, context())).toThrow("INVALID_MATERIAL");
    expect(() => applySpaceAction(space, { action: "add_material", material: { kind: "photo", title: "Фото", text: "", url: "", provenance: "", dateText: "", personIds: ["ghost"] }, original }, context())).toThrow("PERSON_NOT_FOUND");
    expect(() => applySpaceAction(space, { action: "add_material", material: { kind: "note", title: "Заметка", text: "Текст", url: "", provenance: "", dateText: "", personIds: [] }, original }, context())).toThrow("INVALID_MATERIAL");
  });
});

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "familymind-space-synthetic-")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("private space store", () => {
  it("creates with revision 0, enforces CAS, backs up prior revisions and keeps originals immutable", async () => {
    const store = new PrivateSpaceStore(root);
    const first = await store.save(applySpaceAction(emptySpace(), { action: "guide_dismiss", key: "first-person" }, context()).space, 0);
    expect(first.revision).toBe(1);
    expect((await stat(path.join(root, "space", "case_synthetic.json"))).mode & 0o777).toBe(0o600);
    await expect(store.save(first, 0)).rejects.toThrow("STALE_REVISION");
    const second = await store.save(applySpaceAction(first, { action: "add_person", person: { name: "Тест", dateText: "", livingStatus: "unknown", notes: "" }, asOwner: false }, context()).space, 1);
    expect(second.revision).toBe(2);
    expect(JSON.parse(await readFile(path.join(root, "space-backups", "case_synthetic", "1.json"), "utf8"))).toEqual(first);
    expect(await store.loadBackup("case_synthetic", 1)).toEqual(first);
    await expect(store.save({ ...second, people: [] }, 2)).rejects.toThrow("PERSON_HISTORY_IMMUTABLE");
    await expect(store.save({ ...second, journal: second.journal.slice(1) }, 2)).rejects.toThrow("JOURNAL_IMMUTABLE");
    await expect(store.save({ ...second, base: { ...second.base, snapshotDigest: "b".repeat(64) } }, 2)).rejects.toThrow("BASE_IMMUTABLE");
    const written = await store.writeMedia("case_synthetic", "material_1", PNG, "image/png");
    expect(written).toEqual({ size: PNG.length, sha256: sha(PNG), created: true });
    expect((await stat(store.mediaPath("case_synthetic", "material_1"))).mode & 0o777).toBe(0o600);
    expect((await store.writeMedia("case_synthetic", "material_1", PNG, "image/png")).created).toBe(false);
    await expect(store.writeMedia("case_synthetic", "material_1", Buffer.concat([PNG, Buffer.from([1])]), "image/png")).rejects.toThrow("ORIGINAL_IMMUTABLE");
    await expect(store.writeMedia("case_synthetic", "material_2", Buffer.from("<script>"), "image/png")).rejects.toThrow("INVALID_MATERIAL_FILE");
    expect(detectMaterialMime(Buffer.from("plain text"), "text/plain")).toBe("text/plain");
    expect(detectMaterialMime(Buffer.from("a\u0000b"), "text/plain")).toBeNull();
    expect(detectMaterialMime(PNG, "image/jpeg")).toBeNull();
    expect(await store.load("case_synthetic")).toEqual(second);
    await expect(store.load("../escape")).rejects.toThrow("INVALID_ID");
  });
});

const origin = "http://127.0.0.1:3000";
const request = (route: string, init: { method?: string; body?: unknown; token?: string; origin?: string | null; raw?: string } = {}) => {
  const method = init.method ?? (init.body === undefined && init.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { host: "127.0.0.1:3000" };
  if (method !== "GET") headers.origin = init.origin === undefined ? origin : (init.origin ?? "");
  if (init.origin && method === "GET") headers.origin = init.origin;
  if (init.token) headers.cookie = `${SESSION_COOKIE}=${init.token}`;
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  return new Request(`${origin}/api/private/space${route}`, { method, headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
};
async function setup(withResearch = true) {
  vi.stubEnv("FAMILYMIND_PRIVATE_ROOT", root);
  vi.stubEnv("FAMILYMIND_ORIGIN", origin);
  const cases = new PrivateCaseStore(root);
  const seed = (id: string) => cases.save({ schemaVersion: 1, id, title: "SYNTHETIC", revision: 0, updatedAt: now, subject: { personId: "synthetic-a", name: "Анна Учебная", dateText: "около 1900", livingStatus: "deceased" }, sources: [], known: [], question: "Учебный вопрос", notes: "", aiRuns: [], reviews: [] }, null);
  await seed("case_synthetic");
  await seed("case_other");
  if (withResearch) {
    await mkdir(path.join(root, "research"), { mode: 0o700 });
    await writeFile(path.join(root, "research", "case_synthetic.json"), JSON.stringify(syntheticResearch()), { mode: 0o600 });
  }
  const access = new LocalCaseAccess(root, origin);
  const token = async (caseId: string) => (await access.exchange(new Request(`${origin}/api/private/session`, { method: "POST", headers: { host: "127.0.0.1:3000", origin } }), (await access.createBootstrap(caseId)).token)).token;
  return { owner: await token("case_synthetic"), other: await token("case_other") };
}
const stateOf = async (response: Response) => (await response.json()) as SpaceStateResponse;

describe("private space API", () => {
  it("authorizes every request, scopes to the session case and refuses stale or cross-origin writes", async () => {
    const { owner, other } = await setup();
    expect((await getSpace(request(""))).status).toBe(401);
    const initial = await stateOf(await getSpace(request("", { token: owner })));
    expect(initial.space).toMatchObject({ caseId: "case_synthetic", revision: 0, people: [] });
    expect(initial.snapshot?.owner.personId).toBe("synthetic-b");
    expect(initial.space.base.kind).toBe("research-snapshot");
    expect(await stat(path.join(root, "space")).then(() => true, () => false)).toBe(true);
    expect(await stat(path.join(root, "space", "case_synthetic.json")).then(() => true, () => false)).toBe(false);
    const foreign = await stateOf(await getSpace(request("?caseId=case_synthetic", { token: other })));
    expect(foreign.space.caseId).toBe("case_other");
    expect(foreign.snapshot).toBeNull();
    const action = { action: "add_person", person: { name: "Пётр Учебный", dateText: "", livingStatus: "unknown", notes: "" }, asOwner: false, relation: { anchorPersonId: "synthetic-b", newPersonIs: "parent", parentRole: "father" } };
    expect((await mutateSpace(request("/mutate", { body: { expectedRevision: 0, action }, origin: "https://attacker.example", token: owner }))).status).toBe(403);
    expect((await mutateSpace(request("/mutate", { body: { expectedRevision: 3, action }, token: owner }))).status).toBe(409);
    const crossCase = await mutateSpace(request("/mutate", { body: { expectedRevision: 0, action }, token: other }));
    expect(crossCase.status).toBe(404);
    expect((await crossCase.json()).error).toBe("PERSON_NOT_FOUND");
    const created = await mutateSpace(request("/mutate", { body: { expectedRevision: 0, action }, token: owner }));
    expect(created.status).toBe(200);
    const state = await stateOf(created);
    expect(state.space.revision).toBe(1);
    expect(state.created?.personId).toBeDefined();
    expect(state.space.journal[0].action).toBe("migrated");
    expect((await mutateSpace(request("/mutate", { body: { expectedRevision: 0, action }, token: owner }))).status).toBe(409);
    const unknown = await mutateSpace(request("/mutate", { body: { expectedRevision: 1, action: { action: "update_material", id: "material_missing", material: { title: "x" } } }, token: owner }));
    expect(unknown.status).toBe(404);
    const malformed = await mutateSpace(request("/mutate", { body: { expectedRevision: 1, action: { action: "layout", positions: { "person:synthetic-b": { x: Number.NaN, y: 0 } } } }, raw: '{"expectedRevision":1,"action":{"action":"layout","positions":{"person:synthetic-b":{"x":"1e400","y":0}}}}', token: owner }));
    expect(malformed.status).toBe(400);
    expect(await new PrivateSpaceStore(root).load("case_synthetic")).toEqual(state.space);
    const people = await peopleForMember(root, { caseId: "case_synthetic", memberId: "owner", role: "owner", sessionId: "s" });
    expect(people.map((person) => person.name)).toEqual(["Иван Учебный", "Анна Учебная", "Пётр Учебный"]);
  });

  it("stores originals once, serves them only to the owner and round-trips through export/import byte for byte", async () => {
    const { owner, other } = await setup();
    const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
    const material = { kind: "photo", title: "Синтетическое фото", text: "Подпись", url: "", provenance: "Тестовый альбом", dateText: "около 1950", personIds: ["synthetic-b"] };
    expect((await addMaterial(request("/material", { body: { expectedRevision: 0, material, file: { name: "demo.png", mime: "image/jpeg", dataUrl } }, token: owner }))).status).toBe(400);
    const added = await addMaterial(request("/material", { body: { expectedRevision: 0, material, file: { name: "demo.png", mime: "image/png", dataUrl } }, token: owner }));
    expect(added.status).toBe(201);
    const state = await stateOf(added);
    const id = state.created!.materialId!;
    expect(state.space.materials[0].original).toEqual({ name: "demo.png", mime: "image/png", size: PNG.length, sha256: sha(PNG) });
    const media = await serveMedia(request(`/media?id=${id}`, { token: owner }));
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer()).equals(PNG)).toBe(true);
    expect(media.headers.get("Content-Type")).toBe("image/png");
    expect(media.headers.get("Cache-Control")).toContain("no-store");
    expect(media.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect((await serveMedia(request(`/media?id=${id}`))).status).toBe(401);
    expect((await serveMedia(request(`/media?id=${id}`, { token: other }))).status).toBe(404);
    expect((await serveMedia(request("/media?id=../../etc/passwd", { token: owner }))).status).toBe(404);
    const moved = await stateOf(await mutateSpace(request("/mutate", { body: { expectedRevision: 1, action: { action: "layout", positions: { [`material:${id}`]: { x: 400, y: 120 }, "root:synthetic-b": { x: -10, y: 5 } } } }, token: owner })));
    expect(moved.space.layout.positions[`material:${id}`]).toEqual({ x: 400, y: 120 });
    const exported = await exportSpace(request("/export", { body: {}, token: owner }));
    expect(exported.status).toBe(200);
    const bundle = (await exported.json()) as SpaceBundle;
    expect(bundle.format).toBe("family-mind-space");
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0]).toMatchObject({ materialId: id, sha256: sha(PNG), dataUrl });
    expect(JSON.stringify(bundle)).not.toContain("fm_private_session");

    const removed = await stateOf(await mutateSpace(request("/mutate", { body: { expectedRevision: 2, action: { action: "remove_material", id } }, token: owner })));
    expect(removed.space.materials[0].removedAt).not.toBeNull();
    const corrupt = structuredClone(bundle);
    corrupt.files[0].dataUrl = `data:image/png;base64,${Buffer.concat([PNG.subarray(0, 8), Buffer.from([0, 0, 0, 1])]).toString("base64")}`;
    const rejected = await importSpace(request("/import", { body: { expectedRevision: 3, bundle: corrupt }, token: owner }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe("IMPORT_FILE_CORRUPT");
    expect(await new PrivateSpaceStore(root).load("case_synthetic")).toEqual(removed.space);
    const foreignBundle = structuredClone(bundle);
    foreignBundle.caseId = "case_other";
    foreignBundle.space.caseId = "case_other";
    expect((await importSpace(request("/import", { body: { expectedRevision: 0, bundle: foreignBundle }, token: other }))).status).toBe(404);
    expect((await importSpace(request("/import", { body: { expectedRevision: 3, bundle: foreignBundle }, token: owner }))).status).toBe(403);
    const restored = await stateOf(await importSpace(request("/import", { body: { expectedRevision: 3, bundle }, token: owner })));
    expect(restored.space.revision).toBe(4);
    expect(restored.space.materials[0].removedAt).toBeNull();
    expect(restored.space.layout.positions[`material:${id}`]).toEqual({ x: 400, y: 120 });
    expect(restored.space.journal.slice(0, removed.space.journal.length)).toEqual(removed.space.journal);
    expect(restored.space.journal.at(-1)?.action).toBe("import");
    const afterImport = await serveMedia(request(`/media?id=${id}`, { token: owner }));
    expect(Buffer.from(await afterImport.arrayBuffer()).equals(PNG)).toBe(true);
    const erased = structuredClone(bundle);
    erased.space.materials = [];
    erased.files = [];
    const noErase = await stateOf(await importSpace(request("/import", { body: { expectedRevision: 4, bundle: erased }, token: owner })));
    expect(noErase.space.materials).toHaveLength(1);
    expect(noErase.space.materials[0].removedAt).not.toBeNull();
    expect(await new PrivateSpaceStore(root).hasMedia("case_synthetic", id)).toBe(true);
  });

  it("works without a snapshot: the owner card becomes the centre and references stay scoped", async () => {
    const { owner } = await setup(false);
    const initial = await stateOf(await getSpace(request("", { token: owner })));
    expect(initial.snapshot).toBeNull();
    expect(initial.space.base.kind).toBe("none");
    const me = await stateOf(await mutateSpace(request("/mutate", { body: { expectedRevision: 0, action: { action: "add_person", person: { name: "Я", dateText: "", livingStatus: "living", notes: "" }, asOwner: true } }, token: owner })));
    expect(me.space.ownerPersonId).toBe(me.created?.personId);
    const mother = await stateOf(await mutateSpace(request("/mutate", { body: { expectedRevision: 1, action: { action: "add_person", person: { name: "Мама", dateText: "", livingStatus: "living", notes: "" }, asOwner: false, relation: { anchorPersonId: me.created!.personId!, newPersonIs: "parent", parentRole: "mother" } } }, token: owner })));
    expect(mother.space.relationships[0]).toMatchObject({ from: mother.created?.personId, to: me.created?.personId, parentRole: "mother" });
    const merged = mergeImportedSpace(mother.space, { ...mother.space, people: [mother.space.people[0]], relationships: [] }, now, context({ snapshotPeopleIds: new Set(), snapshotOwnerId: null, snapshotRelationships: [] }));
    expect(merged.people.find((person) => person.id === mother.created?.personId)?.removedAt).toBe(now);
    expect(merged.relationships[0].removedAt).toBe(now);
    expect(() => parsePrivateSpace({ ...mother.space, ownerPersonId: "ghost" })).toThrow("INVALID_SPACE");
    const tampered: PrivateSpace = { ...mother.space, relationships: [{ ...mother.space.relationships[0], from: mother.space.relationships[0].to, to: mother.space.relationships[0].from }] };
    await expect(new PrivateSpaceStore(root).save(tampered, mother.space.revision)).rejects.toThrow("RELATIONSHIP_HISTORY_IMMUTABLE");
  });
});
