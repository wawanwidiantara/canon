import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addAnchors, approve, init, mapProject, newDoc } from "../src/ops.mjs";
import { claim } from "../src/packets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-govern-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/login.php"), "<?php // v1\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
  init(vault);
  mapProject(vault, "demo", repo);
  return { root, vault, repo };
}

const setStatus = (file, to) => fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${to}`));

// One doc anchored to `anchor`, in the given status. Returns its id.
function anchored(vault, { type = "spec", slug, status = "active", anchor = "src/login.php" }) {
  const { id, file } = newDoc(vault, { type, project: "demo", slug });
  if (status !== "draft") setStatus(file, status);
  addAnchors(vault, id, [anchor]);
  return id;
}

// Run the PreToolUse hook the way Claude Code does: tool call JSON on stdin.
function run(vault, cwd, tool, input) {
  const r = spawnSync("node", [path.join(ROOT, "hooks/pre-tool-use.mjs")], {
    input: JSON.stringify({ cwd, tool_name: tool, tool_input: input }),
    env: { ...process.env, CANON_VAULT: vault },
    encoding: "utf8",
  });
  return { ...r, json: r.stdout ? JSON.parse(r.stdout) : null };
}

const context = (r) => r.json?.hookSpecificOutput?.additionalContext;

test("B1: editing a file an active spec anchors names that spec", () => {
  const { vault, repo } = fixture();
  const id = anchored(vault, { slug: "login" });
  const r = run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") });
  assert.equal(r.status, 0);
  assert.match(context(r), new RegExp(id));
  assert.match(context(r), /src\/login\.php/);
});

test("B2: only active docs of the anchored types are named", () => {
  const { vault, repo } = fixture();
  const spec = anchored(vault, { slug: "login" });
  const adr = anchored(vault, { type: "adr", slug: "login-choice" });
  anchored(vault, { slug: "login-draft", status: "draft" });
  anchored(vault, { slug: "login-done", status: "completed" });
  anchored(vault, { type: "adr", slug: "login-old", status: "superseded" });
  const text = context(run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") }));
  assert.match(text, new RegExp(`${adr}, ${spec}\\.`));
  assert.doesNotMatch(text, /login-draft|login-done|login-old/);
});

test("B2: a doc from another project that anchors the same path is not named", () => {
  const { root, vault, repo } = fixture();
  const mine = anchored(vault, { slug: "login" });
  fs.mkdirSync(path.join(root, "other-project/src"), { recursive: true });
  fs.writeFileSync(path.join(root, "other-project/src/login.php"), "<?php // other\n");
  mapProject(vault, "other", path.join(root, "other-project"));
  const { id, file } = newDoc(vault, { type: "spec", project: "other", slug: "login" });
  setStatus(file, "active");
  addAnchors(vault, id, ["src/login.php"]);
  const text = context(run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") }));
  assert.match(text, new RegExp(mine));
  assert.doesNotMatch(text, /other-spec/);
});

test("B3: Edit, Write, MultiEdit and NotebookEdit all trigger the line", () => {
  const { vault, repo } = fixture();
  const id = anchored(vault, { slug: "login" });
  const file = path.join(repo, "src/login.php");
  for (const [tool, input] of [["Edit", { file_path: file }], ["Write", { file_path: file }], ["MultiEdit", { file_path: file }], ["NotebookEdit", { notebook_path: file }]]) {
    assert.match(context(run(vault, repo, tool, input)) ?? "", new RegExp(id), tool);
  }
});

test("B4: a file no active doc anchors produces no output and exit 0", () => {
  const { vault, repo } = fixture();
  anchored(vault, { slug: "login" });
  const r = run(vault, repo, "Edit", { file_path: path.join(repo, "README.md") });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("B5: outside the project, a missing vault, no path or a broken config produce no output and exit 0", () => {
  const { root, vault, repo } = fixture();
  anchored(vault, { slug: "login" });
  // Same trailing path as the anchor: a suffix match must not leak across repos.
  const outside = path.join(root, "other-repo/src/login.php");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, "x");
  const a = run(vault, repo, "Edit", { file_path: outside });
  assert.deepEqual([a.status, a.stdout], [0, ""]);
  const b = run(path.join(root, "no-such-vault"), repo, "Edit", { file_path: path.join(repo, "src/login.php") });
  assert.deepEqual([b.status, b.stdout], [0, ""]);
  const c = run(vault, repo, "Edit", {});
  assert.deepEqual([c.status, c.stdout], [0, ""]);
  fs.writeFileSync(path.join(vault, "canon.config.json"), "{ not json");
  const d = run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") });
  assert.equal(d.status, 0);
  assert.equal(d.stdout, "");
});

test("B6: more than 5 governing docs list the first 5, then 'and N more'", () => {
  const { vault, repo } = fixture();
  const ids = ["a", "b", "c", "d", "e", "f", "g"].map((s) => anchored(vault, { slug: `login-${s}` }));
  const text = context(run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") }));
  for (const id of ids.slice(0, 5)) assert.match(text, new RegExp(id));
  for (const id of ids.slice(5)) assert.doesNotMatch(text, new RegExp(id));
  assert.match(text, /and 2 more\./);
  const exactly5 = fixture();
  ["a", "b", "c", "d", "e"].forEach((s) => anchored(exactly5.vault, { slug: `login-${s}` }));
  assert.doesNotMatch(context(run(exactly5.vault, exactly5.repo, "Edit", { file_path: path.join(exactly5.repo, "src/login.php") })), /more/);
});

test("B7: the line is a statement of fact that names canon verify, with no command text", () => {
  const { vault, repo } = fixture();
  anchored(vault, { slug: "login" });
  const text = context(run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") }));
  assert.match(text, /^These docs anchor src\/login\.php: /);
  assert.match(text, /canon verify <id>/);
  assert.doesNotMatch(text, /\b(must|do not|don't|never|always|you should|make sure)\b/i);
  assert.ok(!/^(Update|Run|Do|Make)\b/m.test(text), "must not open with an imperative verb");
});

test("B8: output is hookSpecificOutput for PreToolUse and never carries a permission decision", () => {
  const { vault, repo } = fixture();
  anchored(vault, { slug: "login" });
  const r = run(vault, repo, "Edit", { file_path: path.join(repo, "src/login.php") });
  assert.deepEqual(Object.keys(r.json), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(r.json.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  assert.equal(r.json.hookSpecificOutput.hookEventName, "PreToolUse");
});

test("B9: an ownership denial is the only output, even when a spec anchors the file", () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-govern-claim-")));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  for (const d of ["src/auth", "src/billing"]) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/auth/a.txt"), "1");
  fs.writeFileSync(path.join(repo, "src/billing/b.txt"), "1");
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "a@b");
  g("config", "user.name", "a");
  g("add", ".");
  g("commit", "-qm", "init");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  // A spec that anchors the billing file, and a phase that owns only src/auth/.
  anchored(vault, { slug: "billing", anchor: "src/billing/b.txt" });
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: "s-auth" });
  fs.writeFileSync(spec.file, fs.readFileSync(spec.file, "utf8").replace("status: draft", "status: active").replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: x"));
  const ph = newDoc(vault, { type: "phase", project: "demo", slug: "auth" });
  let text = fs.readFileSync(ph.file, "utf8").replace("owns: []", 'owns: ["src/auth/"]');
  text = text.replace(/## Objective\n\n<!--.*?-->/s, "## Objective\n\nx").replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${spec.id}#B1]]`).replace(/## Dependencies\n\n<!--.*?-->/s, "## Dependencies\n\nNone.");
  fs.writeFileSync(ph.file, text);
  approve(vault, ph.id);
  const c = claim(vault, ph.id);

  const denied = run(vault, c.worktree, "Edit", { file_path: path.join(c.worktree, "src/billing/b.txt") });
  assert.equal(denied.json.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(denied.json.hookSpecificOutput.additionalContext, undefined);
  // Control: a spec anchoring a file the phase does own is still named.
  const owned = anchored(vault, { slug: "auth-doc", anchor: "src/auth/a.txt" });
  const allowed = run(vault, c.worktree, "Edit", { file_path: path.join(c.worktree, "src/auth/a.txt") });
  assert.match(context(allowed), new RegExp(owned));
});
