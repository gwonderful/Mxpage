const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Keep the existing TypeScript assertion scripts and Node test suites isolated.
// Transpilation only affects the child process; no test build files are written.
const bootstrap = `
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, file);
require(process.argv[1]);
`;

const root = path.resolve(__dirname, "..");
const files = fs.readdirSync(path.join(root, "tests")).filter((file) => /\.test\.(ts|cjs)$/.test(file)).sort();
let failures = 0;
for (const file of files) {
  const target = path.join(root, "tests", file);
  const args = file.endsWith(".ts") ? ["-e", bootstrap, target] : ["--test", target];
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) failures++;
  console.log(`${result.status === 0 ? "PASS" : "FAIL"}: ${file}`);
}
console.log(`Test files: ${files.length}, passed: ${files.length - failures}, failed: ${failures}`);
process.exitCode = failures ? 1 : 0;
