import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privateClasses } from "./private-runtime.mjs";
const { PrivateCaseStore, DEFAULT_PRIVATE_ROOT, buildEvidenceRegisters, ensurePrivateDir } = await privateClasses();
const store = new PrivateCaseStore(process.env.FAMILYMIND_PRIVATE_ROOT || DEFAULT_PRIVATE_ROOT);
const caseId = process.argv[2];
if (!caseId) throw new Error("Укажите ID дела: npm run case:audit -- <ID>");
const value = await store.load(caseId);
if (!value) throw new Error("Дело не найдено.");
const registers = buildEvidenceRegisters(value);
const folder = path.join(store.root, "evidence", value.id, String(value.revision));
await ensurePrivateDir(folder);
for (const [filename, contents] of Object.entries(registers.files)) {
  const target = path.join(folder, filename);
  const existing = await fs.readFile(target, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (existing !== null && existing !== contents) throw new Error("Сохранённый реестр отличается; перезапись отменена.");
  if (existing === null) await fs.writeFile(target, contents, { flag: "wx", mode: 0o600 });
}
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "ex-ussr-kinship-research", "scripts", "audit_evidence.py");
let output;
try { output = await promisify(execFile)("python3", [script, "--case-dir", folder, "--json"], { maxBuffer: 1024 * 1024, timeout: 15_000 }); }
catch (error) { if (error.stdout) output = { stdout: error.stdout }; else throw new Error("Аудитор не запустился; приватная диагностика не выводится."); }
const result = JSON.parse(output.stdout);
await fs.writeFile(path.join(folder, "audit.json"), JSON.stringify({ ...result, limitations: registers.limitations }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ counts: result.counts, errors: result.errors.length, warnings: result.warnings.length }));
console.log("Проверена структура реестров, не историческая истинность. Полный отчёт сохранён рядом с приватным делом.");
if (result.errors.length) process.exitCode = 1;
