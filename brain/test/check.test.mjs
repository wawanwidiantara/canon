import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { filterClones, formatResults, ownScripts, planChecks, runChecks } from "../src/check.mjs";

function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "brainc-"));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), typeof c === "string" ? c : JSON.stringify(c));
  }
  return d;
}
const ids = (p) => p.map((x) => x.id);

test("repo's own quality scripts are found, with the right runner", () => {
  const d = repo({ "package.json": { scripts: { lint: "eslint .", build: "vite build", typecheck: "tsc" } }, "pnpm-lock.yaml": "" });
  const own = ownScripts(d);
  assert.deepEqual(own.map((o) => o.id), ["npm:lint", "npm:typecheck"]);
  assert.deepEqual(own[0].args, ["pnpm", "run", "lint"]);
  const c = repo({ "composer.json": { scripts: { analyse: "phpstan analyse", test: "pest" } } });
  assert.deepEqual(ownScripts(c)[0].args, ["composer", "run", "--no-interaction", "analyse"]);
});

test("a tool the repo's own script already runs is not run twice", () => {
  const d = repo({ "package.json": { scripts: { lint: "eslint ." }, devDependencies: { eslint: "9", typescript: "5" } }, "tsconfig.json": "{}", "src/a.ts": "x" });
  assert.deepEqual(ids(planChecks(d, ["src/a.ts"])), ["npm:lint", "tsc"]);
});

test("laravel + vue repo: php tools get php files, js tools get js files", () => {
  const d = repo({
    "composer.json": { "require-dev": { "larastan/larastan": "3", "laravel/pint": "1" } },
    "package.json": { devDependencies: { eslint: "9" } },
    "app/A.php": "<?php", "resources/js/a.vue": "x",
  });
  const p = planChecks(d, ["app/A.php", "resources/js/a.vue"]);
  assert.deepEqual(ids(p), ["phpstan", "pint", "eslint"]);
  assert.ok(p[0].args.includes("app/A.php") && !p[0].args.includes("resources/js/a.vue"));
  assert.ok(p[2].args.includes("resources/js/a.vue"));
});

test("no matching changed files means no plan; deleted files are skipped", () => {
  const d = repo({ "composer.json": { "require-dev": { "laravel/pint": "1" } } });
  assert.deepEqual(planChecks(d, ["README.md"]), []);
  assert.deepEqual(planChecks(d, ["app/Gone.php"]), []);
});

test("fast mode drops slow and project-wide dead-code tools", () => {
  const d = repo({ "package.json": { devDependencies: { knip: "5", jscpd: "4", eslint: "9" } }, "src/a.ts": "x" });
  assert.deepEqual(ids(planChecks(d, ["src/a.ts"], { fast: true })), ["eslint"]);
  assert.deepEqual(ids(planChecks(d, ["src/a.ts"])), ["eslint", "knip", "jscpd"]);
});

test("other languages: dart, go, rust", () => {
  assert.deepEqual(planChecks(repo({ "pubspec.yaml": "dependencies:\n  flutter:\n    sdk: flutter\n" }), ["lib/a.dart"])[0].args, ["flutter", "analyze"]);
  assert.deepEqual(planChecks(repo({ "pubspec.yaml": "name: x\n" }), ["lib/a.dart"])[0].args, ["dart", "analyze"]);
  assert.deepEqual(planChecks(repo({ "go.mod": "m" }), ["a.go"])[0].args, ["go", "vet", "./..."]);
  assert.equal(planChecks(repo({ "Cargo.toml": "x" }), ["src/a.rs"])[0].id, "clippy");
});

test("override adds commands for any stack and can disable tools", () => {
  const d = repo({ "package.json": { devDependencies: { eslint: "9" } } });
  const o = { disable: ["eslint"], commands: [{ name: "credo", cmd: "mix", args: ["credo", "{files}"] }] };
  const p = planChecks(d, ["lib/a.ex", "src/a.ts"], { override: o });
  assert.deepEqual(ids(p), ["credo"]);
  assert.deepEqual(p[0].args, ["mix", "credo", "lib/a.ex", "src/a.ts"]);
});

test("jscpd output is cut to clones touching changed files", () => {
  const out = "Clone found (php):\n - app/A.php [1:1 - 9:1] (8 lines)\n   app/B.php [3:1 - 11:1]\nClone found (js):\n - src/x.js [1:1 - 9:1]\n   src/y.js [1:1 - 9:1]\nFound 2 clones.";
  const f = filterClones(out, ["app/A.php"]);
  assert.match(f, /app\/B\.php/);
  assert.doesNotMatch(f, /src\/x\.js/);
  assert.equal(filterClones(out, ["none.php"]), "");
});

test("jscpd real output (ANSI colours, summary table) is parsed", () => {
  const real = "\x1b[1mClone found (javascript)\x1b[22m\n - \x1b[1m\x1b[32msrc/a.js\x1b[39m\x1b[22m [1:1 - 12:91] (12 lines, 432 tokens)\n   src/b.js [1:1 - 12:91]\n\x1b[90m┌────────┬────┐\x1b[39m\n\x1b[90m│\x1b[39m Format \x1b[90m│\x1b[39m\n\x1b[90mFound 1 clones.\x1b[39m\n";
  const f = filterClones(real, ["src/b.js"]);
  assert.equal(f, "Clone found (javascript)\n - src/a.js [1:1 - 12:91] (12 lines, 432 tokens)\n   src/b.js [1:1 - 12:91]");
  assert.equal(filterClones(real, ["src/c.js"]), "");
});

test("runChecks: pass is one line, failure is capped tail", () => {
  const d = repo({});
  const lines = Array.from({ length: 50 }, (_, i) => `err ${i}`).join("\\n");
  const results = runChecks(d, [
    { id: "good", args: ["node", "-e", "process.exit(0)"], verified: true },
    { id: "bad", args: ["node", "-e", `console.log("${lines}");process.exit(1)`], verified: false },
    { id: "missing", args: ["definitely-not-a-tool"], verified: true },
  ], { maxLines: 5 });
  const text = formatResults(results);
  assert.match(text, /^ok   good/);
  assert.match(text, /FAIL bad \(flags unverified\)\n… 45 earlier line\(s\) omitted\nerr 45/);
  assert.match(text, /could not run definitely-not-a-tool/);
});
