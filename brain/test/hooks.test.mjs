import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addAnchors, init, mapProject, newDoc } from "../src/ops.mjs";
import { projectForCwd, shouldBlock, stopReasons, sessionBrief } from "../src/context.mjs";
import { loadConfig } from "../src/vault.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore" });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brainh-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/a.php"), "v1\n");
  for (const d of [repo, vault]) {
    fs.mkdirSync(d, { recursive: true });
    sh(d, "init", "-q");
    sh(d, "config", "user.email", "t@t");
    sh(d, "config", "user.name", "t");
  }
  init(vault);
  mapProject(vault, "demo", repo);
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  addAnchors(vault, spec.id, ["src/a.php"]);
  for (const d of [repo, vault]) {
    sh(d, "add", "-A");
    sh(d, "commit", "-qm", "init");
  }
  return { vault, repo, spec };
}

function runHook(name, input, vault) {
  return spawnSync("node", [path.join(ROOT, "hooks", name)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, BRAIN_VAULT: vault },
  });
}

test("projectForCwd picks longest matching repo", () => {
  const cfg = { projects: { a: { repo: "/x/a" }, b: { repo: "/x/a/sub" } } };
  assert.equal(projectForCwd(cfg, "/x/a/sub/deep"), "b");
  assert.equal(projectForCwd(cfg, "/x/a/other"), "a");
  assert.equal(projectForCwd(cfg, "/y"), null);
});

test("session-start injects brief for a mapped repo, silent for others", () => {
  const { vault, repo } = fixture();
  const r = runHook("session-start.mjs", { cwd: repo }, vault);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /project "demo"/);
  assert.match(out.hookSpecificOutput.additionalContext, /demo-spec-001-login \[draft\]/);
  const other = runHook("session-start.mjs", { cwd: os.tmpdir() }, vault);
  assert.equal(other.stdout, "");
  assert.equal(other.status, 0);
});

test("stop: clean tree does not block", () => {
  const { vault, repo } = fixture();
  assert.equal(runHook("stop.mjs", { cwd: repo, session_id: "s1" }, vault).stdout, "");
});

test("stop: code changed without doc blocks once, then lets go", () => {
  const { vault, repo } = fixture();
  fs.writeFileSync(path.join(repo, "src/b.php"), "new\n");
  const first = runHook("stop.mjs", { cwd: repo, session_id: "s-block" }, vault);
  const out = JSON.parse(first.stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /no doc changed under projects\/demo/);
  const second = runHook("stop.mjs", { cwd: repo, session_id: "s-block" }, vault);
  assert.equal(second.stdout, "");
});

test("stop: doc changed alongside code does not block on the docs gate", () => {
  const { vault, repo, spec } = fixture();
  fs.writeFileSync(path.join(repo, "src/b.php"), "new\n");
  fs.appendFileSync(spec.file, "\n<!-- touched -->\n");
  assert.deepEqual(stopReasons(vault, "demo").filter((r) => r.includes("no doc changed")), []);
});

test("stop: skip-docs silences the gate for those exact changes only", () => {
  const { vault, repo } = fixture();
  fs.writeFileSync(path.join(repo, "src/b.php"), "new\n");
  execFileSync("node", [path.join(ROOT, "brain/bin/brain.mjs"), "skip-docs"], { cwd: repo, env: { ...process.env, BRAIN_VAULT: vault } });
  assert.deepEqual(stopReasons(vault, "demo"), []);
  fs.writeFileSync(path.join(repo, "src/c.php"), "more\n");
  assert.equal(stopReasons(vault, "demo").length, 1);
});

test("shouldBlock dedupes identical reasons per session", () => {
  const sid = `t-${Date.now()}`;
  assert.equal(shouldBlock(sid, ["a"]), true);
  assert.equal(shouldBlock(sid, ["a"]), false);
  assert.equal(shouldBlock(sid, ["b"]), true);
  assert.equal(shouldBlock(sid, []), false);
});

test("pre-compact prints notes for mapped repo", () => {
  const { vault, repo } = fixture();
  const r = runHook("pre-compact.mjs", { cwd: repo }, vault);
  assert.match(r.stdout, /Keep in the summary/);
  assert.match(r.stdout, /demo/);
});

test("sessionBrief reports stale anchors", () => {
  const { vault, repo } = fixture();
  // draft specs are not checked for staleness; activate it first
  const specFile = fs.readdirSync(path.join(vault, "projects/demo/02_specs"))[0];
  const p = path.join(vault, "projects/demo/02_specs", specFile);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("status: draft", "status: active"));
  fs.writeFileSync(path.join(repo, "src/a.php"), "v2\n");
  assert.match(sessionBrief(vault, "demo"), /Stale: demo-spec-001-login \(changed src\/a\.php/);
  assert.ok(loadConfig(vault).projects.demo);
});
