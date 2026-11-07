import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDigest, loadDigests, markRetroDone, lastRetro, retroReport, saveDigest } from "../src/digest.mjs";
import { init, mapProject } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rec = (o) => JSON.stringify({ sessionId: "sess-1", cwd: "/r", gitBranch: "main", ...o });
const human = (t, ts) => rec({ type: "user", timestamp: ts, origin: { kind: "human" }, message: { role: "user", content: t } });
const asst = (id, blocks, usage, ts = "2026-11-06T10:00:01Z") =>
  rec({ type: "assistant", timestamp: ts, message: { id, role: "assistant", content: blocks, usage } });
const result = (id, content, is_error = false) =>
  rec({ type: "user", timestamp: "2026-11-06T10:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
const use = (id, name, input) => ({ type: "tool_use", id, name, input });

const transcript = [
  rec({ type: "ai-title", aiTitle: "Add login" }),
  human("build the login spec", "2026-11-06T10:00:00Z"),
  asst("m1", [use("t1", "Read", { file_path: "/r/a.php" })], { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
  asst("m1", [use("t2", "Read", { file_path: "/r/a.php" })], { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
  result("t1", "ok"),
  result("t2", "ok"),
  asst("m2", [use("t3", "Read", { file_path: "/r/a.php" }), use("t4", "Bash", { command: "npm test" }), use("t5", "Edit", { file_path: "/r/b.php" })], { input_tokens: 4, output_tokens: 9 }),
  result("t4", "FAIL tests/LoginTest\nexpected 1 got 2", true),
  result("t3", "x".repeat(25000)),
  human("no, that is the wrong file, use the other one", "2026-11-06T10:05:00Z"),
  human("<system-reminder>ignore</system-reminder>", "2026-11-06T10:05:01Z"),
  human("looks good", "2026-11-06T10:06:00Z"),
  "not json",
].join("\n");

test("buildDigest: tokens deduped by message id, tools, errors, corrections, reads", () => {
  const d = buildDigest(transcript);
  assert.equal(d.session_id, "sess-1");
  assert.equal(d.title, "Add login");
  assert.equal(d.human_turns, 3);
  assert.deepEqual(d.tokens, { input: 14, output: 16, cache_read: 100, cache_write: 50 });
  assert.equal(d.tools.Read, 3);
  assert.deepEqual(d.edited, ["/r/b.php"]);
  assert.deepEqual(d.corrections, ["no, that is the wrong file, use the other one"]);
  assert.equal(d.errors.length, 1);
  assert.deepEqual(d.errors[0], { tool: "Bash", what: "npm test", message: "FAIL tests/LoginTest" });
  assert.deepEqual(d.repeated_reads, [{ file: "/r/a.php", reads: 3 }]);
  assert.deepEqual(d.big_results, [{ tool: "Read", chars: 25000 }]);
  assert.equal(d.started, "2026-11-06T10:00:00Z");
});

test("save, load since marker, retro report", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  init(vault);
  const d = buildDigest(transcript);
  saveDigest(vault, "demo", d);
  assert.equal(loadDigests(vault, "demo").length, 1);
  const rep = retroReport(loadDigests(vault, "demo"));
  assert.match(rep, /Sessions: 1/);
  assert.match(rep, /User corrections/);
  assert.match(rep, /1x Bash: npm test -> FAIL tests\/LoginTest/);
  assert.match(rep, /a\.php/);
  markRetroDone(vault, "demo");
  assert.ok(lastRetro(vault, "demo"));
  assert.equal(loadDigests(vault, "demo", lastRetro(vault, "demo")).length, 0);
  assert.match(retroReport([]), /No new session digests/);
});

test("session-end hook saves a digest for a mapped repo, nothing elsewhere", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  init(vault);
  mapProject(vault, "demo", repo);
  const tp = path.join(root, "t.jsonl");
  fs.writeFileSync(tp, transcript);
  const run = (cwd) =>
    spawnSync("node", [path.join(ROOT, "hooks/session-end.mjs")], {
      input: JSON.stringify({ cwd, session_id: "sess-1", transcript_path: tp }),
      env: { ...process.env, CANON_VAULT: vault },
      encoding: "utf8",
    });
  assert.equal(run(os.tmpdir()).status, 0);
  assert.equal(loadDigests(vault, "demo").length, 0);
  assert.equal(run(repo).status, 0);
  assert.equal(loadDigests(vault, "demo").length, 1);
});
