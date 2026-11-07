import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approve, complete, init, mapProject, newDoc } from "../src/ops.mjs";
import { board, checkOwns, claim, outsideOwns, overlaps, owned, ownershipDenial, readiness, release } from "../src/packets.mjs";
import { validate } from "../src/validate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("owned: directories, globs and exact files", () => {
  assert.ok(owned(["src/auth/"], "src/auth/login.php"));
  assert.ok(!owned(["src/auth/"], "src/authz/x.php"));
  assert.ok(owned(["src/auth"], "src/auth/login.php"));
  assert.ok(!owned(["src/auth"], "src/author.php"));
  assert.ok(owned(["tests/**/*.test.js"], "tests/a/b/x.test.js"));
  assert.ok(owned(["tests/**/*.test.js"], "tests/x.test.js"));
  assert.ok(!owned(["tests/*.js"], "tests/a/x.js"));
  assert.ok(owned(["a.txt"], "a.txt"));
  assert.ok(!owned(["a.txt"], "b.txt"));
});

test("overlaps: conservative on shared prefixes, not on siblings", () => {
  assert.ok(overlaps(["src/auth/"], ["src/auth/login/"]));
  assert.ok(overlaps(["src/**"], ["src/auth/"]));
  assert.ok(overlaps(["src/au*"], ["src/auth/"]));
  assert.ok(!overlaps(["src/auth/"], ["src/billing/"]));
  assert.ok(!overlaps(["src/user/"], ["src/users/"]));
  assert.ok(!overlaps(["a.txt"], ["b.txt"]));
});

test("checkOwns rejects empty lists and paths that escape the repo", () => {
  assert.throws(() => checkOwns([]), /non-empty/);
  assert.throws(() => checkOwns(["../x"]), /inside the repo/);
  assert.throws(() => checkOwns(["/etc"]), /inside the repo/);
  assert.throws(() => checkOwns(["C:/x"]), /inside the repo/);
  checkOwns(["src/", "tests/**"]);
});

function setup() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-pk-")));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src/auth"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src/billing"), { recursive: true });
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
  return { root, vault, repo };
}

// An approved phase that owns the given paths.
function phase(vault, slug, owns, { depends = [] } = {}) {
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: `s-${slug}` });
  fs.writeFileSync(spec.file, fs.readFileSync(spec.file, "utf8").replace("status: draft", "status: active"));
  const p = newDoc(vault, { type: "phase", project: "demo", slug, depends });
  let t = fs.readFileSync(p.file, "utf8");
  t = t.replace("owns: []", `owns: ${JSON.stringify(owns)}`);
  t = t.replace(/## Objective\n\n<!--.*?-->/s, "## Objective\n\nx").replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${spec.id}#B1]]`).replace(/## Dependencies\n\n<!--.*?-->/s, "## Dependencies\n\nnone");
  fs.writeFileSync(p.file, t);
  fs.writeFileSync(spec.file, fs.readFileSync(spec.file, "utf8").replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: x"));
  return { ...p, spec };
}
const approvePhase = (vault, p) => approve(vault, p.id);

test("a draft phase cannot be claimed; an approved one can, and gets a worktree", () => {
  const { vault } = setup();
  const p = phase(vault, "auth", ["src/auth/"]);
  assert.throws(() => claim(vault, p.id), /a person must approve it first/);
  approvePhase(vault, p);
  const c = claim(vault, p.id, { agent: "a1" });
  assert.ok(fs.existsSync(path.join(c.worktree, "src/auth/a.txt")));
  assert.equal(c.branch, `canon/${p.id}`);
  assert.throws(() => claim(vault, p.id), /already claimed by a1/);
});

test("overlapping paths are refused; disjoint ones run side by side", () => {
  const { vault } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  const b = phase(vault, "auth-login", ["src/auth/login/"]);
  const c = phase(vault, "billing", ["src/billing/"]);
  [a, b, c].forEach((p) => approvePhase(vault, p));
  claim(vault, a.id);
  assert.throws(() => claim(vault, b.id), /already owns/);
  claim(vault, c.id);
  const r = readiness(vault, "demo");
  assert.deepEqual(r.ready, []);
  assert.match(r.blocked[0].why.join(), /already owns/);
  assert.deepEqual(board(vault).map((x) => x.id).sort(), [a.id, c.id].sort());
});

test("a phase waits for its dependencies to be completed", () => {
  const { vault } = setup();
  const a = phase(vault, "first", ["src/auth/"]);
  const b = phase(vault, "second", ["src/billing/"], { depends: [a.id] });
  approvePhase(vault, a);
  approvePhase(vault, b);
  assert.throws(() => claim(vault, b.id), /waits for .*first/);
  assert.deepEqual(readiness(vault, "demo").ready.map((x) => x.id), [a.id]);
  fs.writeFileSync(a.spec.file, fs.readFileSync(a.spec.file, "utf8").replace("- [ ] B1: x", "- [x] B1: x (test: src/auth/a.txt)"));
  complete(vault, a.id);
  claim(vault, b.id, { worktree: false });
});

test("release frees the paths", () => {
  const { vault } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  const b = phase(vault, "auth-login", ["src/auth/login/"]);
  [a, b].forEach((p) => approvePhase(vault, p));
  claim(vault, a.id, { worktree: false });
  release(vault, a.id);
  claim(vault, b.id, { worktree: false });
  assert.throws(() => release(vault, a.id), /not claimed/);
});

test("the edit guard binds a claimed worktree to its owned paths only", () => {
  const { vault, repo } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  approvePhase(vault, a);
  const c = claim(vault, a.id);
  const inWt = (f) => ownershipDenial(vault, c.worktree, path.join(c.worktree, f));
  assert.equal(inWt("src/auth/a.txt"), null);
  assert.equal(inWt("src/auth/new/deep.txt"), null);
  assert.match(inWt("src/billing/b.txt"), /outside the paths phase .* owns/);
  assert.match(ownershipDenial(vault, c.worktree, path.join(repo, "src/auth/a.txt")), /main checkout/);
  assert.equal(ownershipDenial(vault, c.worktree, path.join(os.tmpdir(), "scratch.txt")), null);
  // a person working in the main checkout is never blocked
  assert.equal(ownershipDenial(vault, repo, path.join(repo, "src/billing/b.txt")), null);
});

test("check-owns catches edits made outside the hook's sight", () => {
  const { vault } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  approvePhase(vault, a);
  const c = claim(vault, a.id);
  fs.writeFileSync(path.join(c.worktree, "src/auth/a.txt"), "2");
  assert.deepEqual(outsideOwns(vault, a.id), []);
  fs.writeFileSync(path.join(c.worktree, "src/billing/b.txt"), "sneaky");
  fs.writeFileSync(path.join(c.worktree, "stray.txt"), "x");
  assert.deepEqual(outsideOwns(vault, a.id).sort(), ["src/billing/b.txt", "stray.txt"]);
});

test("validate: owns must be a list of repo paths", () => {
  const { vault } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  assert.ok(!validate(vault).some((f) => /owns/.test(f)));
  fs.writeFileSync(a.file, fs.readFileSync(a.file, "utf8").replace(/owns: .*/, 'owns: ["../x"]'));
  assert.ok(validate(vault).some((f) => /must be a path inside the repo/.test(f)));
});

test("the PreToolUse hook denies an unowned Edit in a claimed worktree and ignores everything else", () => {
  const { vault, repo } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  approvePhase(vault, a);
  const c = claim(vault, a.id);
  const run = (cwd, tool, file) =>
    spawnSync("node", [path.join(ROOT, "hooks/pre-tool-use.mjs")], { input: JSON.stringify({ cwd, tool_name: tool, tool_input: { file_path: file } }), env: { ...process.env, CANON_VAULT: vault }, encoding: "utf8" });
  const bad = run(c.worktree, "Edit", path.join(c.worktree, "src/billing/b.txt"));
  assert.match(bad.stdout, /"permissionDecision":"deny"[\s\S]*outside the paths/);
  assert.equal(run(c.worktree, "Write", path.join(c.worktree, "src/auth/x.txt")).stdout, "");
  assert.equal(run(repo, "Edit", path.join(repo, "src/billing/b.txt")).stdout, "");
});

test("two agents claiming overlapping phases at the same moment: exactly one wins", async () => {
  const { vault } = setup();
  const ids = ["a", "b", "c", "d"].map((s) => phase(vault, s, ["src/auth/"]));
  ids.forEach((p) => approvePhase(vault, p));
  const { spawn } = await import("node:child_process");
  const codes = await Promise.all(
    ids.map((p) => new Promise((resolve) => spawn("node", [path.join(ROOT, "bin/canon.mjs"), "claim", p.id, "--no-worktree"], { env: { ...process.env, CANON_VAULT: vault } }).on("close", resolve))),
  );
  assert.equal(codes.filter((c) => c === 0).length, 1, JSON.stringify(codes));
  assert.equal(board(vault).length, 1);
});
