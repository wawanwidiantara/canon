import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ratificationPrompt } from "../src/gate.mjs";
import { sessionBrief } from "../src/context.mjs";
import { parseBehaviors } from "../src/markdown.mjs";
import { completionProblems, confirmBehavior, init, mapProject, newDoc, setTask } from "../src/ops.mjs";
import { validate } from "../src/validate.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
const TODAY = new Date().toISOString().slice(0, 10);

function specWith(behaviors = "- [ ] B1: the screen shows the total.\n- [ ] B2: the other thing.") {
  const vault = tmp();
  const repo = tmp();
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  fs.mkdirSync(path.join(repo, "test"));
  fs.writeFileSync(path.join(repo, "test", "a.test.mjs"), "");
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace(/## Behaviors\n\n<!--[\s\S]*?-->/, `## Behaviors\n\n${behaviors}`));
  return { vault, id: s.id, file: s.file };
}
const read = (file) => fs.readFileSync(file, "utf8");
const item = (file, bid) => parseBehaviors(read(file)).items.find((i) => i.id === bid);

test("confirm marks a behavior done by hand with the date", () => {
  const { vault, id, file } = specWith();
  confirmBehavior(vault, id, "B1");
  assert.equal(item(file, "B1").state, "done");
  assert.equal(item(file, "B1").manual, TODAY);
  assert.equal(item(file, "B1").test, null);
  assert.match(read(file), new RegExp(`- \\[x\\] B1: the screen shows the total\\. \\(manual: ${TODAY}\\)`));
  assert.throws(() => confirmBehavior(vault, id, "B9"), /not found/);
  setTask(vault, id, "B2", "done", "test/a.test.mjs::t");
  assert.throws(() => confirmBehavior(vault, id, "B2"), /already links a test/);
});

test("the validator accepts a manual confirmation and rejects a bare done", () => {
  const { vault, id, file } = specWith();
  confirmBehavior(vault, id, "B1");
  const bare = () => validate(vault).filter((f) => f.includes("done but has no"));
  assert.deepEqual(bare(), []);
  fs.writeFileSync(file, read(file).replace("- [ ] B2: the other thing.", "- [x] B2: the other thing."));
  assert.equal(bare().length, 1);
  assert.match(bare()[0], /B2/);
});

test("a manual confirmation completes a spec and the brief counts it", () => {
  const { vault, id } = specWith();
  confirmBehavior(vault, id, "B1");
  assert.match(sessionBrief(vault, "demo"), /1\/2 done \(1 by hand\)/);
  assert.match(sessionBrief(vault, "demo"), /B2 \[todo\]/);
  assert.ok(!completionProblems(vault, id).some((p) => p.includes("B1")));
  setTask(vault, id, "B2", "done", "test/a.test.mjs::t");
  assert.match(sessionBrief(vault, "demo"), /2\/2 done \(1 by hand\)/);
});

test("the hook always asks before confirm", () => {
  const auto = { ratify: "auto" };
  assert.ok(ratificationPrompt(auto, "demo", "canon confirm demo-spec-001-x B1"));
  assert.ok(ratificationPrompt(auto, "demo", "npm test && canon confirm demo-spec-001-x B1"));
  assert.ok(ratificationPrompt({ ratify: { types: { spec: "auto" }, default: "auto" } }, "demo", "canon confirm s B1"));
  assert.equal(ratificationPrompt(auto, "demo", "canon task demo-spec-001-x B1 done --test t::n"), null);
  assert.equal(ratificationPrompt(auto, "demo", "canon approve demo-spec-001-x"), null);
  assert.equal(ratificationPrompt(auto, null, "canon confirm s B1"), null);
});

test("reopening removes the confirmation and a test link replaces it", () => {
  const { vault, id, file } = specWith();
  confirmBehavior(vault, id, "B1");
  assert.throws(() => setTask(vault, id, "B1", "todo"), /reopen/);
  setTask(vault, id, "B1", "todo", undefined, { reopen: true });
  assert.equal(item(file, "B1").manual, null);
  assert.equal(item(file, "B1").state, "todo");
  confirmBehavior(vault, id, "B1");
  setTask(vault, id, "B1", "done", "test/a.test.mjs::t");
  assert.equal(item(file, "B1").manual, null);
  assert.equal(item(file, "B1").test, "test/a.test.mjs::t");
});
