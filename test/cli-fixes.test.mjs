import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quicksilverDenial } from "../src/gate.mjs";
import { suggestGate } from "../src/gates.mjs";
import { init, mapProject, newDoc, setTask } from "../src/ops.mjs";
import { parseBehaviors } from "../src/markdown.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));

test("the wrapper is allowed anywhere in a command and direct calls stay blocked", () => {
  const config = { projects: { p: { quicksilver: true } } };
  const denied = (cmd) => quicksilverDenial(config, "p", cmd) !== null;
  for (const ok of [
    'canon qs filter "x" src',
    'echo "canon qs filter x"',
    "echo 'canon qs rank y'",
    "sed -i s/a/canon qs rank/ f",
    'bash -c "canon qs filter x"',
    'git commit -m "docs: canon qs filter"',
    'ls && canon qs find "x" src',
  ]) assert.equal(denied(ok), false, `should allow: ${ok}`);
  for (const bad of [
    'qs filter "x" src',
    "node /x/scripts/qs.mjs filter \"x\" src",
    'bash -c "qs filter x"',
    "canon qs filter x && qs rank y",
    'echo "canon qs filter x"; qs ask "y"',
  ]) assert.equal(denied(bad), true, `should block: ${bad}`);
});

function specWith() {
  const vault = tmp();
  const repo = tmp();
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  fs.mkdirSync(path.join(repo, "test"));
  fs.writeFileSync(path.join(repo, "test", "a.test.mjs"), "");
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace(/## Behaviors\n\n<!--[\s\S]*?-->/, "## Behaviors\n\n- [ ] B1: one thing."));
  return { vault, id: s.id, file: s.file };
}
const stateOf = (file) => parseBehaviors(fs.readFileSync(file, "utf8")).items.find((i) => i.id === "B1").state;

test("a done behavior is not reset without the reopen option", () => {
  const { vault, id, file } = specWith();
  setTask(vault, id, "B1", "done", "test/a.test.mjs::t");
  assert.equal(stateOf(file), "done");
  assert.throws(() => setTask(vault, id, "B1", "todo"), /reopen/);
  assert.throws(() => setTask(vault, id, "B1", "doing"), /reopen/);
  assert.equal(stateOf(file), "done");
  setTask(vault, id, "B1", "todo", undefined, { reopen: true });
  assert.equal(stateOf(file), "todo");
  setTask(vault, id, "B1", "doing"); // not done now, so no option needed
  assert.equal(stateOf(file), "doing");
});

test("the proposed gate leaves out scripts that rewrite files", () => {
  const repo = tmp();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: {
    lint: "eslint .", "lint:fix": "pint", "lint:write": "prettier --write .", "lint:php": "pint --test",
    check: "eslint --fix src", typecheck: "tsc --noEmit", "format:check": "prettier --check .",
  } }));
  const names = suggestGate(repo).fast.map((s) => s.args.at(-1));
  assert.deepEqual(names.sort(), ["format:check", "lint", "lint:php", "typecheck"]);
});

test("the version option prints the package version", () => {
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  for (const flag of ["--version", "-v"]) {
    const r = spawnSync("node", [path.join(ROOT, "bin/canon.mjs"), flag], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), want);
  }
});
