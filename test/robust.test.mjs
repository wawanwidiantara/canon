import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withLock, writeAtomic } from "../src/fsx.mjs";
import { scrubDeep, scrubSecrets } from "../src/scrub.mjs";
import { buildDigest, saveDigest } from "../src/digest.mjs";
import { addAnchors, findStale, init, mapProject, newDoc, verifySpec } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));

test("six simultaneous `canon new` calls get six different numbers", async () => {
  const vault = tmp();
  init(vault, { git: false });
  const runs = Array.from({ length: 6 }, (_, i) =>
    new Promise((resolve) => {
      const p = spawn("node", [path.join(ROOT, "bin/canon.mjs"), "new", "adr", "demo", `topic-${i}`], { env: { ...process.env, CANON_VAULT: vault } });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out: out.trim() }));
    }),
  );
  const results = await Promise.all(runs);
  assert.ok(results.every((r) => r.code === 0), JSON.stringify(results));
  const nums = fs.readdirSync(path.join(vault, "projects/demo/01_architecture")).map((f) => /adr-(\d+)-/.exec(f)[1]).sort();
  assert.deepEqual(nums, ["001", "002", "003", "004", "005", "006"]);
});

test("a stale lock from a crashed process is taken over; a held lock times out", () => {
  const d = tmp();
  const lock = path.join(d, "locks", "x");
  fs.mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.equal(withLock(lock, () => "ok", { staleMs: 1000 }), "ok");
  fs.mkdirSync(lock);
  assert.throws(() => withLock(lock, () => "no", { waitMs: 80, staleMs: 60000 }), /timed out waiting/);
});

test("writeAtomic replaces content and leaves no temp files", () => {
  const d = tmp();
  const f = path.join(d, "a.md");
  writeAtomic(f, "one");
  writeAtomic(f, "two");
  assert.equal(fs.readFileSync(f, "utf8"), "two");
  assert.deepEqual(fs.readdirSync(d), ["a.md"]);
});

test("secrets are scrubbed, ordinary text is not", () => {
  const fake = (p, n) => p + "a1B2c3D4e5F6g7H8i9J0".repeat(3).slice(0, n);
  const text = [
    `use key ${fake("sk-", 30)} please`,
    `token: ${fake("ghp_", 40)}`,
    "AKIAABCDEFGHIJKLMNOP",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "password=hunter2hunter2",
    "postgres://admin:s3cr3t@db.example.com/app",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----",
  ].join("\n");
  const out = scrubSecrets(text);
  for (const leak of ["a1B2c3D4e5", "AKIAABC", "abcdefghijklmnopqrstuvwxyz0123", "hunter2", "s3cr3t", "eyJhbGci", "MIIEabc"]) assert.ok(!out.includes(leak), leak);
  assert.match(out, /password=<REDACTED>/);
  assert.match(out, /postgres:\/\/<REDACTED>@db\.example\.com/);
  const plain = "fix the login flow in src/auth/Login.php; tokens expire after 5 minutes";
  assert.equal(scrubSecrets(plain), plain);
  assert.deepEqual(scrubDeep({ a: ["token=abc123456", 1], b: { c: "ok" } }), { a: ["token=<REDACTED>", 1], b: { c: "ok" } });
});

test("saved digests never contain pasted secrets", () => {
  const vault = tmp();
  init(vault, { git: false });
  const line = JSON.stringify({ type: "user", sessionId: "s9", timestamp: "2026-01-01T00:00:00Z", origin: { kind: "human" }, message: { role: "user", content: "no, wrong: my key is sk-live_abcdefghijklmnopqrstuvwxyz1234" } });
  const file = saveDigest(vault, "demo", buildDigest(line));
  const saved = fs.readFileSync(file, "utf8");
  assert.ok(!saved.includes("abcdefghijklmnop"));
  assert.match(saved, /<REDACTED>/);
});

test("verify records branch@commit and stale says when the branch changed", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "src/a.php"), "v1");
  git("add", "-A");
  git("commit", "-qm", "i");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "x" });
  fs.writeFileSync(s.file, fs.readFileSync(s.file, "utf8").replace("status: draft", "status: active"));
  addAnchors(vault, s.id, ["src/a.php"]);
  assert.match(fs.readFileSync(s.file, "utf8"), /verified_at: main@[0-9a-f]+/);

  git("checkout", "-q", "-b", "feature");
  fs.writeFileSync(path.join(repo, "src/a.php"), "v2");
  const stale = findStale(vault)[0];
  assert.match(stale.verified_at, /^main@/);
  assert.match(stale.now, /^feature@/);
  const r = spawnSync("node", [path.join(ROOT, "bin/canon.mjs"), "stale"], { env: { ...process.env, CANON_VAULT: vault }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /note: verified on main@[0-9a-f]+, repo is now on feature@[0-9a-f]+; a branch switch can cause this/);
  verifySpec(vault, s.id);
  assert.match(fs.readFileSync(s.file, "utf8"), /verified_at: feature@/);
});
