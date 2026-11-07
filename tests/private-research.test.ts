import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import { PrivateCaseStore } from "../src/private-case/server-store";
import { parseResearch } from "../src/private-case/research-model";
import { MAX_RESEARCH_BYTES, readResearch, serveResearch } from "../src/private-case/research-server";
import { syntheticResearch } from "../e2e/fixtures/private-research";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "familymind-research-synthetic-")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const request = (token?: string, query = "") => new Request(`http://127.0.0.1:3000/api/private/research${query}`, { headers: { host: "127.0.0.1:3000", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) } });
async function setup() {
  vi.stubEnv("FAMILYMIND_PRIVATE_ROOT", root); vi.stubEnv("FAMILYMIND_ORIGIN", "http://127.0.0.1:3000");
  const store = new PrivateCaseStore(root);
  await store.save({ schemaVersion: 1, id: "case_synthetic", title: "SYNTHETIC", revision: 0, updatedAt: new Date().toISOString(), subject: { personId: "synthetic-a", name: "Анна Учебная", dateText: "около1900", livingStatus: "deceased" }, sources: [], known: [], question: "Учебный вопрос", notes: "", aiRuns: [], reviews: [] }, null);
  const access = new LocalCaseAccess(root), bootstrap = await access.createBootstrap("case_synthetic");
  const session = await access.exchange(new Request("http://127.0.0.1:3000/api/private/session", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }), bootstrap.token);
  await mkdir(path.join(root, "research"), { mode: 0o700 });
  return session.token;
}
const write = async (data: unknown) => writeFile(path.join(root, "research", "case_synthetic.json"), JSON.stringify(data), { mode: 0o600 });
describe("private research workspace", () => {
  it("preserves explicit living status without inferring it from dates", () => {
    const original = syntheticResearch();
    original.people[0].deathDate = "1930 (synthetic date)";
    expect(parseResearch(original).people[0].livingStatus).toBeUndefined();
    for (const livingStatus of ["living", "deceased", "unknown"] as const) {
      const value = syntheticResearch();
      value.people[0].livingStatus = livingStatus;
      expect(parseResearch(value).people[0].livingStatus).toBe(livingStatus);
    }
    expect(() => parseResearch({ ...original, people: original.people.map((person, index) => index === 0 ? { ...person, livingStatus: "probably-deceased" } : person) })).toThrow("INVALID_RESEARCH");
    expect(() => parseResearch({ ...original, people: original.people.map((person, index) => index === 0 ? { ...person, livingStatus: null } : person) })).toThrow("INVALID_RESEARCH");
  });

  it("checks all references and refuses filesystem fields, external images and unsafe links", () => {
    expect(parseResearch(syntheticResearch()).people).toHaveLength(2);
    const bad = syntheticResearch(); bad.people[0].photoIds = ["not-there"]; expect(() => parseResearch(bad)).toThrow("INVALID_RESEARCH");
    expect(() => parseResearch({ ...syntheticResearch(), localImage: "/private/path" })).toThrow("INVALID_RESEARCH");
    const image = syntheticResearch(); image.photos[0].dataUrl = "https://example.invalid/picture.jpg"; expect(() => parseResearch(image)).toThrow("INVALID_RESEARCH");
    const link = syntheticResearch(); link.sources[0].url = "javascript:alert(1)"; expect(() => parseResearch(link)).toThrow("INVALID_RESEARCH");
    const duplicate = syntheticResearch(); duplicate.people.push(duplicate.people[0]); expect(() => parseResearch(duplicate)).toThrow("INVALID_RESEARCH");
  });
  it("authorizes before reading and ignores request paths and foreign case IDs", async () => {
    const token = await setup(); await write(syntheticResearch());
    expect((await serveResearch(request())).status).toBe(401);
    const response = await serveResearch(request(token, "?caseId=foreign&path=/etc/passwd"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(syntheticResearch()); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    await expect(readResearch(root, "../secret")).rejects.toThrow();
  });
  it("refuses symlink files and oversized data without leaking file content", async () => {
    const token = await setup(); const file = path.join(root, "research", "case_synthetic.json"), target = path.join(root, "secret.json");
    await writeFile(target, JSON.stringify(syntheticResearch())); await symlink(target, file);
    expect((await serveResearch(request(token))).status).toBe(404); await rm(file);
    await writeFile(file, "{}"); await truncate(file, MAX_RESEARCH_BYTES + 1);
    const response = await serveResearch(request(token)); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "RESEARCH_UNAVAILABLE" });
  });
  it("rejects incorrect image signatures and a symlinked research directory", async () => {
    const token = await setup(); const value = syntheticResearch(); value.photos[0].dataUrl = "data:image/png;base64,PHNjcmlwdD5iYWQ8L3NjcmlwdD4="; await write(value);
    expect((await serveResearch(request(token))).status).toBe(404);
    await rm(path.join(root,"research"), { recursive: true }); await mkdir(path.join(root,"elsewhere")); await symlink(path.join(root,"elsewhere"),path.join(root,"research"));
    await write(syntheticResearch()); expect((await serveResearch(request(token))).status).toBe(404);
  });
});
