import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addAnchors, findStale, init, mapProject, newDoc } from "../src/ops.mjs";
import { projectForCwd, resolveProject } from "../src/context.mjs";
import { loadConfig } from "../src/vault.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// vault + repo with one anchored spec, plus a linked worktree of the repo.
function setup() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-wt-")));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  const wt = path.join(root, "repo-wt", "x");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/a.txt"), "v1\n");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "a@b");
  git("config", "user.name", "a");
  git("add", ".");
  git("commit", "-qm", "init");
  git("worktree", "add", "-q", wt, "-b", "wa-1");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  addAnchors(vault, s.id, ["src/a.txt"]);
  // make it active without going through full validation
  fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace("status: draft", "status: active"));
  return { root, vault, repo, wt, spec: s };
}

test("a linked worktree resolves to its project", () => {
  const { vault, wt } = setup();
  assert.equal(projectForCwd(loadConfig(vault), wt), "demo");
  assert.equal(resolveProject(vault, wt), "demo");
});

test("stale checks see edits in the worktree, and the main checkout stays clean", () => {
  const { vault, repo, wt, spec } = setup();
  fs.writeFileSync(path.join(wt, "src/a.txt"), "changed in worktree\n");
  const here = process.cwd();
  try {
    process.chdir(wt);
    assert.deepEqual(findStale(vault).map((s) => s.id), [spec.id]);
    process.chdir(repo);
    assert.deepEqual(findStale(vault), []);
  } finally {
    process.chdir(here);
  }
});

test("canon map from a worktree maps the main checkout", () => {
  const { vault, repo, wt } = setup();
  mapProject(vault, "other", wt);
  assert.equal(loadConfig(vault).projects.other.repo, fs.realpathSync.native(repo));
});

test("the session-start hook speaks inside a worktree", () => {
  const { vault, wt } = setup();
  const r = spawnSync("node", [path.join(ROOT, "hooks/session-start.mjs")], {
    input: JSON.stringify({ cwd: wt, session_id: "s1" }),
    env: { ...process.env, CANON_VAULT: vault },
    encoding: "utf8",
  });
  assert.match(r.stdout, /project \\?"demo\\?"/);
});

test("a separate clone of the repo is not treated as a worktree", () => {
  const { root, vault, repo } = setup();
  const clone = path.join(root, "clone");
  execFileSync("git", ["clone", "-q", repo, clone], { stdio: "ignore" });
  assert.equal(projectForCwd(loadConfig(vault), clone), null);
});
