import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirmBehavior, init, mapProject, newDoc, setTask, verifySpec } from "../src/ops.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));

function specWith() {
  const vault = tmp();
  const repo = tmp();
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  fs.mkdirSync(path.join(repo, "test"));
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace(/## Behaviors\n\n<!--[\s\S]*?-->/, "## Behaviors\n\n- [ ] B1: one.\n- [ ] B2: two.\n- [ ] B3: three."));
  const write = (name, text) => fs.writeFileSync(path.join(repo, "test", name), text);
  return { vault, repo, id: s.id, write };
}

test("verify refuses a missing test file", () => {
  const { vault, repo, id, write } = specWith();
  write("a.test.mjs", 'test("alpha", () => {});');
  write("b.test.mjs", 'test("beta", () => {});');
  setTask(vault, id, "B1", "done", "test/a.test.mjs::alpha");
  setTask(vault, id, "B3", "done", "test/b.test.mjs::beta");
  fs.rmSync(path.join(repo, "test", "b.test.mjs"));
  assert.throws(() => verifySpec(vault, id), (e) => /B3/.test(e.message) && /test\/b\.test\.mjs/.test(e.message) && /does not exist/.test(e.message));
});

test("verify warns when the test name is not in the file", () => {
  const { vault, id, write } = specWith();
  write("a.test.mjs", 'test("alpha", () => {});');
  setTask(vault, id, "B1", "done", "test/a.test.mjs::alpha");
  setTask(vault, id, "B2", "done", "test/a.test.mjs::renamed away");
  const r = verifySpec(vault, id);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /B2/);
  assert.match(r.warnings[0], /renamed away/);
});

test("verify is quiet when links are sound and skips unfinished and manual behaviors", () => {
  const { vault, repo, id, write } = specWith();
  write("a.test.mjs", 'test("alpha", () => {});');
  setTask(vault, id, "B1", "done", "test/a.test.mjs::alpha");
  confirmBehavior(vault, id, "B2"); // checked by hand: no test to look for
  // Unfinished: never checked, even when its old link points at a file that is gone.
  write("gone.test.mjs", 'test("gone", () => {});');
  setTask(vault, id, "B3", "done", "test/gone.test.mjs::gone");
  setTask(vault, id, "B3", "todo", undefined, { reopen: true });
  fs.rmSync(path.join(repo, "test", "gone.test.mjs"));
  assert.deepEqual(verifySpec(vault, id).warnings, []);
});
