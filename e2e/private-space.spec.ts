import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalCaseAccess } from "../src/private-case/access";
import { PrivateCaseStore } from "../src/private-case/server-store";
import type { PrivateCase } from "../src/private-case/model";
import type { SpaceStateResponse, SpaceBundle } from "../src/private-case/space-api";
import { syntheticResearch } from "./fixtures/private-research";
import { exploreText as explore } from "../src/i18n/explore";
import { spaceText as s } from "../src/i18n/space";

const origin = "http://127.0.0.1:3001";
const root = process.env.FAMILYMIND_PRIVATE_E2E_ROOT!;
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg==";
let token: string;
let caseId: string;

test.beforeEach(async () => {
  expect(await readFile(path.join(root, ".synthetic-e2e-owned"), "utf8")).toBe("family-mind-synthetic-e2e\n");
  caseId = `space-synthetic-${randomUUID()}`;
  const now = new Date().toISOString();
  const value: PrivateCase = { schemaVersion: 1, id: caseId, title: "СИНТЕТИЧЕСКОЕ пространство", revision: 0, updatedAt: now, subject: { personId: "synthetic-a", name: "Анна Учебная", dateText: "около 1900", livingStatus: "deceased" }, sources: [], known: [], question: "Учебный вопрос", notes: "Только вымышленное дело.", aiRuns: [], reviews: [] };
  await new PrivateCaseStore(root).save(value, null);
  await mkdir(path.join(root, "research"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "research", `${caseId}.json`), JSON.stringify(syntheticResearch()), { mode: 0o600 });
  await writeFile(path.join(root, "synthetic-upload.png"), Buffer.from(PNG_BASE64, "base64"), { mode: 0o600 });
  ({ token } = await new LocalCaseAccess(root, origin).createBootstrap(caseId));
});

async function openSpace(page: Page) {
  await page.goto(`/case#token=${encodeURIComponent(token)}&view=explore`);
  await expect(page.getByTestId("private-explore")).toBeVisible();
  await expect(page.getByTestId("space-save-state")).toContainText(`${s.revision} 0`);
}
const spaceState = async (page: Page) => (await (await page.request.get("/api/private/space")).json()) as SpaceStateResponse;
const openAddMenu = async (page: Page, option: string) => {
  await page.getByTestId("add-menu").locator("summary").click();
  await page.getByTestId("add-menu").getByRole("menuitem", { name: option, exact: true }).click();
};
const openMore = async (page: Page, option: string) => {
  await page.locator("summary", { hasText: s.more }).first().click();
  await page.getByRole("button", { name: option }).click();
};

test("owner adds a parent and a photo, moves cards, and composition survives reload, export, removal and import", async ({ page, browser }) => {
  page.setDefaultTimeout(15_000);
  await openSpace(page);
  const map = page.getByTestId("research-map");
  const inspector = page.getByTestId("research-inspector");
  await expect(map.getByRole("button", { name: /^Иван Учебный, Вы,/ })).toBeVisible();
  await expect(page.getByTestId("first-callout")).toBeVisible();
  await expect(page.getByTestId("guide-step")).toHaveText(s.guide.add_material.title.replace("{name}", "Иван Учебный"));

  await openAddMenu(page, s.add.parent);
  const personForm = page.getByTestId("person-form");
  await personForm.getByLabel(s.personName, { exact: true }).fill("Пётр Примерный");
  await personForm.getByLabel(s.personDate, { exact: true }).fill("около 1905 — 1970");
  await expect(personForm.getByLabel(s.relationTo)).toHaveValue("synthetic-b");
  await expect(personForm.getByLabel(s.newPersonIs)).toHaveValue("parent");
  await personForm.getByLabel(s.parentRole).selectOption("father");
  await personForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(personForm).toHaveCount(0);
  await expect(map.getByRole("button", { name: /^Пётр Примерный, Отец,/ })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Пётр Примерный", exact: true })).toBeVisible();
  await expect(page.getByTestId("space-save-state")).toContainText(`${s.revision} 1`);
  await expect(page.getByTestId("first-callout")).toHaveCount(0);
  let state = await spaceState(page);
  const fatherId = state.space.people[0].id;
  expect(state.space.relationships[0]).toMatchObject({ from: fatherId, to: "synthetic-b", kind: "parent_child", parentRole: "father", evidenceStatus: "hypothesis" });
  expect(state.space.journal.map(entry => entry.action)).toEqual(["migrated", "add_person", "add_relationship"]);

  await inspector.getByRole("button", { name: `＋ ${s.add.photo}`, exact: true }).click();
  const materialForm = page.getByTestId("material-form");
  await expect(materialForm.getByLabel(s.materialKind)).toHaveValue("photo");
  await materialForm.getByLabel(s.materialTitle, { exact: true }).fill("Синтетическое фото отца");
  await materialForm.getByLabel(s.materialFile).setInputFiles(path.join(root, "synthetic-upload.png"));
  await materialForm.getByLabel(s.materialProvenance, { exact: true }).fill("Учебный альбом, не настоящий документ");
  await expect(materialForm.getByTestId("material-people").getByRole("checkbox", { name: /Пётр Примерный/ })).toBeChecked();
  await materialForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(materialForm).toHaveCount(0);
  const materialCard = map.getByRole("button", { name: `${s.materialKinds.photo}: Синтетическое фото отца`, exact: true });
  await expect(materialCard).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Синтетическое фото отца", exact: true })).toBeVisible();
  await expect(inspector.getByText("Учебный альбом, не настоящий документ", { exact: true })).toBeVisible();
  state = await spaceState(page);
  const materialId = state.space.materials[0].id;
  expect(state.space.materials[0].original).toMatchObject({ name: "synthetic-upload.png", mime: "image/png", size: Buffer.from(PNG_BASE64, "base64").length });
  const media = await page.request.get(`/api/private/space/media?id=${materialId}`);
  expect(media.status()).toBe(200);
  expect((await media.body()).toString("base64")).toBe(PNG_BASE64);
  expect(media.headers()["cache-control"]).toContain("no-store");

  await page.getByRole("button", { name: explore.allGenerations, exact: true }).click();
  await page.waitForTimeout(400);
  const materialBox = (await materialCard.boundingBox())!;
  await page.mouse.move(materialBox.x + materialBox.width / 2, materialBox.y + materialBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(materialBox.x + materialBox.width / 2 + 60, materialBox.y + materialBox.height / 2 + 90, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => Boolean((await spaceState(page)).space.layout.positions[`material:${materialId}`]), { timeout: 10_000 }).toBe(true);
  state = await spaceState(page);
  const savedPosition = state.space.layout.positions[`material:${materialId}`];
  expect(state.space.relationships).toHaveLength(1);
  expect(state.space.materials[0].personIds).toEqual([fatherId]);

  await page.reload();
  await expect(page.getByTestId("private-explore")).toBeVisible();
  await expect(map.getByRole("button", { name: /^Пётр Примерный, Отец,/ })).toBeVisible();
  await expect(map.getByRole("button", { name: `${s.materialKinds.photo}: Синтетическое фото отца`, exact: true })).toBeVisible();
  const reloaded = await spaceState(page);
  expect(reloaded.space.layout.positions[`material:${materialId}`]).toEqual(savedPosition);
  expect(reloaded.space.revision).toBe(state.space.revision);

  const downloadEvent = page.waitForEvent("download");
  await openMore(page, s.exportSpace);
  const download = await downloadEvent;
  const bundlePath = (await download.path())!;
  const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as SpaceBundle;
  expect(bundle.format).toBe("family-mind-space");
  expect(bundle.caseId).toBe(caseId);
  expect(bundle.files).toHaveLength(1);
  expect(bundle.files[0].dataUrl).toBe(`data:image/png;base64,${PNG_BASE64}`);
  expect(JSON.stringify(bundle)).not.toContain("fm_private_session");

  await map.getByRole("button", { name: `${s.materialKinds.photo}: Синтетическое фото отца`, exact: true }).click();
  await inspector.getByRole("button", { name: s.remove, exact: true }).click();
  await expect(map.getByRole("button", { name: `${s.materialKinds.photo}: Синтетическое фото отца`, exact: true })).toHaveCount(0);
  state = await spaceState(page);
  expect(state.space.materials[0].removedAt).not.toBeNull();
  const stale = await page.request.post("/api/private/space/mutate", { headers: { Origin: origin }, data: { expectedRevision: 0, action: { action: "guide_reset" } } });
  expect(stale.status()).toBe(409);
  const crossOrigin = await page.request.post("/api/private/space/mutate", { headers: { Origin: "https://attacker.example" }, data: { expectedRevision: state.space.revision, action: { action: "guide_reset" } } });
  expect(crossOrigin.status()).toBe(403);
  const corrupt = structuredClone(bundle);
  corrupt.files[0].dataUrl = "data:image/png;base64,AAAA";
  const rejected = await page.request.post("/api/private/space/import", { headers: { Origin: origin }, data: { expectedRevision: state.space.revision, bundle: corrupt } });
  expect(rejected.status()).toBe(400);
  expect((await spaceState(page)).space).toEqual(state.space);

  await openMore(page, s.importSpace);
  const importDialog = page.getByRole("dialog");
  await importDialog.getByLabel(s.importFile, { exact: true }).setInputFiles(bundlePath);
  await importDialog.getByRole("button", { name: s.checkImport, exact: true }).click();
  await expect(importDialog.getByTestId("import-preview")).toBeVisible();
  await importDialog.getByRole("button", { name: s.importConfirm, exact: true }).click();
  await expect(importDialog).toHaveCount(0);
  await expect(map.getByRole("button", { name: `${s.materialKinds.photo}: Синтетическое фото отца`, exact: true })).toBeVisible();
  state = await spaceState(page);
  expect(state.space.materials[0].removedAt).toBeNull();
  expect(state.space.layout.positions[`material:${materialId}`]).toEqual(savedPosition);
  expect(state.space.journal.at(-1)?.action).toBe("import");
  expect((await (await page.request.get(`/api/private/space/media?id=${materialId}`)).body()).toString("base64")).toBe(PNG_BASE64);

  const anonymous = await browser.newContext({ baseURL: origin });
  try {
    expect((await anonymous.request.get("/api/private/space")).status()).toBe(401);
    expect((await anonymous.request.get(`/api/private/space/media?id=${materialId}`)).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});

test("a manual lead becomes a candidate the owner contests, records as nothing found, then accepts into a placed material with an original", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await openSpace(page);
  const map = page.getByTestId("research-map");
  const inspector = page.getByTestId("research-inspector");
  await expect(inspector.getByRole("heading", { name: "Иван Учебный", exact: true })).toBeVisible();

  await inspector.getByRole("button", { name: `＋ ${s.add.lead}`, exact: true }).click();
  const leadForm = page.getByTestId("lead-form");
  await expect(leadForm.getByLabel(s.leadQuestion)).toHaveValue(s.leadDefaultQuestion.replace("{name}", "Иван Учебный"));
  await leadForm.getByLabel(s.leadPlace, { exact: true }).fill("Учебная губерния");
  await leadForm.getByLabel(s.leadPeriod, { exact: true }).fill("около 1930");
  await leadForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(leadForm).toHaveCount(0);
  await expect(inspector.getByRole("heading", { name: s.leadDefaultQuestion.replace("{name}", "Иван Учебный"), exact: true })).toBeVisible();
  await expect(inspector.getByTestId("lead-status")).toHaveText(s.leadStatus.open);
  await expect(page.getByTestId("research-state")).toHaveText(s.researchState.replace("{open}", "1").replace("{pending}", "0"));
  await expect(page.getByText(s.researchManual, { exact: true })).toBeVisible();

  await inspector.getByRole("button", { name: s.leadAddFind, exact: true }).click();
  const findForm = page.getByTestId("find-form");
  await findForm.getByLabel(s.findTitleField, { exact: true }).fill("Запись о тёзке");
  await findForm.getByLabel(s.findSourceTitle, { exact: true }).fill("Синтетический индекс");
  await findForm.getByLabel(s.findSourceUrl, { exact: true }).fill("https://archive.example.org/synthetic-namesake");
  await findForm.getByLabel(s.findWhyField, { exact: true }).fill("Совпадает только имя; год рождения другой.");
  await expect(findForm.getByTestId("find-people").getByRole("checkbox", { name: /Иван Учебный/ })).toBeChecked();
  await findForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(findForm).toHaveCount(0);
  const candidateCard = map.getByRole("button", { name: `${s.findKind}: Запись о тёзке`, exact: true });
  await expect(candidateCard).toBeVisible();
  await expect(inspector.getByTestId("find-status")).toHaveText(s.findStatus.candidate);
  await expect(inspector.getByText("Совпадает только имя; год рождения другой.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("research-state")).toHaveText(s.researchState.replace("{open}", "1").replace("{pending}", "1"));
  let state = await spaceState(page);
  const leadId = state.space.leads[0].id;
  expect(state.space.leads[0].status).toBe("candidate");
  expect(state.space.finds[0]).toMatchObject({ status: "candidate", performedBy: "operator_manual", leadId });

  await map.getByRole("button", { name: /^Иван Учебный, Вы,/ }).click();
  await expect(page.getByTestId("guide-step")).toHaveText(s.guide.review_find.title.replace("{detail}", "Запись о тёзке"));
  await page.getByTestId("space-guide").getByRole("button", { name: s.guideDo, exact: true }).click();
  await expect(inspector.getByRole("heading", { name: "Запись о тёзке", exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: s.findContest, exact: true }).click();
  const contestForm = page.getByTestId("decide-form");
  await contestForm.getByLabel(s.decideReason, { exact: true }).fill("Однофамилец: в источнике другой год рождения.");
  await contestForm.getByRole("button", { name: s.findContest, exact: true }).click();
  await expect(contestForm).toHaveCount(0);
  await expect(inspector.getByTestId("find-status")).toHaveText(s.findStatus.contested);
  await expect(candidateCard).toHaveCount(0);
  state = await spaceState(page);
  expect(state.space.finds[0]).toMatchObject({ status: "contested", decisionReason: "Однофамилец: в источнике другой год рождения.", materialId: null });
  expect(state.space.leads[0].status).toBe("open");
  expect(state.space.materials).toHaveLength(0);

  await inspector.getByRole("button", { name: s.leadDefaultQuestion.replace("{name}", "Иван Учебный") }).click();
  await expect(inspector.getByTestId("lead-status")).toHaveText(s.leadStatus.open);
  await inspector.getByRole("button", { name: s.leadNothing, exact: true }).click();
  const outcomeForm = page.getByTestId("lead-outcome-form");
  await outcomeForm.getByLabel(s.leadCoverage, { exact: true }).fill("Просмотрен синтетический индекс за 1925–1935.");
  await outcomeForm.getByLabel(s.leadMissingDetail, { exact: true }).fill("Отчество");
  await outcomeForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(outcomeForm).toHaveCount(0);
  await expect(inspector.getByTestId("lead-status")).toHaveText(s.leadStatus.nothing_found);
  await expect(inspector.getByText("Просмотрен синтетический индекс за 1925–1935.", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Отчество", { exact: true })).toBeVisible();

  await inspector.getByRole("button", { name: s.leadAddFind, exact: true }).click();
  const secondFind = page.getByTestId("find-form");
  await secondFind.getByLabel(s.findTitleField, { exact: true }).fill("Метрическая запись (учебная)");
  await secondFind.getByLabel(s.findSourceTitle, { exact: true }).fill("Синтетическая метрическая книга");
  await secondFind.getByLabel(s.findSourceLocator, { exact: true }).fill("Лист 7, запись 12");
  await secondFind.getByLabel(s.findSourceExcerpt, { exact: true }).fill("Учебная выдержка: имя, отчество и место совпадают.");
  await secondFind.getByLabel(s.findWhyField, { exact: true }).fill("Совпадают имя, отчество, место и приблизительный год.");
  await secondFind.getByRole("button", { name: s.save, exact: true }).click();
  await expect(secondFind).toHaveCount(0);
  await inspector.getByRole("button", { name: s.findAccept, exact: true }).click();
  const acceptForm = page.getByTestId("decide-form");
  await acceptForm.getByLabel(s.decideReason, { exact: true }).fill("Открыл запись: совпадают имя, отчество, место и год.");
  await expect(acceptForm.getByTestId("decide-people").getByRole("checkbox", { name: /Иван Учебный/ })).toBeChecked();
  await acceptForm.getByLabel(s.decideNextQuestion, { exact: true }).fill("Найти родителей по этой записи");
  await acceptForm.getByRole("button", { name: s.findAccept, exact: true }).click();
  await expect(acceptForm).toHaveCount(0);
  const placed = map.getByRole("button", { name: `${s.materialKinds.document}: Метрическая запись (учебная)`, exact: true });
  await expect(placed).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Метрическая запись (учебная)", exact: true })).toBeVisible();
  await expect(inspector.getByText(new RegExp(s.originExternal))).toBeVisible();
  await expect(page.getByTestId("research-state")).toHaveCount(0);
  state = await spaceState(page);
  const material = state.space.materials[0];
  expect(material).toMatchObject({ kind: "document", origin: "external_find", personIds: ["synthetic-b"], provenance: "Синтетическая метрическая книга · Лист 7, запись 12", original: null });
  expect(state.space.finds[1]).toMatchObject({ status: "accepted", materialId: material.id });
  expect(state.space.leads[0]).toMatchObject({ status: "done", nextQuestion: "Найти родителей по этой записи" });
  expect(state.space.journal.slice(-3).map(entry => entry.action)).toEqual(["add_find", "add_material", "decide_find"]);

  await inspector.getByRole("button", { name: s.attachOriginal, exact: true }).click();
  const attachForm = page.getByTestId("attach-form");
  await attachForm.getByLabel(s.materialFile).setInputFiles(path.join(root, "synthetic-upload.png"));
  await attachForm.getByRole("button", { name: s.attachOriginal, exact: true }).click();
  await expect(attachForm).toHaveCount(0);
  await expect(inspector.getByText(/synthetic-upload\.png/)).toBeVisible();
  state = await spaceState(page);
  expect(state.space.materials[0].original).toMatchObject({ name: "synthetic-upload.png", mime: "image/png" });
  expect((await (await page.request.get(`/api/private/space/media?id=${material.id}`)).body()).toString("base64")).toBe(PNG_BASE64);
  await inspector.getByRole("button", { name: s.openFind, exact: true }).click();
  await expect(inspector.getByTestId("find-status")).toHaveText(s.findStatus.accepted);
  await expect(inspector.getByText(s.findStatusNote, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("private-explore")).toBeVisible();
  await expect(map.getByRole("button", { name: `${s.materialKinds.document}: Метрическая запись (учебная)`, exact: true })).toBeVisible();
});

test("the guide proposes one step, skipping persists, namesakes stay separate and the phone layout supports adding", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await openSpace(page);
  const guide = page.getByTestId("space-guide");
  await expect(guide.getByTestId("guide-step")).toHaveText(s.guide.add_material.title.replace("{name}", "Иван Учебный"));
  await guide.getByRole("button", { name: s.guideSkip, exact: true }).click();
  await expect(guide.getByTestId("guide-step")).toHaveText(s.guide.add_lead.title.replace("{name}", "Иван Учебный"));
  await page.reload();
  await expect(page.getByTestId("guide-step")).toHaveText(s.guide.add_lead.title.replace("{name}", "Иван Учебный"));
  expect((await spaceState(page)).space.guide.dismissed).toEqual(["material:synthetic-b"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: explore.list, exact: true }).click();
  await page.getByRole("button", { name: /Анна Учебная.*около 1900/ }).click();
  await openAddMenu(page, s.add.partner);
  const personForm = page.getByTestId("person-form");
  await expect(personForm.getByLabel(s.relationTo)).toHaveValue("synthetic-a");
  await personForm.getByLabel(s.personName, { exact: true }).fill("Анна Учебная");
  await expect(personForm.getByText(s.namesakeHint, { exact: true })).toBeVisible();
  await personForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(personForm).toHaveCount(0);
  const state = await spaceState(page);
  expect(state.space.people).toHaveLength(1);
  expect(state.space.people[0].id).not.toBe("synthetic-a");
  expect(state.space.relationships[0]).toMatchObject({ from: "synthetic-a", to: state.space.people[0].id, kind: "partner" });
  await openAddMenu(page, s.add.note);
  const materialForm = page.getByTestId("material-form");
  await expect(materialForm.getByLabel(s.materialKind)).toHaveValue("note");
  await materialForm.getByLabel(s.materialTitle, { exact: true }).fill("Заметка с телефона");
  await materialForm.getByLabel(s.materialText, { exact: true }).fill("Синтетическая заметка, набранная на узком экране.");
  await materialForm.getByRole("button", { name: s.save, exact: true }).click();
  await expect(materialForm).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId("research-inspector").getByRole("heading", { name: "Заметка с телефона", exact: true })).toBeVisible();
  expect((await spaceState(page)).space.materials[0]).toMatchObject({ kind: "note", original: null, origin: "owner" });
});
