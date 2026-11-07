import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import { PrivateCaseStore } from "../src/private-case/server-store";
import { readCaseReport, serveCaseReport, REPORT_CSP } from "../src/private-case/report";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "familymind-report-synthetic-")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const input = () => ({ title: "Синтетический отчёт <script>alert(1)</script>", generatedAt: "2026-11-06", summary: ["Только вымышленные данные."], findings: [{ title: "Дата спорна", text: '<img src=x onerror="alert(2)">', status: "unresolved", sourceIds: ["s1"] }], people: [{ id: "p1", name: "Тестовый Персонаж", dates: "около1900", relation: "Учебный пример", note: "Реального человека нет" }], sources: [{ id: "s1", title: "Условная запись", url: "javascript:alert(1)", locator: "Тестовый лист", kind: "synthetic" }], timeline: [], questions: [], branches: [], coverage: { searched: ["Синтетический набор"], notSearched: ["Реальные архивы"], limitations: ["Это тест"] } });
async function render(data: unknown, imageRoot?: string, output = path.join(root, "reports", "case_synthetic.html")) {
  const filename = path.join(root, "input.json"); await writeFile(filename, JSON.stringify(data));
  const run = spawnSync(process.execPath, ["scripts/render-research-report.mjs", "--input", filename, "--output", output, ...(imageRoot ? ["--image-root", imageRoot] : [])], { encoding: "utf8", timeout: 10000 });
  return { ...run, output, html: run.status === 0 ? await readFile(output, "utf8") : "" };
}
describe("standalone report renderer", () => {
  it("escapes all untrusted markup and suppresses non-http and malformed URLs", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>x</script>", "https://user:secret@example.test", "https://example.test/\nattack", "not a url"]) {
      const data = input(); data.sources[0].url = url;
      const result = await render(data);
      expect(result.status).toBe(0); expect(result.html).not.toContain("<script>"); expect(result.html).not.toContain("<img src=x");
      expect(result.html).toContain("&lt;script&gt;"); expect(result.html).not.toContain('href="javascript:'); expect(result.html).not.toContain('target="_blank"');
      expect(result.html).toContain('href="#source-1"');
    }
    expect((await stat(path.join(root, "reports", "case_synthetic.html"))).mode & 0o777).toBe(0o600);
  });
  it("preserves source anchors and safely escapes permitted source URLs", async () => {
    const data = input(); data.sources[0].url = "https://example.test/?a=1&b=%22hello%22";
    const result = await render(data); expect(result.status).toBe(0);
    expect(result.html).toContain('href="https://example.test/?a=1&amp;b=%22hello%22"');
    expect(result.html).toContain('rel="noopener noreferrer"');
    data.findings[0].sourceIds = ["missing"];
    expect((await render(data)).status).toBe(1);
  });
  it("inlines original image bytes only inside the explicit image root", async () => {
    const images = path.join(root, "images"); await mkdir(images);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==", "base64");
    await writeFile(path.join(images, "synthetic.png"), bytes);
    const data = input(); const imageData = { ...data, sources: [{ ...data.sources[0], localImage: "synthetic.png" }] };
    expect((await render(imageData, images)).html).toContain(`data:image/png;base64,${bytes.toString("base64")}`);
    expect((await render(imageData)).status).toBe(1);
    await symlink(path.join(images, "synthetic.png"), path.join(images, "link.png")); imageData.sources[0].localImage = "link.png";
    expect((await render(imageData, images)).status).toBe(1);
    imageData.sources[0].localImage = "../input.json";
    expect((await render(imageData, images)).status).toBe(1);
  });
  it("refuses output inside checkout even through an outside symlink", async () => {
    const link = path.join(root, "checkout-link"); await symlink(process.cwd(), link);
    expect((await render(input(), undefined, path.join(link, "never-created.html"))).status).toBe(1);
  });
  it("rejects a gallery with an unknown source without replacing the existing report", async () => {
    const images = path.join(root, "gallery-images"); await mkdir(images);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==", "base64");
    await writeFile(path.join(images, "synthetic.png"), bytes);
    const data = { ...input(), gallery: [{ title: "Вымышленный снимок", caption: "Синтетический пиксель", dateText: "Дата неизвестна", attribution: "Учебный источник", localImage: "synthetic.png", sourceIds: ["s1"] }] };
    const valid = await render(data, images);
    expect(valid.status).toBe(0); expect(valid.html).toContain('<section id="gallery">');
    expect(valid.html).toContain(`data:image/png;base64,${bytes.toString("base64")}`);
    data.gallery[0].sourceIds = ["missing-source"];
    const invalid = await render(data, images);
    expect(invalid.status).toBe(1); expect(invalid.stderr).toContain("MISSING_SOURCE");
    expect(await readFile(valid.output, "utf8")).toBe(valid.html);
  });
  it("escapes family story markup and keeps secondary candidates collapsed behind primary people", async () => {
    const data = { ...input(), familyStory: [{ title: '<svg onload="alert(3)">', paragraphs: ['<a href="javascript:alert(4)">Вымышленная история</a>'], sourceIds: ["s1"] }], primaryPersonIds: ["p1"] };
    data.people.push({ id: "candidate2", name: "Отдельный синтетический кандидат", dates: "Неизвестно", relation: "Кандидат, не объединён", note: "Связь не установлена" });
    const result = await render(data);
    expect(result.status).toBe(0);
    const story = result.html.match(/<section id="family-story">([\s\S]*?)<\/section>/)?.[1] ?? "";
    expect(story).toContain("&lt;svg onload=&quot;alert(3)&quot;&gt;");
    expect(story).toContain("&lt;a href=&quot;javascript:alert(4)&quot;&gt;");
    expect(story).not.toContain("<svg"); expect(story).not.toContain('href="javascript:');
    expect(story).toContain('href="#source-1"');
    const people = result.html.match(/<section id="people">([\s\S]*?)<\/section>/)?.[1] ?? "";
    const collapsed = people.match(/<details\b[^>]*>([\s\S]*?)<\/details>/)?.[1] ?? "";
    expect(people.split("<details")[0]).toContain("Тестовый Персонаж");
    expect(people.split("<details")[0]).not.toContain("Отдельный синтетический кандидат");
    expect(collapsed).toContain("Отдельный синтетический кандидат");
    expect(collapsed).not.toContain("Тестовый Персонаж");
    expect(people).not.toMatch(/<details\b[^>]*\bopen(?:\s|=|>)/);
    data.primaryPersonIds = ["missing-person"];
    const invalid = await render(data);
    expect(invalid.status).toBe(1); expect(invalid.stderr).toContain("MISSING_PERSON");
  });
});

describe("private report access", () => {
  const request = (token?: string, query = "") => new Request(`http://127.0.0.1:3000/api/private/report${query}`, { headers: { host: "127.0.0.1:3000", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) } });
  async function setup() {
    vi.stubEnv("FAMILYMIND_PRIVATE_ROOT", root); vi.stubEnv("FAMILYMIND_ORIGIN", "http://127.0.0.1:3000");
    const store = new PrivateCaseStore(root);
    await store.save({ schemaVersion: 1, id: "case_synthetic", title: "SYNTHETIC", revision: 0, updatedAt: new Date().toISOString(), subject: { personId: "p1", name: "Вымышленный Персонаж", dateText: "1900–1980", livingStatus: "deceased" }, sources: [], known: [], question: "Учебная проверка", notes: "", aiRuns: [], reviews: [] }, null);
    const access = new LocalCaseAccess(root); const bootstrap = await access.createBootstrap("case_synthetic");
    const session = await access.exchange(new Request("http://127.0.0.1:3000/api/private/session", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }), bootstrap.token);
    await mkdir(path.join(root, "reports"), { mode: 0o700 });
    return session.token;
  }
  it("requires a session, reads only its case, and supplies restrictive no-store headers", async () => {
    const token = await setup();
    await writeFile(path.join(root, "reports", "case_synthetic.html"), "<!doctype html><p>synthetic-owned</p>");
    await writeFile(path.join(root, "reports", "other.html"), "never-visible");
    const denied = await serveCaseReport(request()); expect(denied.status).toBe(401); expect(await denied.text()).not.toContain("synthetic-owned");
    const response = await serveCaseReport(request(token, "?caseId=other&path=/etc/passwd"));
    expect(response.status).toBe(200); expect(await response.text()).toContain("synthetic-owned");
    expect(response.headers.get("Content-Security-Policy")).toBe(REPORT_CSP); expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("returns a readable safe404 for missing or symlink reports", async () => {
    const token = await setup();
    const missing = await serveCaseReport(request(token)); expect(missing.status).toBe(404); expect(await missing.text()).toContain("Отчёт ещё не подготовлен");
    const target = path.join(root, "secret.html"); await writeFile(target, "must-not-leak"); await symlink(target, path.join(root, "reports", "case_synthetic.html"));
    const unsafe = await serveCaseReport(request(token)); expect(unsafe.status).toBe(404); expect(await unsafe.text()).not.toContain("must-not-leak");
    await expect(readCaseReport(root, "../secret")).rejects.toThrow();
  });
  it("refuses oversized files and a symlinked reports directory", async () => {
    const token = await setup();
    const report = path.join(root, "reports", "case_synthetic.html");
    await writeFile(report, "synthetic"); await truncate(report, 20 * 1024 * 1024 + 1);
    expect((await serveCaseReport(request(token))).status).toBe(404);
    await rm(path.join(root, "reports"), { recursive: true });
    const outside = path.join(root, "other-reports"); await mkdir(outside); await writeFile(path.join(outside, "case_synthetic.html"), "must-not-leak");
    await symlink(outside, path.join(root, "reports"));
    const response = await serveCaseReport(request(token)); expect(response.status).toBe(404); expect(await response.text()).not.toContain("must-not-leak");
  });
});
