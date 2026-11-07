import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ru as t } from '../src/i18n/ru';
import { researchText as r } from '../src/i18n/research';
import { editorText as et } from '../src/i18n/editor';
import type { Workspace } from '../src/domain/model';

const personName = 'Елена Тестова';
const sourceTitle = 'DEMO · запись Елены';
const sourceText = 'СИНТЕТИЧЕСКИЙ ПРИМЕР. Не архивный документ.\nЕлена Тестова родилась около 1910 года.\nЛист 7.';

async function saved(page: Page) {
  await expect(page.getByText(t.saved, { exact: true })).toBeVisible();
}

async function boot(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.goto('/');
  await saved(page);
}

async function exportThroughUi(page: Page) {
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: t.export }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = await readFile(path!, 'utf8');
  const parsed = JSON.parse(text) as { format: string; version: number; workspace: Workspace; omittedFiles: string[] };
  expect(parsed.format).toBe('family-mind');
  expect(parsed.version).toBe(1);
  return { path: path!, text, parsed };
}

async function createEmptyProject(page: Page) {
  await page.getByRole('button', { name: t.newProject, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.projectName).fill('Синтетический пустой проект');
  await dialog.getByRole('button', { name: t.replace, exact: true }).click();
  await saved(page);
  await expect(dialog).toHaveCount(0);
}

test('synthetic research survives edits, review, reload and a portable file round-trip', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await page.getByRole('button', { name: t.list }).click();

  await page.getByRole('button', { name: t.addPerson }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.name, { exact: true }).fill(personName);
  await dialog.getByLabel(t.variants).fill('Елена Тестовая; Елена Демонстрационная');
  await dialog.getByLabel(t.date).fill('около 1910');
  await dialog.getByRole('combobox', { name: t.status, exact: true }).selectOption('unknown');
  await dialog.getByRole('textbox', { name: t.notes, exact: true }).fill('Вымышленный человек для проверки интерфейса.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);
  let inspector = page.getByRole('complementary', { name: t.detail });
  await expect(inspector.getByRole('heading', { name: personName, exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: t.edit, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: t.notes, exact: true }).fill('Вымышленный человек. Проверено редактирование и сохранение.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);

  await page.getByRole('button', { name: t.addSource }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.sourceTitle).fill(sourceTitle);
  await dialog.getByLabel(t.citation).fill('Вымышленная коллекция / лист 7');
  await dialog.getByLabel(t.originalId, { exact: false }).fill('demo-elena-original');
  await dialog.getByLabel(/^Демонстрационный файл/).setInputFiles({ name: 'demo-elena.txt', mimeType: 'text/plain', buffer: Buffer.from(sourceText) });
  await dialog.getByRole('textbox', { name: t.transcription, exact: true }).fill('Расшифровка: дата приблизительная, около 1910.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);
  inspector = page.getByRole('complementary', { name: t.detail });
  await expect(inspector.getByText(sourceText, { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: t.edit, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.citation).fill('Вымышленная коллекция / лист 7, оборот');
  await dialog.getByLabel(/^Демонстрационный файл/).setInputFiles({ name: 'demo-elena-second.txt', mimeType: 'text/plain', buffer: Buffer.from('СИНТЕТИЧЕСКИЙ ПРИМЕР. Дополнительный лист 8. Родство не указано.') });
  await dialog.getByRole('textbox', { name: t.transcription, exact: true }).fill('Отдельная расшифровка второго файла.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);
  await expect(inspector.getByText(sourceText, { exact: true })).toBeVisible();
  await expect(inspector.getByText('Отдельная расшифровка второго файла.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: t.addClaim, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: t.subject, exact: true }).selectOption({ label: `${personName} · около 1910` });
  const createdPersonId = await dialog.getByRole('combobox', { name: t.subject, exact: true }).inputValue();
  await dialog.getByLabel(t.predicate).fill('Год рождения');
  await dialog.getByLabel(t.value).fill('около 1910');
  await dialog.getByRole('textbox', { name: t.rationale, exact: true }).fill('Синтетическая запись указывает приблизительный год; нужны дополнительные источники.');
  await dialog.getByRole('combobox', { name: t.chooseSource, exact: true }).selectOption({ label: sourceTitle });
  const artifactValue = await dialog.getByRole('option', { name: /^demo-elena\.txt/ }).getAttribute('value');
  await dialog.getByRole('combobox', { name: et.artifact, exact: false }).selectOption(artifactValue!);
  await dialog.getByLabel(t.locator).fill('Лист 7, оборот');
  await dialog.getByRole('textbox', { name: t.excerpt, exact: true }).fill('Елена Тестова родилась около 1910 года.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);
  inspector = page.getByRole('complementary', { name: t.detail });
  await expect(inspector.getByText('Лист 7, оборот', { exact: true })).toBeVisible();
  await expect(inspector.getByTestId('evidence-status')).toHaveText(t.evidenceNames.hypothesis);

  await page.getByRole('button', { name: t.addRelation, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: t.from, exact: true }).selectOption({ label: `${personName} · около 1910` });
  await dialog.getByRole('combobox', { name: t.to, exact: true }).selectOption('person-maria');
  await dialog.getByRole('combobox', { name: t.relationKind, exact: true }).selectOption('guardian');
  await dialog.getByRole('textbox', { name: t.rationale, exact: true }).fill('Учебная версия опеки без подтверждения; сохранить для проверки.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);
  inspector = page.getByRole('complementary', { name: t.detail });
  await expect(inspector.getByTestId('evidence-status')).toHaveText(t.evidenceNames.hypothesis);
  await inspector.getByRole('textbox', { name: t.reason, exact: true }).fill('Принимаем только как рабочую гипотезу; документ об опеке ещё не найден.');
  await inspector.getByRole('button', { name: t.accept, exact: true }).click();
  await saved(page);
  await expect(inspector.getByTestId('workflow-status')).toHaveText(t.workflowNames.accepted);
  await expect(inspector.getByTestId('evidence-status')).toHaveText(t.evidenceNames.hypothesis);

  await page.getByRole('button', { name: t.research }).click();
  await page.getByRole('button', { name: r.newQuestion, exact: true }).click();
  const research = page.getByRole('region', { name: r.title, exact: true });
  await research.getByLabel(r.question, { exact: true }).fill('Как уточнить год рождения Елены?');
  await research.getByRole('combobox', { name: r.person, exact: true }).selectOption(createdPersonId);
  await research.getByRole('textbox', { name: r.known, exact: true }).fill('Есть синтетическая запись с приблизительной датой.');
  await research.getByLabel(r.place).fill('Вымышленное Луговое');
  await research.getByLabel(r.period).fill('1909–1911; календарь неизвестен');
  await research.getByRole('textbox', { name: r.plan, exact: true }).fill('Прочитать лист 7 и сравнить с независимым документом.');
  await research.getByRole('textbox', { name: r.limitations, exact: true }).fill('Реальные архивы не проверялись.');
  await research.getByRole('button', { name: r.createQuestion, exact: true }).click();
  await saved(page);
  await research.getByRole('combobox', { name: r.selectSource, exact: true }).selectOption({ label: sourceTitle });
  await research.getByLabel(r.attachmentCoverage).fill('Лист 7, оборот');
  await research.getByLabel(r.attachmentNotes).fill('В вымышленном документе указано около 1910 года.');
  await research.getByRole('button', { name: r.attachSource, exact: true }).click();
  await saved(page);
  await expect(research.getByText(r.attachmentAction, { exact: true })).toBeVisible();
  await research.getByRole('combobox', { name: r.status, exact: true }).selectOption('resolved');
  await research.getByRole('textbox', { name: r.outcome, exact: true }).fill('Приблизительная дата сохранена; точный год не установлен.');
  await research.getByRole('button', { name: r.generateDraft, exact: true }).click();
  await expect(research.getByRole('textbox', { name: r.draftLabel, exact: true })).toHaveValue(new RegExp(sourceTitle));
  await research.getByRole('textbox', { name: r.draftLabel, exact: true }).fill(`${await research.getByRole('textbox', { name: r.draftLabel, exact: true }).inputValue()}\n\nДополнение: не заказывать платные копии.`);
  await research.getByRole('button', { name: r.save, exact: true }).click();
  await saved(page);

  const before = await exportThroughUi(page);
  const w = before.parsed.workspace;
  const person = w.people.find((item) => item.name === personName)!;
  expect(person.notes).toContain('Проверено редактирование');
  expect(w.people.filter((item) => item.name === 'Алексей Ветров')).toHaveLength(2);
  const artifact = w.artifacts.find((item) => item.name === 'demo-elena.txt')!;
  expect(Buffer.from(artifact.dataUrl!.split(',')[1], 'base64').toString('utf8')).toBe(sourceText);
  expect(artifact.transcription).not.toBe(sourceText);
  const source = w.sources.find((item) => item.id === artifact.sourceId)!;
  expect(source.citation).toContain('оборот');
  expect(w.artifacts.filter((item) => item.sourceId === source.id)).toHaveLength(2);
  expect(w.artifacts.find((item) => item.name === 'demo-elena-second.txt')?.transcription).toBe('Отдельная расшифровка второго файла.');
  const claim = w.claims.find((item) => item.personId === person.id)!;
  expect(w.evidence.some((item) => item.targetId === claim.id && item.artifactId === artifact.id && item.locator === 'Лист 7, оборот')).toBe(true);
  const relation = w.relationships.find((item) => item.fromPersonId === person.id)!;
  expect(relation.workflowStatus).toBe('accepted');
  expect(relation.evidenceStatus).toBe('hypothesis');
  expect(w.reviews.some((item) => item.targetId === relation.id && item.evidenceStatusAtDecision === 'hypothesis')).toBe(true);
  const question = w.questions.find((item) => item.personId === person.id)!;
  expect(question.archivistDraft).toContain(sourceTitle);
  expect(question.archivistDraft).toContain('Дополнение: не заказывать платные копии.');
  expect(question.status).toBe('resolved');
  expect(w.runs.some((item) => item.questionId === question.id && item.mode === 'manual' && item.sourceIds.includes(source.id))).toBe(true);

  await page.reload();
  await saved(page);
  expect((await exportThroughUi(page)).parsed.workspace).toEqual(w);
  await createEmptyProject(page);
  expect((await exportThroughUi(page)).parsed.workspace.people).toHaveLength(0);
  await page.getByRole('button', { name: t.import }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.importFile).setInputFiles(before.path);
  await dialog.getByRole('button', { name: t.importCheck, exact: true }).click();
  await expect(dialog.getByText(t.importReady, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: t.importConfirm, exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  const restored = (await exportThroughUi(page)).parsed.workspace;
  for (const field of ['people', 'sources', 'artifacts', 'claims', 'relationships', 'evidence', 'reviews', 'questions', 'runs', 'positions'] as const) {
    expect(restored[field]).toEqual(w[field]);
  }
  expect(errors).toEqual([]);
});

test('invalid import and unsupported upload leave the saved workspace intact', async ({ page }) => {
  await boot(page);
  const before = await exportThroughUi(page);
  const badPackage = JSON.parse(before.text);
  badPackage.workspace.people[0].synthetic = false;
  await page.getByRole('button', { name: t.import }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.importFile).setInputFiles({ name: 'invalid-demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badPackage)) });
  await dialog.getByRole('button', { name: t.importCheck, exact: true }).click();
  await expect(page.locator('.error-banner[role="alert"]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: t.importConfirm, exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
  expect((await exportThroughUi(page)).parsed.workspace).toEqual(before.parsed.workspace);

  await page.getByRole('button', { name: t.addSource }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.sourceTitle).fill('Недопустимый демонстрационный формат');
  await dialog.getByLabel(t.citation).fill('Синтетический тест формата');
  await dialog.getByLabel(/^Демонстрационный файл/).setInputFiles({ name: 'demo.html', mimeType: 'text/html', buffer: Buffer.from('<html><body>synthetic demo</body></html>') });
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await expect(page.locator('.error-banner[role="alert"]')).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
  expect((await exportThroughUi(page)).parsed.workspace).toEqual(before.parsed.workspace);
  await page.reload();
  await saved(page);
  expect((await exportThroughUi(page)).parsed.workspace).toEqual(before.parsed.workspace);
});

test('canvas position persists and mobile list keeps the inspector accessible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await boot(page);
  await page.screenshot({ path: '.local/qa/desktop-family-mind.png', fullPage: true });
  const before = (await exportThroughUi(page)).parsed.workspace.positions['person-petr'];
  const node = page.locator('.react-flow__node[data-id="person-petr"]');
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 55, { steps: 10 });
  await page.mouse.up();
  await saved(page);
  const after = (await exportThroughUi(page)).parsed.workspace.positions['person-petr'];
  expect(after).not.toEqual(before);
  await page.reload();
  await saved(page);
  expect((await exportThroughUi(page)).parsed.workspace.positions['person-petr']).toEqual(after);
  await node.focus();
  await node.press('Enter');
  await expect(page.getByRole('complementary', { name: t.detail })).toBeVisible();
  await node.press('ArrowRight');
  await saved(page);
  const keyboardPosition = (await exportThroughUi(page)).parsed.workspace.positions['person-petr'];
  expect(keyboardPosition).not.toEqual(after);
  await page.reload();
  await saved(page);
  expect((await exportThroughUi(page)).parsed.workspace.positions['person-petr']).toEqual(keyboardPosition);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: t.list }).click();
  await page.getByRole('button', { name: t.people }).click();
  await page.getByRole('button', { name: /Пётр Ветров/ }).last().click();
  const inspector = page.getByRole('complementary', { name: t.detail });
  await expect(inspector.getByRole('heading', { name: 'Пётр Ветров', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: t.edit, exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.screenshot({ path: '.local/qa/mobile-family-mind.png', fullPage: true });
});

test('a stale tab retains the research draft and cannot overwrite newer saved changes', async ({ page, context }) => {
  await boot(page);
  const second = await context.newPage();
  await boot(second);
  await second.getByRole('button', { name: t.research }).click();
  const research = second.getByRole('region', { name: r.title, exact: true });
  const unsavedDraft = 'СИНТЕТИЧЕСКИЙ ЧЕРНОВИК: новую версию нельзя потерять при конфликте вкладок.';
  await research.getByRole('textbox', { name: r.known, exact: true }).fill(unsavedDraft);

  await page.getByRole('button', { name: t.people }).click();
  await page.getByTestId('object-person-maria').click();
  await page.getByRole('complementary', { name: t.detail }).getByRole('button', { name: t.edit, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: t.notes, exact: true }).fill('СИНТЕТИЧЕСКИЙ ПРИМЕР. Новая запись первой вкладки.');
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await saved(page);

  await research.getByRole('button', { name: r.save, exact: true }).click();
  await expect(second.locator('.error-banner[role="alert"]')).toContainText('другой вкладке');
  await expect(research.getByRole('textbox', { name: r.known, exact: true })).toHaveValue(unsavedDraft);
  const recoverable = (await exportThroughUi(second)).parsed.workspace;
  expect(recoverable.questions.find((item) => item.id === 'question-birth')?.known).toBe(unsavedDraft);

  await page.reload();
  await saved(page);
  const actual = (await exportThroughUi(page)).parsed.workspace;
  expect(actual.people.find((item) => item.id === 'person-maria')?.notes).toContain('Новая запись первой вкладки');
  expect(actual.questions.find((item) => item.id === 'question-birth')?.known).not.toBe(unsavedDraft);
  await second.getByRole('button', { name: t.reload, exact: true }).click();
  await saved(second);
  expect((await exportThroughUi(second)).parsed.workspace).toEqual(actual);
});

test('a storage quota failure is visible and its pending change can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if ((window as Window & { __familyMindTestQuota?: boolean }).__familyMindTestQuota) {
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  });
  await boot(page);
  const before = (await exportThroughUi(page)).parsed.workspace;
  await page.getByRole('button', { name: t.people }).click();
  await page.getByTestId('object-person-maria').click();
  await page.getByRole('complementary', { name: t.detail }).getByRole('button', { name: t.edit, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const note = 'СИНТЕТИЧЕСКИЙ ПРИМЕР. Изменение пережило ошибку квоты и повтор сохранения.';
  await dialog.getByRole('textbox', { name: t.notes, exact: true }).fill(note);
  await page.evaluate(() => { (window as Window & { __familyMindTestQuota?: boolean }).__familyMindTestQuota = true; });
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await expect(page.getByText(t.saveError, { exact: true })).toBeVisible();
  await expect(page.locator('.error-banner[role="alert"]')).toContainText('недостаточно места');
  await expect(dialog.getByRole('textbox', { name: t.notes, exact: true })).toHaveValue(note);
  await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
  await page.evaluate(() => { (window as Window & { __familyMindTestQuota?: boolean }).__familyMindTestQuota = false; });
  await page.getByRole('button', { name: t.retry, exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  const after = (await exportThroughUi(page)).parsed.workspace;
  expect(after.people.find((item) => item.id === 'person-maria')?.notes).toBe(note);
  expect(after.people.length).toBe(before.people.length);
  expect(after.artifacts).toEqual(before.artifacts);
});

test('200 synthetic objects import, render and remain searchable in list and canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await boot(page);
  const initial = await exportThroughUi(page);
  const people: Workspace['people'] = Array.from({ length: 200 }, (_, index) => ({
    id: `bulk-person-${index}`, name: `DEMO персонаж ${String(index + 1).padStart(3, '0')}`,
    variants: [], dateText: 'около 1900 — синтетический пример', calendar: 'unknown',
    livingStatus: 'unknown', notes: 'Полностью вымышленная карточка для проверки объёма.', synthetic: true,
  }));
  const workspace: Workspace = {
    ...initial.parsed.workspace, id: 'bulk-demo-workspace', title: '200 синтетических карточек', revision: 0,
    people, sources: [], artifacts: [], claims: [], relationships: [], evidence: [], reviews: [], questions: [], runs: [],
    positions: Object.fromEntries(people.map((person, index) => [person.id, { x: index % 10 * 300, y: Math.floor(index / 10) * 200 }])),
  };
  const portable = { ...JSON.parse(initial.text), workspace, omittedFiles: [] };
  await page.getByRole('button', { name: t.import }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t.importFile).setInputFiles({ name: 'demo-200-objects.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
  await dialog.getByRole('button', { name: t.importCheck, exact: true }).click();
  await dialog.getByRole('button', { name: t.importConfirm, exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: t.list }).click();
  await expect(page.getByTestId(/^object-bulk-person-/)).toHaveCount(200);
  await page.getByRole('textbox', { name: t.search, exact: true }).fill('DEMO персонаж 137');
  await expect(page.getByTestId(/^object-bulk-person-/)).toHaveCount(1);
  await expect(page.getByTestId('object-bulk-person-136')).toContainText('DEMO персонаж 137');
  await page.getByRole('textbox', { name: t.search, exact: true }).clear();
  await page.getByRole('button', { name: t.canvas }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(200);
  await page.screenshot({ path: '.local/qa/200-synthetic-canvas.png', fullPage: true });
  await page.reload();
  await saved(page);
  expect((await exportThroughUi(page)).parsed.workspace.people).toEqual(people);
});
