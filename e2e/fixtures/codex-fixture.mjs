#!/usr/bin/env node
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

// Test-only executable. It performs no model or network calls and refuses non-test roots.
const root = process.env.FAMILYMIND_PRIVATE_E2E_ROOT;
if (!root || process.env.FAMILYMIND_PRIVATE_ROOT !== root || await readFile(path.join(root, ".synthetic-e2e-owned"), "utf8") !== "family-mind-synthetic-e2e\n") {
  process.exit(2);
}
if (process.argv.slice(2).join(" ") === "--no-daemon login status") {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
if (process.argv.includes("mcp") && process.argv.includes("list")) { process.stdout.write("[]"); process.exit(0); }
if (process.argv.includes("features") && process.argv.includes("list")) {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) if (args[index] === "--disable") process.stdout.write(`${args[index + 1]} stable false\n`);
  process.exit(0);
}
const outputIndex = process.argv.indexOf("--output-last-message");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!output || !path.resolve(output).startsWith(`${path.resolve(root)}${path.sep}`)) process.exit(3);

let input = "";
for await (const chunk of process.stdin) input += chunk;
const schemaIndex = process.argv.indexOf("--output-schema");
const schema = schemaIndex >= 0 ? JSON.parse(await readFile(process.argv[schemaIndex + 1], "utf8")) : {};
const chat = Boolean(schema.properties?.paragraphs);
const search = Boolean(schema.properties?.leads);
if (chat || search) {
  await writeFile(path.join(root, search ? "fixture-chat-web-prompt.txt" : "fixture-chat-answer-prompt.txt"), input, { mode: 0o600 });
  if (chat && input.includes("СИНТЕТИЧЕСКИЙ ДОЛГИЙ ОТВЕТ")) await new Promise(resolve => setTimeout(resolve, 30_000));
  if (chat && input.includes("СИНТЕТИЧЕСКАЯ ОШИБКА")) { process.stdout.write(`${JSON.stringify({ type: "turn.failed" })}\n`); process.exit(1); }
}
const result = chat ? {
  paragraphs: [{ text: "СИНТЕТИЧЕСКИЙ ЧАТ: ответ тестового процесса по семейному источнику; реальная модель не вызывалась.", sourceIds: ["research:synthetic-source"] }],
  unknowns: ["В учебном примере родственная связь пока не доказана."],
  nextSteps: ["Сопоставить исходный синтетический документ."],
} : search ? {
  leads: [{ title: "Синтетическая поисковая зацепка", url: "https://archive.example.org/synthetic-lead", detail: "Только искусственный результат теста; сеть не использовалась." }],
  limitation: "Синтетический процесс, не реальный архивный поиск.",
} : {
  summary: "СИНТЕТИЧЕСКИЙ ТЕСТ: материалы разобраны тестовым процессом, модель и архивный поиск не запускались.",
  observations: [{ text: "В тестовом дереве записан приблизительный год; это не архивное подтверждение.", sourceIds: ["synthetic-source"] }],
  gaps: [{ question: "Какой документ уточняет дату?", why: "В синтетическом дереве нет оригинала записи." }],
  nextSteps: [{ title: "Получить исходную запись", detail: "Запросить у участника разрешённую демонстрационную копию для следующей проверки.", sourceIds: ["synthetic-source"] }],
  proposals: [{ id: "synthetic-proposal", kind: "research", text: "Сохранить вопрос об уточнении даты", rationale: "Тестовое дерево задаёт направление, но не доказывает факт.", sourceIds: ["synthetic-source"], evidenceStatus: "hypothesis", workflowStatus: "proposed" }],
};
await writeFile(output, JSON.stringify(result), { mode: 0o600 });
await writeFile(path.join(root, "fixture-invoked.json"), JSON.stringify({ synthetic: true, invoked: true }), { mode: 0o600 });
if (search) process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { id: "synthetic-web", type: "web_search", query: "Вымышленная Елена Тестова архив" } })}\n`);
process.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
