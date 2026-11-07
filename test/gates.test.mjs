import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatGate, initGate, loadGate, runGate, suggestGate } from "../src/gates.mjs";
import { init, mapProject } from "../src/ops.mjs";
import { gitState, stopReasons } from "../src/context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-gate-")));
const node = (code) => ({ cmd: process.execPath, args: ["-e", code] });
const writeGate = (repo, gate) => fs.writeFileSync(path.join(repo, "canon.gate.json"), JSON.stringify(gate));

test("no gate file means no gate", () => {
  assert.equal(loadGate(tmp()), null);
  assert.throws(() => runGate(tmp(), "fast"), /canon gate init/);
});

test("a malformed gate file is rejected with the exact place", () => {
  const repo = tmp();
  writeGate(repo, { fast: [{ name: "x" }] });
  assert.throws(() => loadGate(repo), /fast\[0\] needs a "cmd"/);
  writeGate(repo, { fast: [{ cmd: "x", args: "no" }] });
  assert.throws(() => loadGate(repo), /"args" must be a list of strings/);
  writeGate(repo, { slow: [] });
  assert.throws(() => loadGate(repo), /unknown key "slow"/);
  fs.writeFileSync(path.join(repo, "canon.gate.json"), "{nope");
  assert.throws(() => loadGate(repo), /not valid JSON/);
});

test("fast stops at the first failure; full runs fast first", () => {
  const repo = tmp();
  writeGate(repo, { fast: [{ name: "a", ...node("0") }, { name: "b", ...node("process.exit(3)") }, { name: "c", ...node("0") }], full: [{ name: "d", ...node("0") }] });
  const r = runGate(repo, "fast");
  assert.deepEqual(r.map((x) => [x.name, x.ok]), [["a", true], ["b", false]]);
  const ok = tmp();
  writeGate(ok, { fast: [{ name: "a", ...node("0") }], full: [{ name: "d", ...node("0") }] });
  assert.deepEqual(runGate(ok, "full").map((x) => x.name), ["a", "d"]);
  assert.match(formatGate("fast", r), /FAIL b[\s\S]*gate fast: FAILED/);
});

test("a command that does not exist or hangs fails, never passes", () => {
  const repo = tmp();
  writeGate(repo, { fast: [{ name: "ghost", cmd: "definitely-not-a-real-command-xyz" }] });
  const [g] = runGate(repo, "fast");
  assert.equal(g.ok, false);
  const slow = tmp();
  writeGate(slow, { fast: [{ name: "hang", ...node("setTimeout(()=>{},60000)"), timeoutSec: 0.3 }] });
  const [h] = runGate(slow, "fast");
  assert.equal(h.ok, false);
  assert.match(h.output, /timed out/);
});

test("a spent time budget skips the rest and says so", () => {
  const repo = tmp();
  writeGate(repo, { fast: [{ name: "a", ...node("0") }, { name: "b", ...node("0") }] });
  const r = runGate(repo, "fast", { budgetMs: 0 });
  assert.equal(r[0].skipped, true);
  assert.equal(r[0].ok, false);
});

test("init writes a gate from scripts the repo already has, and refuses to overwrite", () => {
  const repo = tmp();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "node --test", build: "x" } }));
  const s = suggestGate(repo);
  assert.deepEqual(s.fast.map((c) => c.name), ["lint"]);
  assert.deepEqual(s.full.map((c) => c.name), ["test"]);
  initGate(repo);
  assert.ok(loadGate(repo).fast.length === 1);
  assert.throws(() => initGate(repo), /already exists/);
});

test("the Stop gate blocks on a failing fast gate and stays quiet when it passes", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "a@b");
  git("config", "user.name", "a");
  fs.writeFileSync(path.join(repo, "a.txt"), "1");
  git("add", ".");
  git("commit", "-qm", "init");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "2");
  fs.writeFileSync(path.join(vault, "projects.touch"), "");
  writeGate(repo, { fast: [{ name: "lint", ...node("console.error('bad style');process.exit(1)") }] });
  const bad = stopReasons(vault, "demo", { since: Date.now() - 1000, baseCode: "other" });
  assert.ok(bad.some((r) => /fast gate failed[\s\S]*bad style/.test(r)), JSON.stringify(bad));
  writeGate(repo, { fast: [{ name: "lint", ...node("0") }] });
  assert.ok(!stopReasons(vault, "demo", { since: Date.now() - 1000, baseCode: "other" }).some((r) => /fast gate failed/.test(r)));
  // changes that were already there at session start do not trigger it
  writeGate(repo, { fast: [{ name: "lint", ...node("process.exit(1)") }] });
  const base = gitState(repo);
  assert.ok(!stopReasons(vault, "demo", { since: Date.now() - 1000, baseCode: base }).some((r) => /fast gate failed/.test(r)));
  assert.ok(stopReasons(vault, "demo", { since: Date.now() - 1000, baseCode: null }).some((r) => /fast gate failed/.test(r)));
});

test("canon gate fast exits 1 on failure and prints the tail", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  writeGate(repo, { fast: [{ name: "lint", ...node("console.log('line one');process.exit(2)") }] });
  const r = spawnSync("node", [path.join(ROOT, "bin/canon.mjs"), "gate", "fast"], { cwd: repo, env: { ...process.env, CANON_VAULT: vault }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL lint[\s\S]*line one[\s\S]*gate fast: FAILED/);
});
