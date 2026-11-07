import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addAnchors, findStale, init, mapProject, newDoc, staleDiff } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function setup() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-sd-")));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  const wt = path.join(root, "repo-wt", "x");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/a.txt"), "line one\nline two\n");
  fs.writeFileSync(path.join(repo, "src/b.txt"), "keep\n");
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
  fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace("status: draft", "status: active"));
  return { root, vault, repo, wt, git, spec: s };
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

test("the stale diff shows the changed lines of each anchored file since the commit the doc was confirmed on", () => {
  const { vault, repo, git, spec } = setup();
  addAnchors(vault, spec.id, ["src/a.txt", "src/b.txt"]);
  fs.writeFileSync(path.join(repo, "src/a.txt"), "line one\nline TWO changed\n");
  git("commit", "-qam", "edit a");
  const out = staleDiff(vault);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, spec.id);
  assert.deepEqual(out[0].files.map((f) => f.path), ["src/a.txt"]);
  assert.match(out[0].files[0].diff, /-line two\n\+line TWO changed/);
});

test("a deleted file is reported as deleted, and a doc with no recorded commit says no comparison is possible", () => {
  const { vault, repo, spec } = setup();
  addAnchors(vault, spec.id, ["src/a.txt"]);
  fs.rmSync(path.join(repo, "src/a.txt"));
  assert.match(staleDiff(vault)[0].files[0].note, /deleted/);

  const f = fs.readFileSync(spec.file, "utf8").replace(/^verified_at: .*\n/m, "");
  fs.writeFileSync(spec.file, f);
  fs.writeFileSync(path.join(repo, "src/a.txt"), "back but different\n");
  assert.match(staleDiff(vault)[0].files[0].note, /no recorded commit/);
});

test("canon stale --diff prints the diff under the stale doc", () => {
  const { vault, repo, git, spec } = setup();
  addAnchors(vault, spec.id, ["src/a.txt"]);
  fs.writeFileSync(path.join(repo, "src/a.txt"), "line one\nline TWO changed\n");
  git("commit", "-qam", "edit a");
  const r = spawnSync("node", [path.join(ROOT, "bin/canon.mjs"), "stale", "--diff"], { env: { ...process.env, CANON_VAULT: vault }, cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /changed src\/a\.txt@[0-9a-f]{12}/);
  assert.match(r.stdout, /\+line TWO changed/);
});

test("a long diff is cut to keep the output small", () => {
  const { vault, repo, git, spec } = setup();
  addAnchors(vault, spec.id, ["src/a.txt"]);
  fs.writeFileSync(path.join(repo, "src/a.txt"), Array.from({ length: 200 }, (_, i) => `row ${i}`).join("\n") + "\n");
  git("commit", "-qam", "big");
  const d = staleDiff(vault)[0].files[0].diff;
  assert.ok(d.split("\n").length <= 62, "at most the cap plus the note");
  assert.match(d, /more lines not shown/);
});

test("anchoring from inside a linked worktree is refused, and works from the main checkout", () => {
  const { vault, wt, spec } = setup();
  assert.throws(() => inDir(wt, () => addAnchors(vault, spec.id, ["src/a.txt"])), /refusing to anchor from inside a worktree[\s\S]*main checkout/);
  assert.deepEqual(findStale(vault), []);
  addAnchors(vault, spec.id, ["src/a.txt"]);
  assert.match(fs.readFileSync(spec.file, "utf8"), /anchors: \["src\/a\.txt@[0-9a-f]{12}"\]/);
});
