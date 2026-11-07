import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ensureLocalServer, LOCAL_ORIGIN } from "./local-server.mjs";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  if (process.platform !== "darwin") throw new Error("Этот запуск предназначен для macOS. Запустите npm start, затем npm run case:open.");
  if (process.env.FAMILYMIND_ORIGIN && process.env.FAMILYMIND_ORIGIN !== LOCAL_ORIGIN) throw new Error("Этот запуск использует 127.0.0.1:3000. Для другого порта используйте npm run case:open с настроенным сервером.");
  console.log("Открываем Family Mind на этом компьютере…");
  await ensureLocalServer(checkout);
  const child = spawn(process.execPath, [path.join(checkout, "scripts", "open-private-case.mjs"), ...process.argv.slice(2), "--explore"], { cwd: checkout, stdio: "inherit" });
  process.exitCode = await new Promise(resolve => { child.once("error", () => resolve(1)); child.once("exit", code => resolve(code ?? 1)); });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Не удалось открыть Family Mind.");
  process.exitCode = 1;
}
