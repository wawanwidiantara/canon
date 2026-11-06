import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changedFiles, commandFor, detectStack, filterSurvivors, phpClass } from "../src/mutation.mjs";

function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "brainm-"));
  const git = (...a) => execFileSync("git", ["-C", d, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(d, "seed"), "x");
  git("add", "-A");
  git("commit", "-qm", "seed");
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

test("detectStack", () => {
  assert.equal(detectStack(repo({ "composer.json": '{"require-dev":{"pestphp/pest":"^3"}}' })), "pest");
  assert.equal(detectStack(repo({ "composer.json": "{}", "infection.json5": "{}" })), "infection");
  assert.equal(detectStack(repo({ "package.json": '{"devDependencies":{"@stryker-mutator/core":"1"}}' })), "stryker");
  assert.equal(detectStack(repo({ "go.mod": "module x" })), "go");
  assert.equal(detectStack(repo({})), null);
});

test("changedFiles includes untracked and modified, not unchanged", () => {
  const d = repo({ "app/A.php": "a", "tests/ATest.php": "t" });
  assert.deepEqual(changedFiles(d).sort(), ["app/A.php", "tests/ATest.php"]);
});

test("pest command targets changed app classes only", () => {
  assert.equal(phpClass("app/Http/Controllers/LoginController.php"), "App\\Http\\Controllers\\LoginController");
  const plan = commandFor("pest", ["app/Models/User.php", "tests/Feature/UserTest.php", "resources/js/a.vue"]);
  assert.ok(plan.args.includes("--class=App\\Models\\User"));
  assert.equal(commandFor("pest", ["tests/Feature/UserTest.php"]), null);
});

test("infection uses git-diff-lines; stryker/go skip tests", () => {
  assert.ok(commandFor("infection", ["app/A.php"], { base: "develop" }).args.includes("--git-diff-base=develop"));
  assert.equal(commandFor("stryker", ["src/a.test.ts"]), null);
  assert.ok(commandFor("stryker", ["src/a.ts", "src/a.test.ts"]).args.includes("src/a.ts"));
  assert.deepEqual(commandFor("go", ["pkg/x/a.go", "pkg/x/a_test.go"]).args, ["./pkg/x/..."]);
});

test("filterSurvivors keeps survivors and score, drops the rest, caps output", () => {
  const out = [
    "  PASS  Tests\\Feature\\LoginTest",
    "  UNTESTED  app/Http/TodoController.php  > Line 44: ReturnValue - ID: 76d17ad63bb7c307",
    "  - return $x;",
    "  + return null;",
    "  Mutations: 1 untested, 9 tested",
    "  Score:  90.00%",
  ].join("\n");
  const f = filterSurvivors(out);
  assert.match(f, /UNTESTED .*Line 44/);
  assert.match(f, /Score:/);
  assert.doesNotMatch(f, /return null/);
  const many = Array.from({ length: 60 }, (_, i) => `UNTESTED a.php > Line ${i}`).join("\n");
  assert.match(filterSurvivors(many, 10), /\.\.\. 50 more/);
});
