import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privateClasses } from "./private-runtime.mjs";
const { PrivateCaseStore, LocalCaseAccess, DEFAULT_PRIVATE_ROOT } = await privateClasses();
const root = process.env.FAMILYMIND_PRIVATE_ROOT || DEFAULT_PRIVATE_ROOT;
const origin = process.env.FAMILYMIND_ORIGIN || "http://127.0.0.1:3000";
const candidates = (await fs.readdir(path.join(root, "cases")).catch(() => [])).filter(x => /^[a-zA-Z0-9_-]+\.json$/.test(x));
const arguments_ = process.argv.slice(2);
const caseId = arguments_.find(value => !value.startsWith("--")) || (candidates.length === 1 ? candidates[0].slice(0, -5) : null);
if (!caseId) throw new Error("Укажите ID локального дела: npm run case:open -- <ID>. Дела создаются владельцем вне checkout.");
if (!await new PrivateCaseStore(root).load(caseId)) throw new Error("Дело не найдено.");
const response = await fetch(`${origin}/case`, { redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => null);
if (!response?.ok) throw new Error("Сначала запустите приложение: npm run dev (127.0.0.1:3000).");
const { token } = await new LocalCaseAccess(root, origin).createBootstrap(caseId);
// Fragment is never sent to HTTP logs. The page removes it before exchanging once.
try {
  await promisify(execFile)(process.platform === "darwin" ? "open" : "xdg-open", [`${origin}/case#token=${token}${arguments_.includes("--explore") ? "&view=explore" : ""}`]);
} catch {
  // execFile errors can contain the command's arguments, including the secret.
  throw new Error("Не удалось открыть браузер. Повторите npm run case:open; одноразовый ключ не выведен.");
}
console.log("Локальное дело открыто. Одноразовый ключ не записан в консоль; сессия действует 8 часов.");
