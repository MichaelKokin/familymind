import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checkout = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.FAMILYMIND_PRIVATE_E2E_ROOT;
if (!root || !path.resolve(root).startsWith(path.join(tmpdir(), "family-mind-private-e2e-")) || readFileSync(path.join(root, ".synthetic-e2e-owned"), "utf8") !== "family-mind-synthetic-e2e\n") {
  throw new Error("Run private tests through node e2e/run-private.mjs; the live private root is never a test target.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["private-case.spec.ts", "member-notes.spec.ts", "family-chat.spec.ts"],
  outputDir: ".local/private-test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
    trace: "off",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001",
    url: "http://127.0.0.1:3001/case",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      FAMILYMIND_PRIVATE_E2E_ROOT: root,
      FAMILYMIND_PRIVATE_ROOT: root,
      FAMILYMIND_ORIGIN: "http://127.0.0.1:3001",
      FAMILYMIND_CODEX_BINARY: path.join(checkout, "e2e", "fixtures", "codex-fixture.mjs"),
    },
  },
});
