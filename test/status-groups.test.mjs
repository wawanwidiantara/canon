import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openWork } from "../src/context.mjs";
import { approve, complete, init, mapProject, newDoc } from "../src/ops.mjs";
import { readiness } from "../src/packets.mjs";
import { COMPLETABLE, DELIVERED, NOT_YET_CANON, STATUS, UNFINISHED } from "../src/schema.mjs";
import { validate } from "../src/validate.mjs";

function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-st-")));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/a.txt"), "1");
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "a@b");
  g("config", "user.name", "a");
  g("add", ".");
  g("commit", "-qm", "init");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  return { vault };
}

const setStatus = (file, status) => {
  let t = fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${status}`);
  if (status === "superseded") t = t.replace(/^status: superseded$/m, "status: superseded\nsuperseded_by: demo-other");
  fs.writeFileSync(file, t);
};
const fillSummary = (file) => fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/## Summary\n\n<!--.*?-->/s, "## Summary\n\nx"));
const withBehavior = (file) => fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: x"));

test("the status groups are defined once and are all real statuses", () => {
  assert.deepEqual(UNFINISHED, ["draft", "active", "needs-review"]);
  assert.deepEqual(COMPLETABLE, ["active", "needs-review"]);
  assert.deepEqual(DELIVERED, ["active", "completed"]);
  assert.deepEqual(NOT_YET_CANON, ["draft", "superseded"]);
  for (const s of [...UNFINISHED, ...COMPLETABLE, ...DELIVERED, ...NOT_YET_CANON]) assert.ok(STATUS.includes(s), s);
});

test("the session brief counts a spec as open work exactly when its status is unfinished", () => {
  const { vault } = fixture();
  const ids = {};
  for (const s of STATUS) {
    const d = newDoc(vault, { type: "spec", project: "demo", slug: `s-${s}` });
    setStatus(d.file, s);
    ids[s] = d.id;
  }
  const open = openWork(vault, "demo").map((w) => w.id).sort();
  assert.deepEqual(open, UNFINISHED.map((s) => ids[s]).sort());
});

test("complete accepts exactly the completable statuses", () => {
  const { vault } = fixture();
  for (const s of STATUS) {
    const d = newDoc(vault, { type: "context", project: "demo", slug: `c-${s}` });
    fillSummary(d.file);
    setStatus(d.file, s);
    if (COMPLETABLE.includes(s)) {
      complete(vault, d.id);
      assert.match(fs.readFileSync(d.file, "utf8"), /status: completed/, s);
    } else {
      assert.throws(() => complete(vault, d.id), /only active docs can be completed/, s);
    }
  }
});

test("the validator wants filled sections unless the status is not yet canon, and behaviors only when delivered", () => {
  const { vault } = fixture();
  const empty = [];
  const noBehaviors = [];
  for (const s of STATUS) {
    const c = newDoc(vault, { type: "context", project: "demo", slug: `c-${s}` });
    setStatus(c.file, s);
    if (validate(vault).some((f) => f.includes(`demo-c-${s}.md`) && /is empty/.test(f))) empty.push(s);
    const sp = newDoc(vault, { type: "spec", project: "demo", slug: `v-${s}` });
    fillSummary(sp.file);
    setStatus(sp.file, s);
    if (validate(vault).some((f) => f.includes(`demo-spec-`) && f.includes(`-v-${s}.md`) && /at least one behavior/.test(f))) noBehaviors.push(s);
  }
  assert.deepEqual(empty.sort(), STATUS.filter((s) => !NOT_YET_CANON.includes(s)).sort());
  assert.deepEqual(noBehaviors.sort(), [...DELIVERED].sort());
});

test("a phase may start once the docs it depends on are delivered; a draft dependency blocks it", () => {
  const { vault } = fixture();
  const dep = {};
  for (const s of ["draft", "active", "completed"]) {
    const d = newDoc(vault, { type: "spec", project: "demo", slug: `d-${s}` });
    withBehavior(d.file);
    setStatus(d.file, s);
    dep[s] = d;
  }
  const phases = {};
  for (const s of ["draft", "active", "completed"]) {
    const p = newDoc(vault, { type: "phase", project: "demo", slug: `p-${s}`, depends: [dep[s].id] });
    let t = fs.readFileSync(p.file, "utf8").replace("owns: []", `owns: ["src/${s}/"]`);
    t = t.replace(/## Objective\n\n<!--.*?-->/s, "## Objective\n\nx").replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${dep.active.id}#B1]]`).replace(/## Dependencies\n\n<!--.*?-->/s, "## Dependencies\n\nnone");
    fs.writeFileSync(p.file, t);
    phases[s] = p;
  }
  // the dependency is a draft spec, so approving the phase is only possible after the status is set
  for (const s of ["draft", "active", "completed"]) setStatus(phases[s].file, "active");
  const r = readiness(vault, "demo");
  assert.deepEqual(r.ready.map((x) => x.id).sort(), [phases.active.id, phases.completed.id].sort());
  assert.match(r.blocked.find((b) => b.id === phases.draft.id).why.join(), /waits for .*d-draft/);
});
