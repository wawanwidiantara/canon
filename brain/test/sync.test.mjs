import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile } from "../src/anchors.mjs";
import { resolveProject, sessionBrief } from "../src/context.mjs";
import { buildDigest, digestDir, loadDigests, saveDigest } from "../src/digest.mjs";
import { init, mapProject, newDoc } from "../src/ops.mjs";
import { normalizeRemote } from "../src/remote.mjs";
import { pullIfDue, pullVault, setupDevice, syncVault, vaultState } from "../src/sync.mjs";
import { loadConfig, loadLocal } from "../src/vault.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "brains-"));
const git = (d, ...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const ident = (d) => (git(d, "config", "user.email", "t@t"), git(d, "config", "user.name", "t"));

test("normalizeRemote: ssh, ssh aliases, https and ports all agree", () => {
  const want = "github.com/wawanwidiantara/agent-docs";
  for (const u of ["git@github.com-personal:wawanwidiantara/agent-docs.git", "git@github.com:WawanWidiantara/Agent-Docs", "https://github.com/wawanwidiantara/agent-docs.git", "https://user:tok@github.com/wawanwidiantara/agent-docs/", "ssh://git@github.com/wawanwidiantara/agent-docs.git"]) {
    assert.equal(normalizeRemote(u), want, u);
  }
  assert.equal(normalizeRemote(""), null);
  assert.equal(normalizeRemote("not a url"), null);
  assert.notEqual(normalizeRemote("git@github.com:a/b.git"), normalizeRemote("git@gitlab.com:a/b.git"));
});

test("anchor hashes ignore CRLF so Windows and Linux checkouts agree; binary stays exact", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "lf.php"), "<?php\necho 1;\n");
  fs.writeFileSync(path.join(d, "crlf.php"), "<?php\r\necho 1;\r\n");
  assert.equal(hashFile(path.join(d, "lf.php")), hashFile(path.join(d, "crlf.php")));
  fs.writeFileSync(path.join(d, "a.bin"), Buffer.from([0, 1, 13, 10, 2]));
  fs.writeFileSync(path.join(d, "b.bin"), Buffer.from([0, 1, 10, 2]));
  assert.notEqual(hashFile(path.join(d, "a.bin")), hashFile(path.join(d, "b.bin")));
});

test("repo paths stay out of the shared config and live in .brain/local.json", () => {
  const root = tmp();
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q");
  git(repo, "remote", "add", "origin", "git@github.com-personal:me/app.git");
  const vault = path.join(root, "vault");
  init(vault);
  assert.equal(mapProject(vault, "app", repo), "github.com/me/app");
  const shared = JSON.parse(fs.readFileSync(path.join(vault, "brain.config.json"), "utf8"));
  assert.deepEqual(shared.projects.app, { remote: "github.com/me/app" });
  assert.equal(loadLocal(vault).projects.app.repo, path.resolve(repo));
  assert.equal(loadConfig(vault).projects.app.repo, path.resolve(repo));
  assert.match(fs.readFileSync(path.join(vault, ".gitignore"), "utf8"), /\.brain\//);
});

test("another device finds the repo by its remote, no manual mapping", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  init(vault);
  const cfgPath = path.join(vault, "brain.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.projects.app = { remote: "github.com/me/app" }; // as pulled from another device
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));

  const clone = path.join(root, "clone");
  fs.mkdirSync(path.join(clone, "src"), { recursive: true });
  git(clone, "init", "-q");
  git(clone, "remote", "add", "origin", "https://github.com/Me/App.git");
  assert.equal(resolveProject(vault, path.join(clone, "src")), "app");
  assert.equal(loadConfig(vault).projects.app.repo, fs.realpathSync(clone) === clone ? clone : path.resolve(git(clone, "rev-parse", "--show-toplevel").trim()));
  assert.equal(resolveProject(vault, path.join(clone, "src")), "app"); // now by path

  const other = path.join(root, "other-clone"); // a second clone is not guessed at
  fs.mkdirSync(other);
  git(other, "init", "-q");
  git(other, "remote", "add", "origin", "https://github.com/me/app.git");
  assert.equal(resolveProject(vault, other), null);

  const stranger = path.join(root, "stranger");
  fs.mkdirSync(stranger);
  git(stranger, "init", "-q");
  git(stranger, "remote", "add", "origin", "https://github.com/me/unrelated.git");
  assert.equal(resolveProject(vault, stranger), null);
  assert.equal(resolveProject(vault, os.tmpdir()), null);
});

test("init makes a git repo with a README; setup records the vault per device", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  init(vault);
  assert.ok(fs.existsSync(path.join(vault, ".git")));
  assert.match(fs.readFileSync(path.join(vault, "README.md"), "utf8"), /Keep this repository private/);
  init(path.join(root, "plain"), { git: false });
  assert.ok(!fs.existsSync(path.join(root, "plain", ".git")));

  const home = tmp();
  const r = setupDevice(vault, { env: {}, platform: "linux", home });
  assert.equal(fs.readFileSync(r.file, "utf8").trim(), path.resolve(vault));
  assert.equal(r.file, path.join(home, ".config", "brain", "vault"));
  assert.throws(() => setupDevice(root, { env: {}, platform: "linux", home }), /not a vault/);
});

function twoDevices() {
  const root = tmp();
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(remote);
  git(remote, "init", "-q", "--bare", "-b", "main");
  const a = path.join(root, "a");
  init(a);
  ident(a);
  git(a, "remote", "add", "origin", remote);
  git(a, "add", "-A");
  git(a, "commit", "-qm", "init");
  git(a, "push", "-q", "-u", "origin", "main");
  const b = path.join(root, "b");
  execFileSync("git", ["clone", "-q", remote, b]);
  ident(b);
  return { a, b };
}

test("two devices: sync publishes on A, session-start pull brings it to B", () => {
  const { a, b } = twoDevices();
  const doc = newDoc(a, { type: "adr", project: "demo", slug: "pick-db" });
  const log = syncVault(a);
  assert.deepEqual(log, ["committed 1 change(s)", "pulled", "pushed"]);
  assert.equal(vaultState(a).dirty, 0);

  assert.deepEqual(pullVault(b), { ok: true });
  assert.ok(fs.existsSync(path.join(b, "projects/demo/01_architecture", `${doc.id}.md`)));
  assert.deepEqual(pullVault(b), { ok: true }); // nothing new is fine
});

test("pull never touches local edits and says why it skipped", () => {
  const { a, b } = twoDevices();
  newDoc(a, { type: "adr", project: "demo", slug: "one" });
  syncVault(a);
  newDoc(b, { type: "adr", project: "demo", slug: "mine" }); // uncommitted on B
  const r = pullVault(b);
  assert.equal(r.ok, false);
  assert.match(r.skipped, /1 uncommitted change\(s\); run `brain sync`/);
  assert.ok(fs.readdirSync(path.join(b, "projects/demo/01_architecture")).some((f) => f.includes("mine")));
  assert.equal(pullVault(tmp()).skipped, "vault is not a git repo");
});

test("diverged edits rebase cleanly; a real conflict aborts and keeps your commit", () => {
  const { a, b } = twoDevices();
  const f = (d) => path.join(d, "projects/demo/01_architecture");
  newDoc(a, { type: "adr", project: "demo", slug: "from-a" });
  syncVault(a);
  newDoc(b, { type: "adr", project: "demo", slug: "from-b" });
  assert.deepEqual(syncVault(b).slice(-2), ["pulled", "pushed"]); // different files: rebase works
  assert.equal(fs.readdirSync(f(b)).length, 2);

  fs.writeFileSync(path.join(a, "README.md"), "A's version\n");
  fs.writeFileSync(path.join(b, "README.md"), "B's version\n");
  syncVault(a);
  assert.throws(() => syncVault(b), /conflict[\s\S]*safe, committed locally/);
  assert.equal(git(b, "status", "--porcelain").trim(), ""); // rebase aborted, tree clean
  assert.match(fs.readFileSync(path.join(b, "README.md"), "utf8"), /B's version/);
});

test("pullIfDue is rate limited; session brief reports sync trouble and unpushed work", () => {
  const { a } = twoDevices();
  const first = pullIfDue(a, { minutes: 10 });
  assert.deepEqual(first, { ok: true });
  assert.equal(pullIfDue(a, { minutes: 10 }), null);
  fs.writeFileSync(path.join(a, "brain.config.json"), JSON.stringify({ projects: { demo: {} } }));
  mapProject(a, "demo", a);
  assert.match(sessionBrief(a, "demo", { pull: { ok: false, skipped: "pull timed out" } }), /Vault sync: pull timed out\./);
  git(a, "add", "-A");
  git(a, "commit", "-qm", "local");
  assert.match(sessionBrief(a, "demo"), /1 commit\(s\) not pushed/);
});

test("digests stay on the device by default and move into the vault when sync.digests is on", () => {
  const vault = tmp();
  init(vault);
  const d = buildDigest(JSON.stringify({ type: "user", sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", origin: { kind: "human" }, message: { role: "user", content: "hello" } }));
  saveDigest(vault, "demo", d);
  assert.ok(fs.existsSync(path.join(vault, ".brain/digests/demo/s1.json")));
  const cfgPath = path.join(vault, "brain.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.sync.digests = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  d.session_id = "s2";
  saveDigest(vault, "demo", d);
  assert.equal(digestDir(vault, "demo"), path.join(vault, "digests", "demo"));
  assert.ok(fs.existsSync(path.join(vault, "digests/demo/s2.json")));
  assert.deepEqual(loadDigests(vault, "demo").map((x) => x.session_id).sort(), ["s1", "s2"]);
});

test("session-start hook pulls from the remote before building the brief", () => {
  const { a, b } = twoDevices();
  const cfgOf = (d) => path.join(d, "brain.config.json");
  const repo = tmp();
  git(repo, "init", "-q");
  git(repo, "remote", "add", "origin", "git@github.com:me/app.git");
  mapProject(a, "demo", repo);
  git(a, "add", "-A");
  git(a, "commit", "-qm", "map");
  newDoc(a, { type: "spec", project: "demo", slug: "fresh" });
  syncVault(a);
  const run = (vault) =>
    spawnSync("node", [path.join(ROOT, "hooks/session-start.mjs")], { input: JSON.stringify({ cwd: repo }), env: { ...process.env, BRAIN_VAULT: vault }, encoding: "utf8" });
  const out = JSON.parse(run(b).stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /demo-spec-001-fresh/); // arrived by pull
  assert.ok(fs.existsSync(cfgOf(b)));
});
