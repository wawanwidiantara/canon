import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDigest, loadDigests, markRetroDone, retroReport, saveDigest } from "../src/digest.mjs";
import { sessionBrief } from "../src/context.mjs";
import { init, mapProject } from "../src/ops.mjs";

const rec = (o) => JSON.stringify({ sessionId: "s1", cwd: "/r", ...o });
const asst = (id, blocks) => rec({ type: "assistant", timestamp: "2026-11-06T10:00:01Z", message: { id, role: "assistant", content: blocks, usage: { input_tokens: 1, output_tokens: 1 } } });
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const human = (t) => rec({ type: "user", timestamp: "2026-11-06T10:00:00Z", origin: { kind: "human" }, message: { role: "user", content: t } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));

const transcript = [
  human("go"),
  asst("m1", [use("a", "Skill", { skill: "canon:flow" }), use("b", "Skill", { skill: "canon:tdd" })]),
  asst("m2", [use("c", "Skill", { skill: "canon:flow" }), use("d", "Agent", { subagent_type: "canon:spec-reviewer", prompt: "x" }), use("e", "Task", { subagent_type: "Explore" })]),
].join("\n");

const digestWith = (id, corrections, extra = {}) => ({
  session_id: id, title: "t", started: "2026-11-06T10:00:00Z", ended: "2026-11-06T11:00:00Z", human_turns: 4,
  tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 }, tools: {}, edited: [],
  corrections: Array.from({ length: corrections }, (_, i) => `no, wrong ${i}`), errors: [], repeated_reads: [], big_results: [], ...extra,
});

function mapped() {
  const vault = tmp();
  const repo = tmp();
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  return vault;
}

test("the digest counts each skill and subagent type", () => {
  const d = buildDigest(transcript);
  assert.deepEqual(d.used.skills, { "canon:flow": 2, "canon:tdd": 1 });
  assert.deepEqual(d.used.agents, { "canon:spec-reviewer": 1, Explore: 1 });
  assert.deepEqual(buildDigest(human("hi")).used, { skills: {}, agents: {} });
});

test("the retro report lists skills and subagents and old digests still load", () => {
  const a = buildDigest(transcript);
  const b = digestWith("old", 0); // written before the field existed
  const rep = retroReport([a, b]);
  assert.match(rep, /Skills used \([^)]*\):[\s\S]*canon:flow 2/);
  assert.match(rep, /Subagents used \([^)]*\):[\s\S]*canon:spec-reviewer 1/);
  assert.doesNotMatch(retroReport([b]), /Skills used|Subagents used/);
  const vault = tmp();
  init(vault, { git: false });
  saveDigest(vault, "demo", b);
  assert.equal(loadDigests(vault, "demo").length, 1);
});

test("the session brief says a retro is due after three corrections", () => {
  const vault = mapped();
  saveDigest(vault, "demo", digestWith("a", 2));
  saveDigest(vault, "demo", digestWith("b", 1));
  assert.match(sessionBrief(vault, "demo"), /retro is due: 2 sessions, 3 corrections/i);
});

test("the session brief is quiet below three corrections", () => {
  const vault = mapped();
  assert.doesNotMatch(sessionBrief(vault, "demo"), /retro is due/i);
  saveDigest(vault, "demo", digestWith("a", 2));
  assert.doesNotMatch(sessionBrief(vault, "demo"), /retro is due/i);
  saveDigest(vault, "demo", digestWith("b", 1));
  assert.match(sessionBrief(vault, "demo"), /retro is due/i);
  markRetroDone(vault, "demo");
  assert.doesNotMatch(sessionBrief(vault, "demo"), /retro is due/i, "a finished retro clears the line");
});
