import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changedFiles, detectTools, filterSurvivors, isTest, phpClass, plansFor } from "../src/mutation.mjs";

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
const ids = (d) => detectTools(d).map((t) => t.id);
const plan = (d, files, o) => plansFor(d, files, o);

test("detection covers each built-in stack", () => {
  assert.deepEqual(ids(repo({ "composer.json": '{"require-dev":{"pestphp/pest":"^3","infection/infection":"1"}}' })), ["pest"]);
  assert.deepEqual(ids(repo({ "composer.json": '{"require-dev":{"infection/infection":"1"}}' })), ["infection"]);
  assert.deepEqual(ids(repo({ "package.json": '{"devDependencies":{"@stryker-mutator/core":"1"}}' })), ["stryker-js"]);
  assert.deepEqual(ids(repo({ "pubspec.yaml": "name: x" })), ["dart"]);
  assert.deepEqual(ids(repo({ "Cargo.toml": "[package]" })), ["cargo-mutants"]);
  assert.deepEqual(ids(repo({ "pyproject.toml": "[tool.mutmut]" })), ["mutmut"]);
  assert.deepEqual(ids(repo({ "pom.xml": "<plugin>pitest</plugin>" })), ["pit"]);
  assert.deepEqual(ids(repo({ "go.mod": "module x" })), ["go-mutesting"]);
  assert.deepEqual(ids(repo({})), []);
});

test("monorepo: laravel backend plus vue frontend yields both tools", () => {
  const d = repo({ "composer.json": '{"require-dev":{"pestphp/pest":"3"}}', "package.json": '{"devDependencies":{"@stryker-mutator/core":"1"}}' });
  const p = plan(d, ["app/Models/User.php", "resources/js/a.vue", "tests/Feature/UserTest.php"]);
  assert.deepEqual(p.map((x) => x.id), ["pest", "stryker-js"]);
  assert.ok(p[0].args.includes("--class=App\\Models\\User"));
  assert.ok(p[1].args.includes("resources/js/a.vue"));
});

test("test files are never mutated, across stacks", () => {
  for (const f of ["tests/Feature/A.php", "src/a.test.ts", "src/a.spec.tsx", "lib/a_test.dart", "test/a_test.dart", "pkg/a_test.go", "tests/test_a.py", "src/test/java/ATest.java", "App.Tests/A.cs", "tests/x.rs"]) {
    assert.equal(isTest(f), true, f);
  }
  for (const f of ["app/A.php", "src/a.ts", "lib/a.dart", "pkg/a.go", "src/main/java/A.java"]) assert.equal(isTest(f), false, f);
  assert.deepEqual(plan(repo({ "go.mod": "m" }), ["pkg/a_test.go"]), []);
});

test("per-stack commands", () => {
  assert.equal(phpClass("app/Http/Controllers/LoginController.php"), "App\\Http\\Controllers\\LoginController");
  assert.deepEqual(plan(repo({ "go.mod": "m" }), ["pkg/x/a.go", "pkg/x/a_test.go"])[0].args, ["go-mutesting", "./pkg/x/..."]);
  assert.deepEqual(plan(repo({ "pubspec.yaml": "n" }), ["lib/a.dart", "test/a_test.dart", "tool/b.dart"])[0].args, ["dart_mutant", "run", "lib/a.dart"]);
  assert.ok(plan(repo({ "composer.json": '{"require-dev":{"infection/infection":"1"}}' }), ["app/A.php"], { base: "develop" })[0].args.includes("--git-diff-base=develop"));
  const pit = plan(repo({ "pom.xml": "pitest" }), ["src/main/java/com/a/B.java"])[0];
  assert.ok(pit.args.includes("-DtargetClasses=com.a.B"));
  const rust = plan(repo({ "Cargo.toml": "x" }), ["src/lib.rs"])[0];
  assert.deepEqual(rust.args.slice(0, 3), ["cargo", "mutants", "--in-diff"]);
  assert.ok(fs.existsSync(rust.args[3]));
  assert.deepEqual(plan(repo({ "pyproject.toml": "mutmut" }), ["pkg/a.py"])[0].after, ["mutmut", "results"]);
});

test("override handles any stack via {files}", () => {
  const d = repo({});
  const o = { cmd: "mytool", args: ["run", "--only", "{files,}", "{files}"], notes: ["n"] };
  const p = plan(d, ["src/a.ex", "src/b.ex", "test/a_test.exs"], { override: o });
  assert.deepEqual(p[0].args, ["mytool", "run", "--only", "src/a.ex,src/b.ex", "src/a.ex", "src/b.ex"]);
  assert.deepEqual(plan(d, ["test/a_test.exs"], { override: o }), []);
});

test("changedFiles includes untracked, not unchanged", () => {
  assert.deepEqual(changedFiles(repo({ "app/A.php": "a", "tests/ATest.php": "t" })).sort(), ["app/A.php", "tests/ATest.php"]);
});

test("filterSurvivors keeps survivors and score, drops the rest, caps output", () => {
  const out = [
    "  PASS  Tests\\Feature\\LoginTest",
    "  UNTESTED  app/Http/TodoController.php  > Line 44: ReturnValue - ID: 76d17ad63bb7c307",
    "  - return $x;",
    "  + return null;",
    "  Mutations: 1 untested, 9 tested",
    "  Score:  90.00%",
    "[Survived] ConditionalExpression src/a.ts:4:1",
    "MISSED  lib/a.dart:3",
  ].join("\n");
  const f = filterSurvivors(out);
  assert.match(f, /UNTESTED .*Line 44/);
  assert.match(f, /Survived/);
  assert.match(f, /MISSED/);
  assert.match(f, /Score:/);
  assert.doesNotMatch(f, /return null/);
  const many = Array.from({ length: 60 }, (_, i) => `UNTESTED a.php > Line ${i}`).join("\n");
  assert.match(filterSurvivors(many, 10), /\.\.\. 50 more/);
});
