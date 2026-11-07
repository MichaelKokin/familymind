import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalCaseAccess, SESSION_COOKIE } from "../src/private-case/access";
import { PrivateCaseStore } from "../src/private-case/server-store";
import type { PrivateCase } from "../src/private-case/model";
import { privateCaseText as t } from "../src/i18n/private-case";
import { REPORT_CSP } from "../src/private-case/report";
import { syntheticResearch } from "./fixtures/private-research";
import { exploreText as explore } from "../src/i18n/explore";

const origin = "http://127.0.0.1:3001";
const root = process.env.FAMILYMIND_PRIVATE_E2E_ROOT;
const sourceTitle = "СИНТЕТИЧЕСКОЕ дерево для теста";
let value: PrivateCase;
let token: string;
let store: PrivateCaseStore;

function syntheticCase(id: string): PrivateCase {
  return {
    schemaVersion: 1,
    id,
    title: "СИНТЕТИЧЕСКОЕ исследовательское дело",
    revision: 0,
    updatedAt: new Date().toISOString(),
    subject: { personId: "synthetic-person", name: "Вымышленная Елена Тестова", dateText: "около 1900 — синтетический пример", livingStatus: "unknown" },
    sources: [{ id: "synthetic-source", title: sourceTitle, url: "https://example.invalid/synthetic-tree", locator: "Тестовая карточка 1", excerpt: "СИНТЕТИЧЕСКИЙ ПРИМЕР. Приблизительная дата записана в учебном дереве; оригинал документа отсутствует.", kind: "user_tree", observedAt: new Date().toISOString() }],
    known: [{ id: "synthetic-known", text: "В учебном дереве указан приблизительный год.", sourceIds: ["synthetic-source"], status: "tree_assertion" }],
    question: "Какой следующий документ нужен для проверки синтетической даты?",
    notes: "Только искусственные данные. Не настоящий семейный кейс.",
    aiRuns: [],
    reviews: [],
  };
}

test.beforeEach(async () => {
  if (!root) throw new Error("Private tests require node e2e/run-private.mjs and an isolated synthetic root.");
  expect(await readFile(path.join(root, ".synthetic-e2e-owned"), "utf8")).toBe("family-mind-synthetic-e2e\n");
  store = new PrivateCaseStore(root);
  value = await store.save(syntheticCase(`synthetic-${randomUUID()}`), null);
  ({ token } = await new LocalCaseAccess(root, origin).createBootstrap(value.id));
});

test("private access requires a one-use capability, exact origin and a case-bound revocable session", async ({ request, playwright }) => {
  const unauthenticated = await request.get("/api/private/case");
  const unauthenticatedCode = (await unauthenticated.json()).error;
  expect(unauthenticated.status(), `Access response code: ${String(unauthenticatedCode)}`).toBe(401);
  expect((await request.post("/api/private/export", { headers: { Origin: origin }, data: {} })).status()).toBe(401);
  expect((await request.post("/api/private/session", { headers: { Origin: "https://example.invalid" }, data: { token } })).status()).toBe(403);

  const unlock = await request.post("/api/private/session", { headers: { Origin: origin }, data: { token } });
  expect(unlock.status()).toBe(200);
  const cookies = (await request.storageState()).cookies;
  const cookie = cookies.find((item) => item.name === SESSION_COOKIE);
  expect(Boolean(cookie)).toBe(true);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  expect(cookie?.path).toBe("/api/private");
  // Assertions deliberately avoid printing token or cookie values.
  const loaded = await request.get("/api/private/case");
  expect(loaded.status()).toBe(200);
  expect(loaded.headers()["cache-control"]).toContain("no-store");
  expect((await loaded.json()).id).toBe(value.id);
  expect((await request.post("/api/private/session", { headers: { Origin: origin }, data: { token } })).status()).toBe(401);

  const another = await store.save(syntheticCase(`synthetic-other-${randomUUID()}`), null);
  const attemptedSelection = await request.get(`/api/private/case?caseId=${another.id}`);
  expect(attemptedSelection.status()).toBe(200);
  expect((await attemptedSelection.json()).id).toBe(value.id);
  expect((await request.get("/api/private/case", { headers: { Origin: "https://example.invalid" } })).status()).toBe(403);
  expect((await request.post("/api/private/analyze", { headers: { Origin: "https://example.invalid" }, data: { expectedRevision: value.revision, question: value.question, sourceIds: ["synthetic-source"] } })).status()).toBe(403);
  expect((await store.load(value.id))?.aiRuns).toHaveLength(0);

  const replay = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Cookie: `${SESSION_COOKIE}=${cookie!.value}` } });
  expect((await request.post("/api/private/logout", { headers: { Origin: origin }, data: {} })).status()).toBe(200);
  expect((await request.get("/api/private/case")).status()).toBe(401);
  expect((await replay.get("/api/private/case")).status()).toBe(401);
  await replay.dispose();
});

test("the isolated synthetic CLI process yields a reviewable result that persists and exports", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await page.goto(`/case#token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId("private-case")).toBeVisible();
  await expect(page).toHaveURL(`${origin}/case`);
  await expect(page.getByRole("heading", { name: value.subject.name, exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: sourceTitle, exact: true })).toBeChecked();
  await page.getByRole("button", { name: t.addSource }).click();
  const sourceDialog = page.getByRole("dialog");
  const extraTitle = "СИНТЕТИЧЕСКИЙ фрагмент 2";
  await sourceDialog.getByRole("textbox", { name: t.sourceTitle, exact: true }).fill(extraTitle);
  await sourceDialog.getByRole("textbox", { name: t.sourceLocator, exact: true }).fill("Учебный лист 2");
  await sourceDialog.getByRole("textbox", { name: t.sourceExcerpt, exact: true }).fill("Искусственный фрагмент вне объёма следующего запуска.");
  await sourceDialog.getByRole("button", { name: t.sourceSave, exact: true }).click();
  await expect(sourceDialog).toHaveCount(0);
  await page.getByRole("checkbox", { name: extraTitle, exact: true }).uncheck();
  await page.getByRole("textbox", { name: t.questionLabel, exact: true }).fill("Разбери только синтетический источник и укажи следующий шаг.");
  await page.getByRole("button", { name: t.analyze }).click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/private/case");
    return ((await response.json()) as PrivateCase).aiRuns.at(-1)?.status;
  }, { timeout: 30_000 }).toBe("completed");
  await expect(page.getByText("СИНТЕТИЧЕСКИЙ ТЕСТ: материалы разобраны тестовым процессом, модель и архивный поиск не запускались.", { exact: true })).toBeVisible();
  const proposal = page.getByTestId("private-proposal-synthetic-proposal");
  await expect(proposal.getByText(t.evidenceStatuses.hypothesis, { exact: true })).toBeVisible();
  await proposal.getByRole("textbox", { name: t.reason, exact: true }).fill("Сохраняем направление проверки; дата и родство остаются недоказанными.");
  await proposal.getByRole("button", { name: t.accept, exact: true }).click();
  await expect(proposal.getByText(t.workflowStatuses.accepted, { exact: true })).toBeVisible();
  await expect(proposal.getByText(t.evidenceStatuses.hypothesis, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("private-case")).toBeVisible();
  await expect(page.getByTestId("private-proposal-synthetic-proposal").getByText(t.workflowStatuses.accepted, { exact: true })).toBeVisible();
  const stored = (await (await page.request.get("/api/private/case")).json()) as PrivateCase;
  expect(stored.aiRuns).toHaveLength(1);
  expect(stored.sources).toHaveLength(2);
  expect(stored.aiRuns[0].sourceIds).toEqual(["synthetic-source"]);
  expect(stored.aiRuns[0].mode).toBe("codex-cli");
  expect(stored.aiRuns[0].result?.proposals[0].evidenceStatus).toBe("hypothesis");
  expect(stored.aiRuns[0].result?.proposals[0].workflowStatus).toBe("accepted");
  expect(stored.reviews).toHaveLength(1);
  expect(stored.known[0].status).toBe("tree_assertion");
  expect(JSON.parse(await readFile(path.join(root!, "fixture-invoked.json"), "utf8"))).toEqual({ synthetic: true, invoked: true });

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: t.export, exact: true }).click();
  const download = await downloadEvent;
  const filename = await download.path();
  expect(filename !== null).toBe(true);
  expect(JSON.parse(await readFile(filename!, "utf8"))).toEqual(stored);
  const registersResponse = await page.request.post("/api/private/export?format=registers", { headers: { Origin: origin }, data: {} });
  expect(registersResponse.status()).toBe(200);
  const registers = await registersResponse.json();
  expect(registers.methodology.commit).toBe("84b0eda770b002464e84658a8f63046a4bb94e95");
  expect(registers.counts).toEqual({ persons: 1, artifacts: 2, claims: 1, relationships: 0 });
  expect(Object.keys(registers.files).sort()).toEqual(["artifact-register.csv", "claims-register.csv", "person-register.csv", "relationship-register.csv"]);
  expect(registers.files["claims-register.csv"]).toContain('"hypothesis"');
  const erasedReview = structuredClone(stored);
  erasedReview.reviews = [];
  erasedReview.aiRuns[0].result!.proposals[0].workflowStatus = "proposed";
  const historyRewrite = await page.request.post("/api/private/import", { headers: { Origin: origin }, data: { expectedRevision: stored.revision, case: erasedReview } });
  expect(historyRewrite.status()).toBe(400);
  expect(await store.load(stored.id)).toEqual(stored);
  await page.getByRole("button", { name: t.import, exact: true }).click();
  const importDialog = page.getByRole("dialog");
  await importDialog.getByLabel(t.importFile, { exact: true }).setInputFiles(filename!);
  await importDialog.getByRole("button", { name: t.checkImport, exact: true }).click();
  await expect(importDialog.getByText(t.importReady, { exact: true })).toBeVisible();
  await importDialog.getByRole("button", { name: t.importConfirm, exact: true }).click();
  await expect(importDialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("private-case")).toBeVisible();
  const restored = (await (await page.request.get("/api/private/case")).json()) as PrivateCase;
  expect(restored.sources).toEqual(stored.sources);
  expect(restored.aiRuns).toEqual(stored.aiRuns);
  expect(restored.reviews).toEqual(stored.reviews);
  expect(restored.revision).toBeGreaterThan(stored.revision);
  await page.getByRole("button", { name: t.logout, exact: true }).click();
  await expect(page.getByTestId("private-case-locked")).toBeVisible();
  expect((await page.request.get("/api/private/case")).status()).toBe(401);
});

test("stale and out-of-scope run requests are refused before any persisted research change", async ({ request }) => {
  expect((await request.post("/api/private/session", { headers: { Origin: origin }, data: { token } })).status()).toBe(200);
  const stale = await request.post("/api/private/analyze", { headers: { Origin: origin }, data: { expectedRevision: value.revision - 1, question: value.question, sourceIds: ["synthetic-source"] } });
  expect(stale.status()).toBe(409);
  const foreignSource = await request.post("/api/private/analyze", { headers: { Origin: origin }, data: { expectedRevision: value.revision, question: value.question, sourceIds: ["not-in-this-case"] } });
  expect(foreignSource.status()).toBe(400);
  expect((await foreignSource.json()).error).toBe("SOURCE_SCOPE_VIOLATION");
  expect(await store.load(value.id)).toEqual(value);
});

test("production report responses retain strict CSP and require the case-bound session", async ({ request }) => {
  const directory = path.join(root!, "reports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const html = "<!doctype html><html lang=ru><meta charset=utf-8><title>Синтетический отчёт</title><p>СИНТЕТИЧЕСКИЙ ОТЧЁТ: только тестовые данные.</p></html>";
  await writeFile(path.join(directory, `${value.id}.html`), html, { mode: 0o600 });

  const denied = await request.get("/api/private/report");
  expect(denied.status()).toBe(401);
  expect(await denied.text()).not.toContain("СИНТЕТИЧЕСКИЙ ОТЧЁТ:");
  expect(denied.headers()["content-security-policy"]).toBe(REPORT_CSP);
  expect(denied.headers()["cache-control"]).toContain("no-store");

  expect((await request.post("/api/private/session", { headers: { Origin: origin }, data: { token } })).status()).toBe(200);
  const response = await request.get("/api/private/report?caseId=other&path=/etc/passwd");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe(html);
  const csp = response.headers()["content-security-policy"];
  expect(csp).toBe(REPORT_CSP);
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain("script-src");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("owner can recover from the locked screen and open the family space directly", async ({ page }) => {
  let exchanges = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/private/session") exchanges += 1;
  });
  await mkdir(path.join(root!, "research"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root!, "research", `${value.id}.json`), JSON.stringify(syntheticResearch()), { mode: 0o600 });
  await page.goto("/case/explore");
  await expect(page.getByText(explore.lockedHint, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: explore.back, exact: true }).click();
  await expect(page.getByText("npm run case:launch", { exact: true })).toBeVisible();
  await page.goto(`/case#token=${encodeURIComponent(token)}&view=explore`);
  await expect(page.getByTestId("private-explore")).toBeVisible();
  await expect(page).toHaveURL(`${origin}/case/explore`);
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByTestId("private-explore")).toBeVisible();
  expect(exchanges).toBe(1);
});

test("private family space connects people, gallery and source details on desktop and mobile", async ({ page, request }) => {
  const data = syntheticResearch();
  await mkdir(path.join(root!, "research"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root!, "research", `${value.id}.json`), JSON.stringify(data), { mode: 0o600 });
  expect((await request.get("/api/private/research")).status()).toBe(401);
  await page.goto(`/case#token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId("private-case")).toBeVisible();
  await page.getByRole("button", { name: t.explore, exact: true }).click();
  await expect(page.getByTestId("private-explore")).toBeVisible();
  await expect(page.getByRole("heading", { name: data.title, exact: true })).toBeVisible();
  await expect(page.getByTestId("research-inspector").getByRole("heading", { name: "Иван Учебный", exact: true })).toBeVisible();
  await expect(page.getByTestId("research-inspector").getByText(explore.placeUnknown, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: explore.list, exact: true }).click();
  await page.getByRole("button", { name: /Анна Учебная.*около 1900/ }).click();
  await expect(page.getByTestId("research-inspector").getByText("Полностью вымышленная биография Анны для проверки интерфейса.", { exact: true })).toBeVisible();
  await page.getByTestId("research-inspector").getByRole("button", { name: /Синтетическая карточка источника/ }).click();
  await expect(page.getByRole("dialog").getByText("Не настоящий архивный документ.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: explore.close, exact: true }).click();
  await page.getByRole("button", { name: "Синтетическое изображение", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Учебный пиксель, не фотография человека.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: explore.close, exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.getByTestId("private-explore")).toBeVisible();
  expect((await page.request.get("/api/private/research")).headers()["cache-control"]).toContain("no-store");
});

test("ancestry starts with the owner and never draws a maternal grandmother as the father's parent", async ({ page }) => {
  const data = syntheticResearch();
  const template = data.people[1];
  data.people.push(
    { ...template, id: "synthetic-father", name: "Пётр Примерный", sourceIds: [], photoIds: [] },
    { ...template, id: "synthetic-maternal-grandmother", name: "Вера Учебная", sourceIds: [], photoIds: [], birthPlace: "Учебная губерния" },
    { ...template, id: "synthetic-paternal-grandmother", name: "Ольга Примерная", sourceIds: [], photoIds: [] },
  );
  const relation = data.relationships[0];
  data.relationships.push(
    { ...relation, id: "synthetic-father-owner", from: "synthetic-father", to: "synthetic-b", parentRole: "father" },
    { ...relation, id: "synthetic-grandmother-mother", from: "synthetic-maternal-grandmother", to: "synthetic-a", parentRole: "mother" },
    { ...relation, id: "synthetic-grandmother-father", from: "synthetic-paternal-grandmother", to: "synthetic-father", parentRole: "mother" },
  );
  await mkdir(path.join(root!, "research"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root!, "research", `${value.id}.json`), JSON.stringify(data), { mode: 0o600 });
  await page.goto(`/case#token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId("private-case")).toBeVisible();
  await page.getByRole("button", { name: t.explore, exact: true }).click();
  const inspector = page.getByTestId("research-inspector");
  await expect(inspector.getByRole("heading", { name: "Иван Учебный", exact: true })).toBeVisible();
  await expect(page.getByTestId("research-map").getByRole("button", { name: /^Иван Учебный, Вы,/ })).toBeVisible();
  await expect(page.getByTestId("research-map").getByRole("button", { name: /^Пётр Примерный, Отец,/ })).toBeVisible();
  await page.getByRole("button", { name: explore.allGenerations, exact: true }).click();
  await page.getByTestId("research-map").getByRole("button", { name: /^Вера Учебная, Мать → Мать,/ }).click();
  await expect(inspector.getByRole("heading", { name: "Вера Учебная", exact: true })).toBeVisible();
  await expect(inspector.getByText("Вы → Мать → Мать", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: /Мать: Вера Учебная.*Ребёнок: Анна Учебная/ }).click();
  await expect(page.getByRole("dialog").getByText("Ребёнок: Анна Учебная", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/Пётр Примерный/)).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: explore.close, exact: true }).click();
  await page.getByRole("button", { name: explore.ownerFocus, exact: true }).click();
  await expect(inspector.getByRole("heading", { name: "Иван Учебный", exact: true })).toBeVisible();
});
