import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inWorktree, mainRepoFor } from "../src/anchors.mjs";
import { approve, init, mapProject, newDoc } from "../src/ops.mjs";
import { claim, release } from "../src/packets.mjs";
import { loadConfig } from "../src/vault.mjs";

function setup() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-main-")));
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

function phase(vault, slug, owns) {
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: `s-${slug}` });
  fs.writeFileSync(spec.file, fs.readFileSync(spec.file, "utf8").replace("status: draft", "status: active").replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: x"));
  const p = newDoc(vault, { type: "phase", project: "demo", slug });
  let t = fs.readFileSync(p.file, "utf8");
  t = t.replace("owns: []", `owns: ${JSON.stringify(owns)}`);
  t = t.replace(/## Objective\n\n<!--.*?-->/s, "## Objective\n\nx").replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${spec.id}#B1]]`).replace(/## Dependencies\n\n<!--.*?-->/s, "## Dependencies\n\nnone");
  fs.writeFileSync(p.file, t);
  approve(vault, p.id);
  return p;
}

const inDir = (dir, fn) => {
  const here = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(here);
  }
};

test("the main checkout is found by one rule, from the main checkout and from inside a linked worktree", () => {
  const { vault, repo } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  const c = claim(vault, a.id);
  const config = loadConfig(vault);
  assert.equal(mainRepoFor(config, "demo"), repo);
  assert.equal(inDir(c.worktree, () => mainRepoFor(config, "demo")), repo);
  assert.equal(mainRepoFor(config, "nope"), null);
  assert.equal(inWorktree(config, "demo"), false);
  assert.equal(inDir(c.worktree, () => inWorktree(config, "demo")), true);
});

test("claim and release work the same from inside a linked worktree: the new worktree sits next to the main checkout", () => {
  const { root, vault, repo } = setup();
  const a = phase(vault, "auth", ["src/auth/"]);
  const b = phase(vault, "billing", ["src/billing/"]);
  const first = claim(vault, a.id);
  const second = inDir(first.worktree, () => claim(vault, b.id));
  assert.equal(second.worktree, path.join(root, "repo-wt", b.id));
  assert.equal(second.base_sha, execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  inDir(first.worktree, () => release(vault, b.id, { removeWorktree: true }));
  assert.ok(!fs.existsSync(second.worktree));
});
