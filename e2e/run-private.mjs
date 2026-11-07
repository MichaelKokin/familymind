import { spawn } from "node:child_process";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(path.join(tmpdir(), "family-mind-private-e2e-"));
const binary = path.join(checkout, "e2e", "fixtures", "codex-fixture.mjs");
await writeFile(path.join(root, ".synthetic-e2e-owned"), "family-mind-synthetic-e2e\n", { mode: 0o600 });
await chmod(binary, 0o700);
let exitCode = 1;
try {
  const child = spawn(process.execPath, [path.join(checkout, "node_modules", "@playwright", "test", "cli.js"), "test", "--config", "playwright.private.config.ts", ...process.argv.slice(2)], {
    cwd: checkout,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      FAMILYMIND_PRIVATE_E2E_ROOT: root,
      FAMILYMIND_PRIVATE_ROOT: root,
      FAMILYMIND_ORIGIN: "http://127.0.0.1:3001",
      FAMILYMIND_CODEX_BINARY: binary,
    },
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
} finally {
  // This exact path was created by this invocation and contains only synthetic test data.
  await rm(root, { recursive: true, force: true });
}
process.exitCode = exitCode;
