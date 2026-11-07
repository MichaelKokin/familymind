import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const LOCAL_ORIGIN = "http://127.0.0.1:3000";

// A successful HTTP response alone does not identify this app. Never hand an
// access capability to an unrelated process that happens to occupy port 3000.
export async function inspectServer(checkout) {
  let output;
  try {
    output = (await run("/usr/sbin/lsof", ["-nP", "-iTCP:3000", "-sTCP:LISTEN", "-Fpnt"])).stdout;
  } catch (error) {
    if (error.code === 1 && !error.stdout) return null;
    throw new Error("Не удалось проверить процесс на порту 3000. Откройте приложение через Терминал.");
  }
  const groups = output.trim().split(/\n(?=p\d)/);
  if (groups.length !== 1 || !groups[0].split("\n").includes("n127.0.0.1:3000")) return { owned: false };
  const pid = Number(groups[0].split("\n")[0].slice(1));
  if (!Number.isSafeInteger(pid) || pid <= 0) return { owned: false };
  try {
    const [cwd, command] = await Promise.all([
      run("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
      run("/bin/ps", ["-p", String(pid), "-o", "command="]),
    ]);
    const owned = cwd.stdout.split("\n").includes(`n${await fs.realpath(checkout)}`)
      && /(?:^|\s)next-server(?:\s|$)|next\/dist\/bin\/next\s+(?:start|dev)(?:\s|$)/.test(command.stdout.trim());
    return { owned, pid };
  } catch { return { owned: false }; }
}

async function ready() {
  try {
    const response = await fetch(`${LOCAL_ORIGIN}/case`, { redirect: "error", signal: AbortSignal.timeout(2000) });
    const ok = response.ok;
    await response.body?.cancel();
    return ok;
  } catch { return false; }
}

async function start(checkout) {
  if (!await fs.stat(path.join(checkout, ".next", "BUILD_ID")).catch(() => null)) {
    throw new Error("Сначала подготовьте приложение из Терминала: npm run build. Затем повторите запуск.");
  }
  const runtime = path.join(checkout, ".local", "runtime");
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  const log = await fs.open(path.join(runtime, "server.log"), "a", 0o600);
  const child = spawn(process.execPath, [path.join(checkout, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", "3000"], {
    cwd: checkout, detached: true, stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", FAMILYMIND_ORIGIN: LOCAL_ORIGIN },
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", () => reject(new Error("Не удалось запустить локальный сервер."))); });
  child.unref();
  await log.close();
  await fs.writeFile(path.join(runtime, "server.json"), JSON.stringify({ pid: child.pid, url: LOCAL_ORIGIN, command: "next start --hostname 127.0.0.1 --port 3000" }) + "\n", { mode: 0o600 });
  return child.pid;
}

export async function ensureLocalServer(checkout, dependencies = {}) {
  const inspect = dependencies.inspect ?? (() => inspectServer(checkout));
  const isReady = dependencies.ready ?? ready;
  const startServer = dependencies.start ?? (() => start(checkout));
  const pause = dependencies.pause ?? (() => new Promise(resolve => setTimeout(resolve, 500)));
  const existing = await inspect();
  if (existing && !existing.owned) throw new Error("Порт 3000 занят другим приложением. Его работа не изменена. Освободите порт и повторите запуск.");
  const expectedPid = existing?.pid ?? await startServer();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await inspect();
    if (current && (!current.owned || current.pid !== expectedPid)) throw new Error("Процесс на порту 3000 изменился. Вход не выполнен; повторите запуск после проверки сервера.");
    if (current?.owned && await isReady()) return;
    await pause();
  }
  throw new Error("Локальный сервер не ответил. Повторите запуск; диагностика находится в .local/runtime/server.log. Другие процессы не остановлены.");
}
