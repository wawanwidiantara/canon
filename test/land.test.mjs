import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addAnchors, approve, findStale, init, mapProject, newDoc, setTask } from "../src/ops.mjs";
import { claim, loadClaims } from "../src/packets.mjs";
import { land } from "../src/land.mjs";

const node = (code) => ({ cmd: process.execPath, args: ["-e", code] });

function setup() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-land-")));
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
  const p = newDoc(vault, { type: "phase", project: "demo", slug: "auth" });
  let t = fs.readFileSync(p.file, "utf8").replace("owns: []", 'owns: ["src/auth/"]');
  t = t.replace(/## Objective\n\n<!--.*?-->/s, "## Objective\n\nx").replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${spec.id}#B1]]`).replace(/## Dependencies\n\n<!--.*?-->/s, "## Dependencies\n\nnone");
  fs.writeFileSync(p.file, t);
  approve(vault, p.id);
  const c = claim(vault, p.id);
  const commit = (rel, text, msg = "work") => {
    fs.mkdirSync(path.dirname(path.join(c.worktree, rel)), { recursive: true });
    fs.writeFileSync(path.join(c.worktree, rel), text);
    g(c.worktree, "add", ".");
    g(c.worktree, "commit", "-qm", msg);
  };
  const head = () => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const done = () => setTask(vault, spec.id, "B1", "done", "src/auth/a.txt");
  const writeGate = (gate) => fs.writeFileSync(path.join(c.worktree, "canon.gate.json"), JSON.stringify(gate));
  return { root, vault, repo, spec, phase: p, c, commit, head, done, writeGate, g };
}

test("a finished, clean phase lands: merged, spec re-verified, phase completed, claim gone", () => {
  const s = setup();
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const log = land(s.vault, s.phase.id);
  assert.equal(fs.readFileSync(path.join(s.repo, "src/auth/a.txt"), "utf8").replace(/\r/g, ""), "2\n");
  assert.deepEqual(loadClaims(s.vault), {});
  assert.ok(!fs.existsSync(s.c.worktree));
  assert.match(fs.readFileSync(s.phase.file, "utf8"), /status: completed/);
  assert.deepEqual(findStale(s.vault), []);
  assert.ok(log.some((l) => /re-verified/.test(l)) && log.some((l) => /WARNING: no canon.gate.json/.test(l)));
  assert.match(execFileSync("git", ["-C", s.repo, "log", "--format=%s", "-1"], { encoding: "utf8" }), /chore: land phase/);
});

test("a branch with edits outside the owned paths is refused and main is untouched", () => {
  const s = setup();
  s.commit("src/auth/a.txt", "2\n");
  s.commit("src/billing/b.txt", "sneaky\n");
  s.done();
  const before = s.head();
  assert.throws(() => land(s.vault, s.phase.id), /outside the owned paths[\s\S]*src\/billing\/b.txt/);
  assert.equal(s.head(), before);
  assert.ok(loadClaims(s.vault)[s.phase.id]);
});

test("unfinished behaviors, uncommitted work and no commits are each refused", () => {
  const s = setup();
  assert.throws(() => land(s.vault, s.phase.id), /no commits since the claim/);
  s.commit("src/auth/a.txt", "2\n");
  assert.throws(() => land(s.vault, s.phase.id), /not done yet[\s\S]*B1/);
  s.done();
  fs.writeFileSync(path.join(s.c.worktree, "src/auth/dirty.txt"), "x");
  assert.throws(() => land(s.vault, s.phase.id), /uncommitted changes/);
});

test("a rebase conflict names the file, leaves main alone and keeps the claim", () => {
  const s = setup();
  s.commit("src/auth/c.txt", "from branch\n");
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  fs.writeFileSync(path.join(s.repo, "src/auth/c.txt"), "from main\n");
  s.g(s.repo, "add", ".");
  s.g(s.repo, "commit", "-qm", "main moves");
  const before = s.head();
  assert.throws(() => land(s.vault, s.phase.id), /conflicts in:\n- src\/auth\/c.txt/);
  assert.equal(s.head(), before);
  assert.ok(loadClaims(s.vault)[s.phase.id]);
  assert.equal(execFileSync("git", ["-C", s.c.worktree, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
});

test("the full gate runs on the rebased branch; regen output is committed", () => {
  const s = setup();
  // the gate comes from main so the branch does not need to own it
  fs.writeFileSync(path.join(s.repo, "canon.gate.json"), JSON.stringify({ fast: [], full: [{ name: "check", ...node("require('fs').readFileSync('src/auth/a.txt')") }], regen: [{ name: "gen", ...node("require('fs').writeFileSync('generated.txt','g')") }] }));
  s.g(s.repo, "add", ".");
  s.g(s.repo, "commit", "-qm", "add gate");
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const log = land(s.vault, s.phase.id);
  assert.ok(log.some((l) => /regenerated files and committed/.test(l)) && log.some((l) => /full gate passed/.test(l)));
  assert.equal(fs.readFileSync(path.join(s.repo, "generated.txt"), "utf8").replace(/\r/g, ""), "g");
});

test("--no-merge stops with a ready branch and changes nothing on main", () => {
  const s = setup();
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const before = s.head();
  const log = land(s.vault, s.phase.id, { merge: false });
  assert.match(log.at(-1), /stopped before merging/);
  assert.equal(s.head(), before);
  assert.ok(loadClaims(s.vault)[s.phase.id]);
});

test("a failing gate on main's gate file blocks the land", () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, "canon.gate.json"), JSON.stringify({ fast: [], full: [{ name: "tests", ...node("console.error('3 failing');process.exit(1)") }] }));
  s.g(s.repo, "add", ".");
  s.g(s.repo, "commit", "-qm", "add gate");
  s.commit("src/auth/a.txt", "2\n");
  s.done();
  const before = s.head();
  assert.throws(() => land(s.vault, s.phase.id), /full gate failed[\s\S]*3 failing/);
  assert.equal(s.head(), before);
});
