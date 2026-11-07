import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addAnchors, approve, complete, enforce, findStale, init, mapProject, newDoc, setTask, supersede, verifySpec } from "../src/ops.mjs";
import { validate } from "../src/validate.mjs";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tests"));
  fs.writeFileSync(path.join(repo, "src/a.php"), "v1");
  fs.writeFileSync(path.join(repo, "tests/ATest.php"), "t");
  init(vault);
  mapProject(vault, "demo", repo);
  return { vault, repo };
}
const fill = (file, edits) => {
  let t = fs.readFileSync(file, "utf8");
  for (const [h, body] of Object.entries(edits)) t = t.replace(new RegExp(`## ${h}\\n\\n<!--.*?-->`, "s"), `## ${h}\n\n${body}`);
  fs.writeFileSync(file, t);
};
const SPEC = { Goal: "g", Behaviors: "- [ ] B1: first\n- [ ] B2: second", "Implementation Decisions": "d", "Testing Decisions": "t", "Non-goals": "n" };
const status = (f) => /status: (\S+)/.exec(fs.readFileSync(f, "utf8"))[1];

test("approve: incomplete draft stays draft with reasons; complete draft becomes active", () => {
  const { vault } = setup();
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  assert.throws(() => approve(vault, s.id), /not ready[\s\S]*is empty/);
  assert.equal(status(s.file), "draft");
  fill(s.file, SPEC);
  approve(vault, s.id);
  assert.equal(status(s.file), "active");
  assert.throws(() => approve(vault, s.id), /only drafts/);
});

test("complete spec: blocked by open behaviors, then by stale code, then ok", () => {
  const { vault, repo } = setup();
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  fill(s.file, SPEC);
  approve(vault, s.id);
  addAnchors(vault, s.id, ["src/a.php"]);
  assert.throws(() => complete(vault, s.id), /B1 is todo[\s\S]*B2 is todo/);
  setTask(vault, s.id, "B1", "done", "tests/ATest.php::a");
  setTask(vault, s.id, "B2", "done", "tests/ATest.php::b");
  fs.writeFileSync(path.join(repo, "src/a.php"), "v2");
  assert.throws(() => complete(vault, s.id), /is stale/);
  verifySpec(vault, s.id);
  complete(vault, s.id);
  assert.equal(status(s.file), "completed");
  assert.deepEqual(validate(vault), []);
});
test("complete phase: needs every referenced behavior done", () => {
  const { vault } = setup();
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  fill(s.file, SPEC);
  approve(vault, s.id);
  const p = newDoc(vault, { type: "phase", project: "demo", slug: "p1", depends: [s.id] });
  fill(p.file, { Objective: "o", Behaviors: `- [[${s.id}#B1]]\n- [[${s.id}#B2]]`, Dependencies: "none" });
  approve(vault, p.id);
  setTask(vault, s.id, "B1", "done", "tests/ATest.php::a");
  assert.throws(() => complete(vault, p.id), new RegExp(`${s.id} B2 is todo`));
  setTask(vault, s.id, "B2", "done", "tests/ATest.php::b");
  complete(vault, p.id);
  assert.equal(status(p.file), "completed");
});

test("complete phase with no behaviors is rejected; draft cannot be completed", () => {
  const { vault } = setup();
  const p = newDoc(vault, { type: "phase", project: "demo", slug: "p1" });
  assert.throws(() => complete(vault, p.id), /only active docs/);
  fill(p.file, { Objective: "o", Behaviors: "tbd", Dependencies: "none" });
  fs.writeFileSync(p.file, fs.readFileSync(p.file, "utf8").replace("status: draft", "status: active"));
  assert.throws(() => complete(vault, p.id), /lists no behaviors/);
});

test("supersede links old to new, rejects bad pairs", () => {
  const { vault } = setup();
  const a = newDoc(vault, { type: "adr", project: "demo", slug: "one" });
  const b = newDoc(vault, { type: "adr", project: "demo", slug: "two" });
  assert.throws(() => supersede(vault, a.id, a.id), /itself/);
  supersede(vault, a.id, b.id);
  assert.equal(status(a.file), "superseded");
  assert.match(fs.readFileSync(a.file, "utf8"), new RegExp(`superseded_by: ${b.id}`));
  assert.throws(() => supersede(vault, a.id, b.id), /already superseded/);
  assert.throws(() => supersede(vault, b.id, a.id), /itself superseded/);
  assert.deepEqual(validate(vault), []);
});

test("enforce a lesson only when Prevention is filled", () => {
  const { vault } = setup();
  const l = newDoc(vault, { type: "lesson", project: "demo", slug: "forgot-tests" });
  assert.throws(() => enforce(vault, l.id), /Prevention/);
  fill(l.file, { Prevention: "pre-commit hook runs the suite" });
  enforce(vault, l.id);
  assert.match(fs.readFileSync(l.file, "utf8"), /enforced: true/);
  assert.throws(() => enforce(vault, "demo-spec-001-nope"), /no doc/);
});

test("an adr can be anchored, goes stale when its code changes, and verify clears it", () => {
  const { vault, repo } = setup();
  const a = newDoc(vault, { type: "adr", project: "demo", slug: "pick-queue", title: "Pick a queue" });
  fill(a.file, { Context: "c", Decision: "We will use the database queue.", Consequences: "q" });
  approve(vault, a.id);
  addAnchors(vault, a.id, ["src/a.php"]);
  assert.match(fs.readFileSync(a.file, "utf8"), /anchors: \["src\/a\.php@[0-9a-f]{12}"\]/);
  assert.deepEqual(validate(vault), []);
  assert.deepEqual(findStale(vault), []);
  fs.writeFileSync(path.join(repo, "src/a.php"), "v2");
  assert.equal(findStale(vault)[0].id, a.id);
  verifySpec(vault, a.id);
  assert.deepEqual(findStale(vault), []);
  const rule = newDoc(vault, { type: "lesson", project: "demo", slug: "l" });
  assert.throws(() => addAnchors(vault, rule.id, ["src/a.php"]), /only spec, adr, data-model/);
});
