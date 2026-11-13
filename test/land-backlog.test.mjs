import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addAnchors, approve, findStale, init, mapProject, newDoc, setTask } from "../src/ops.mjs";
import { claim, loadClaims } from "../src/packets.mjs";
import { land } from "../src/land.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = (code) => ({ cmd: process.execPath, args: ["-e", code] });

// Same shape as test/land.test.mjs: a vault, a repo, one anchored spec and one claimed phase that owns src/auth/.
function setup(owns = ["src/auth/"]) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-landbk-")));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src/auth"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src/billing"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/auth/a.txt"), "1\n");
  fs.writeFileSync(path.join(repo, "src/billing/b.txt"), "1\n");
  const g = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  g(repo, "init", "-q", "-b", "main");
  g(repo, "config", "user.email", "a@b");
  g(repo, "config", "user.name", "a");
  g(repo, "add", ".");
  g(repo, "commit", "-qm", "init");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: "s" });
  let st = fs.readFileSync(spec.file, "utf8").replace("status: draft", "status: active");
  st = st.replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: x");
  fs.writeFileSync(spec.file, st);
  addAnchors(vault, spec.id, ["src/auth/a.txt"]);

  const makePhase = (slug, owns) => {
    const p = newDoc(vault, { type: "phase", project: "demo", slug });
    let t = fs.readFileSync(p.file, "utf8").replace("owns: []", `owns: ${JSON.stringify(owns)}`);
    t = t.replace(/## Objective\n\n<!--.*?-->/s, "## Objective\n\nx").replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${spec.id}#B1]]`).replace(/## Dependencies\n\n<!--.*?-->/s, "## Dependencies\n\nnone");
    fs.writeFileSync(p.file, t);
    approve(vault, p.id);
    return p;
  };
  const phase = makePhase("auth", owns);
  const c = claim(vault, phase.id);
  const commitIn = (wt, rel, text, msg = "work") => {
    fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
    fs.writeFileSync(path.join(wt, rel), text);
    g(wt, "add", ".");
    g(wt, "commit", "-qm", msg);
  };
  const commit = (rel, text, msg) => commitIn(c.worktree, rel, text, msg);
  const head = () => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const done = () => setTask(vault, spec.id, "B1", "done", "src/auth/a.txt");
  const status = (file) => /^status: (\S+)$/m.exec(fs.readFileSync(file, "utf8"))[1];
  return { root, vault, repo, spec, phase, c, commit, commitIn, head, done, status, g, makePhase };
}

test("B9: landing is refused when main moves while the gate runs", () => {
  const s = setup();
  // The gate itself moves main, which is the same as another session landing in the meantime.
  const moveMain = `require('child_process').execFileSync('git',['-C',${JSON.stringify(s.repo)},'commit','--allow-empty','-qm','moved'])`;
  fs.writeFileSync(path.join(s.repo, "canon.gate.json"), JSON.stringify({ fast: [], full: [{ name: "move", ...node(moveMain) }] }));
  s.g(s.repo, "add", ".");
  s.g(s.repo, "commit", "-qm", "add gate");
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  assert.throws(() => land(s.vault, s.phase.id), /main moved while the gate ran/);
  const subjects = execFileSync("git", ["-C", s.repo, "log", "--format=%s"], { encoding: "utf8" });
  assert.doesNotMatch(subjects, /chore: land phase/, "nothing was merged");
  assert.ok(loadClaims(s.vault)[s.phase.id], "the claim is kept");
  assert.equal(fs.readFileSync(path.join(s.repo, "src/auth/a.txt"), "utf8").replace(/\r/g, ""), "1\n");
});

test("B10: landing is refused for an unclaimed phase, a claim without a worktree, and from inside the worktree", () => {
  const s = setup();
  assert.throws(() => land(s.vault, "demo-phase-099-nope"), /is not claimed/);

  const other = s.makePhase("billing", ["src/billing/"]);
  claim(s.vault, other.id, { worktree: false });
  assert.throws(() => land(s.vault, other.id), /claimed without a worktree/);

  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const here = process.cwd();
  try {
    process.chdir(s.c.worktree);
    assert.throws(() => land(s.vault, s.phase.id), /from the main checkout, not from inside/);
  } finally {
    process.chdir(here);
  }
  assert.ok(loadClaims(s.vault)[s.phase.id], "the claim is kept");
  // control: the same phase lands from outside the worktree
  assert.ok(land(s.vault, s.phase.id).some((l) => /merged/.test(l)));
});

test("B11: landing is refused when main has uncommitted changes", () => {
  const s = setup();
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  fs.writeFileSync(path.join(s.repo, "scratch.txt"), "dirty\n");
  const before = s.head();
  assert.throws(() => land(s.vault, s.phase.id), /main checkout .* has uncommitted changes/);
  assert.equal(s.head(), before);
  assert.ok(loadClaims(s.vault)[s.phase.id]);
  // control: clean main lands
  fs.rmSync(path.join(s.repo, "scratch.txt"));
  assert.ok(land(s.vault, s.phase.id).some((l) => /merged/.test(l)));
});

test("B12: two lands in one project never run their gates at the same time", async () => {
  const s = setup();
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const other = s.makePhase("billing", ["src/billing/"]);
  const c2 = claim(s.vault, other.id);
  s.commitIn(c2.worktree, "src/billing/b.txt", "2\n");

  // Each gate logs start, waits, logs end. If the lands overlapped the log would read start,start,end,end.
  const log = path.join(s.root, "gate.log");
  const gateCode = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'start\\n');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(log)},'end\\n')},900)`;
  fs.writeFileSync(path.join(s.repo, "canon.gate.json"), JSON.stringify({ fast: [], full: [{ name: "slow", ...node(gateCode) }] }));
  s.g(s.repo, "add", ".");
  s.g(s.repo, "commit", "-qm", "add gate");

  const run = (phaseId) =>
    new Promise((resolve) => {
      const script = `import { land } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "src/land.mjs")).href)}; console.log(land(${JSON.stringify(s.vault)}, ${JSON.stringify(phaseId)}).join("\\n"));`;
      const p = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: s.repo });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out }));
    });
  const results = await Promise.all([run(s.phase.id), run(other.id)]);
  for (const r of results) assert.equal(r.code, 0, r.out);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.deepEqual(lines, ["start", "end", "start", "end"]);
});

test("B13: a delivered spec whose anchor went missing is not re-verified and stays stale", () => {
  const s = setup();
  // The branch deletes the anchored file inside its owned paths: the anchor is "missing", not "changed".
  fs.rmSync(path.join(s.c.worktree, "src/auth/a.txt"));
  s.g(s.c.worktree, "add", "-A");
  s.g(s.c.worktree, "commit", "-qm", "remove a");
  s.done();
  const log = land(s.vault, s.phase.id);
  assert.ok(log.some((l) => /is still stale: missing src\/auth\/a\.txt@/.test(l)), log.join("\n"));
  assert.ok(!log.some((l) => /re-verified/.test(l)));
  assert.ok(log.some((l) => /not completed/.test(l)));
  assert.deepEqual(findStale(s.vault).map((x) => x.id), [s.spec.id]);
  assert.equal(s.status(s.phase.file), "active");
});

test("B16: a delivered spec whose linked test is gone stays stale, and landing still finishes and releases the claim", () => {
  const s = setup(["src/auth/", "src/billing/"]);
  // The branch changes the anchored file and deletes the file the behavior's test link points at, both inside the phase.
  fs.writeFileSync(path.join(s.c.worktree, "src/auth/a.txt"), "2\n");
  fs.rmSync(path.join(s.c.worktree, "src/billing/b.txt"));
  s.g(s.c.worktree, "add", "-A");
  s.g(s.c.worktree, "commit", "-qm", "change a, remove the test file");
  setTask(s.vault, s.spec.id, "B1", "done", "src/billing/b.txt");
  const log = land(s.vault, s.phase.id);
  assert.ok(log.some((l) => /still stale and could not be re-verified: cannot verify .* a linked test is gone/.test(l)), log.join("\n"));
  assert.ok(log.some((l) => /not completed/.test(l)));
  assert.ok(log.some((l) => /released the claim/.test(l)), "landing finishes");
  assert.equal(loadClaims(s.vault)[s.phase.id], undefined);
  assert.deepEqual(findStale(s.vault).map((x) => x.id), [s.spec.id]);
});

test("B14: a merge that fails after a clean rebase is aborted and main is left untouched", { skip: process.platform === "win32" }, () => {
  const s = setup();
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const hook = path.join(s.repo, ".git/hooks/pre-merge-commit");
  fs.writeFileSync(hook, "#!/bin/sh\necho blocked >&2\nexit 1\n", { mode: 0o755 });
  const before = s.head();
  assert.throws(() => land(s.vault, s.phase.id), /merge failed after a clean rebase, main left untouched/);
  assert.equal(s.head(), before);
  assert.equal(execFileSync("git", ["-C", s.repo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  assert.throws(() => execFileSync("git", ["-C", s.repo, "rev-parse", "-q", "--verify", "MERGE_HEAD"], { stdio: "ignore" }), "no merge left in progress");
  assert.ok(loadClaims(s.vault)[s.phase.id], "the claim is kept");
  // control: without the hook the same branch lands
  fs.rmSync(hook);
  assert.ok(land(s.vault, s.phase.id).some((l) => /merged/.test(l)));
});
