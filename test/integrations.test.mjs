import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apply, inspect, plan, wiring } from "../src/codegraph.mjs";
import { isQuicksilverCall, isRatification, quicksilverDenial, ratificationPrompt } from "../src/gate.mjs";
import { init, mapProject } from "../src/ops.mjs";
import { sessionBrief } from "../src/context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
const git = (d, ...a) => execFileSync("git", ["-C", d, ...a], { stdio: "ignore" });

function repo({ index = false, mcp = false, tracked = false } = {}) {
  const d = tmp();
  git(d, "init", "-q");
  git(d, "config", "user.email", "t@t");
  git(d, "config", "user.name", "t");
  if (index) {
    fs.mkdirSync(path.join(d, ".codegraph"));
    fs.writeFileSync(path.join(d, ".codegraph/codegraph.db"), "db");
    fs.writeFileSync(path.join(d, ".codegraph/.gitignore"), "*\n!.gitignore\n");
  }
  if (mcp) fs.writeFileSync(path.join(d, ".mcp.json"), JSON.stringify({ mcpServers: { codegraph: { command: "codegraph" } } }));
  if (tracked) git(d, "add", "-f", ".codegraph/.gitignore");
  return d;
}

function fakeBin(names) {
  const bin = tmp();
  const win = process.platform === "win32";
  for (const n of names) fs.writeFileSync(path.join(bin, win ? `${n}.cmd` : n), win ? "@echo off\r\n" : "#!/bin/sh\n", { mode: 0o755 });
  return { PATH: bin, Path: bin, PATHEXT: ".CMD;.EXE" };
}
const home = (data) => {
  const h = tmp();
  if (data) fs.writeFileSync(path.join(h, ".claude.json"), JSON.stringify(data));
  return h;
};

test("wiring finds repo file, local user config, global, and reports duplicates", () => {
  const r = repo({ mcp: true });
  assert.deepEqual(wiring(r, home()), ["repo .mcp.json"]);
  const both = home({ mcpServers: { codegraph: {} }, projects: { [r]: { mcpServers: { codegraph: {} } } } });
  assert.deepEqual(wiring(r, both), ["repo .mcp.json", "user config, this project only", "user config, all projects"]);
  assert.deepEqual(wiring(repo(), home({ mcpServers: {} })), []);
});

test("already set up (your sitarung case): nothing to do, nothing touched", () => {
  const r = repo({ index: true, mcp: true, tracked: true });
  const s = inspect(r, { home: home(), env: fakeBin(["codegraph"]) });
  assert.equal(s.index, true);
  assert.deepEqual(s.trackedIndexFiles, []);
  assert.deepEqual(plan(s), []);
});

test("fresh repo: init, register locally, hide index", () => {
  const r = repo();
  const s = inspect(r, { home: home(), env: fakeBin(["codegraph"]) });
  const acts = plan(s);
  assert.deepEqual(acts.map((a) => a.cmd?.slice(0, 3) ?? a.what.slice(0, 5)), [["codegraph", "init", r], ["claude", "mcp", "add"]]);
  assert.equal(acts[1].cwd, r);
  assert.ok(acts[1].cmd.includes("CODEGRAPH_TELEMETRY=0"));
});

test("indexed but unwired: only registers; indexed, unignored, untracked: hides locally", () => {
  const r = repo({ index: true });
  fs.rmSync(path.join(r, ".codegraph/.gitignore")); // db would show up in git status
  const s = inspect(r, { home: home(), env: fakeBin(["codegraph"]) });
  const acts = plan(s);
  assert.deepEqual(acts.map((a) => (a.exclude ? "exclude" : a.cmd[0])), ["claude", "exclude"]);
  const ran = [];
  const log = apply(s, acts, { run: (cmd) => (ran.push(cmd[0]), { status: 0 }) });
  assert.deepEqual(ran, ["claude"]);
  assert.match(fs.readFileSync(path.join(r, ".git/info/exclude"), "utf8"), /^\.codegraph\/$/m);
  apply(s, acts.filter((a) => a.exclude)); // idempotent
  assert.equal(fs.readFileSync(path.join(r, ".git/info/exclude"), "utf8").match(/\.codegraph\//g).length, 1);
  assert.ok(log.every((l) => l.startsWith("done")));
});

test("missing CLI: manual instruction only, nothing run", () => {
  const s = inspect(repo(), { home: home(), env: { PATH: tmp() } });
  const acts = plan(s);
  assert.equal(acts.length, 1);
  assert.match(acts[0].manual, /npm i -g/);
  assert.deepEqual(apply(s, acts, { run: () => assert.fail("must not run") }), [`manual: ${acts[0].manual}`]);
});

test("a failed command is reported, not thrown", () => {
  const s = inspect(repo(), { home: home(), env: fakeBin(["codegraph"]) });
  const log = apply(s, plan(s).slice(0, 1), { run: () => ({ status: 1, stderr: "boom\n" }) });
  assert.match(log[0], /FAILED: build the index .*boom/);
});

test("quicksilver gate", () => {
  for (const c of ["qs filter 'x' src", "cd a && qs rank q .", "~/.claude/skills/quicksilver/bin/qs ask q", "echo hi | qs classify --labels a,b"]) assert.equal(isQuicksilverCall(c), true, c);
  for (const c of ["ls", "grep qs file", "npm run qstatus", "qs status", "echo qs"]) assert.equal(isQuicksilverCall(c), false, c);
  const cfg = { projects: { a: {}, b: { quicksilver: true } } };
  assert.match(quicksilverDenial(cfg, "a", "qs filter x src"), /has not allowed it/);
  assert.equal(quicksilverDenial(cfg, "b", "qs filter x src"), null);
  assert.equal(quicksilverDenial(cfg, null, "qs filter x src"), null);
  assert.equal(quicksilverDenial(cfg, "a", "ls"), null);
});

test("pre-tool-use hook denies qs in a mapped repo, allows elsewhere and when enabled", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const r = path.join(root, "repo");
  fs.mkdirSync(r);
  init(vault);
  mapProject(vault, "demo", r);
  const run = (cwd, command) =>
    spawnSync("node", [path.join(ROOT, "hooks/pre-tool-use.mjs")], { input: JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } }), env: { ...process.env, CANON_VAULT: vault }, encoding: "utf8" });
  const denied = JSON.parse(run(r, "qs filter 'x' src").stdout);
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run(r, "ls").stdout, "");
  assert.equal(run(os.tmpdir(), "qs filter 'x' src").stdout, "");
  const cfgPath = path.join(vault, "canon.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.projects.demo.quicksilver = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  assert.equal(run(r, "qs filter 'x' src").stdout, "");
  assert.match(sessionBrief(vault, "demo"), /Quicksilver .* is allowed/);
});

test("session brief mentions codegraph only when index and wiring both exist", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const r = repo({ index: true, mcp: true });
  init(vault);
  mapProject(vault, "demo", r);
  assert.match(sessionBrief(vault, "demo"), /codegraph_explore/);
  fs.rmSync(path.join(r, ".mcp.json"));
  assert.doesNotMatch(sessionBrief(vault, "demo"), /codegraph_explore/);
});

test("ratification gate: approve and supersede ask a person, everything else passes", () => {
  for (const c of ["canon approve demo-spec-001-x", "cd a && canon supersede a b", "canon approve x | cat"]) assert.equal(isRatification(c), true, c);
  for (const c of ["canon complete x", "canon task a B1 done", "canon query approve", "echo approve", "canon approver"]) assert.equal(isRatification(c), false, c);
  const cfg = { projects: {} };
  assert.match(ratificationPrompt(cfg, "demo", "canon approve x"), /Approving makes this doc canon/);
  assert.match(ratificationPrompt(cfg, "demo", "canon supersede a b"), /Superseding retires/);
  assert.equal(ratificationPrompt({ ratify: "auto" }, "demo", "canon approve x"), null);
  assert.equal(ratificationPrompt(cfg, null, "canon approve x"), null);
});

test("pre-tool-use hook asks for approve, denies qs first, and honours ratify=auto", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const r = path.join(root, "repo");
  fs.mkdirSync(r);
  init(vault);
  mapProject(vault, "demo", r);
  const run = (command) =>
    spawnSync("node", [path.join(ROOT, "hooks/pre-tool-use.mjs")], { input: JSON.stringify({ cwd: r, tool_name: "Bash", tool_input: { command } }), env: { ...process.env, CANON_VAULT: vault }, encoding: "utf8" });
  assert.equal(JSON.parse(run("canon approve demo-spec-001-x").stdout).hookSpecificOutput.permissionDecision, "ask");
  assert.equal(run("canon complete demo-spec-001-x").stdout, "");
  assert.equal(JSON.parse(run("qs filter x . && canon approve y").stdout).hookSpecificOutput.permissionDecision, "deny");
  const cfgPath = path.join(vault, "canon.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.equal(cfg.ratify, "ask");
  cfg.ratify = "auto";
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  assert.equal(run("canon approve demo-spec-001-x").stdout, "");
});
