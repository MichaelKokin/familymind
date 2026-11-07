// Local operator tooling compiles only these trusted, fixed project modules.
// No uploaded content is executable and no private data is written to the checkout.
import ts from "typescript";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function privateClasses() {
  const output = path.join(checkout, ".local", "runtime", "private-lib");
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(output, "package.json"), '{"type":"commonjs"}\n', { mode: 0o600 });
  for (const name of ["model", "server-store", "access", "evidence-adapter"]) {
    const input = await fs.readFile(path.join(checkout, "src", "private-case", `${name}.ts`), "utf8");
    const result = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    await fs.writeFile(path.join(output, `${name}.js`), result.outputText, { mode: 0o600 });
  }
  const require = createRequire(import.meta.url);
  return { ...require(path.join(output, "server-store.js")), ...require(path.join(output, "access.js")), ...require(path.join(output, "evidence-adapter.js")) };
}
