import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentDenial } from "../src/gate.mjs";
import { sessionBrief } from "../src/context.mjs";
import { init, mapProject } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));

function agentFile() {
  const text = read("agents/spec-reviewer.md");
  const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(fm, "agent file has frontmatter");
  const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1])?.[1].trim();
  return { name: field("name"), tools: (field("tools") ?? "").split(",").map((t) => t.trim()), body: fm[2] };
}

test("spec-reviewer agent has a read-only toolset and a cold-read prompt", () => {
  const a = agentFile();
  assert.equal(a.name, "spec-reviewer");
  for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) assert.ok(!a.tools.includes(t), `${t} must not be allowed`);
  assert.match(a.body, /depends_on/);
  assert.match(a.body, /never read (the )?code|do not read (the )?code/i);
});

test("spec-reviewer is blocked unless agents.spec-reviewer is exactly true", () => {
  assert.match(agentDenial({}, "canon:spec-reviewer"), /agents\.spec-reviewer/);
  assert.equal(agentDenial({ agents: { "spec-reviewer": true } }, "canon:spec-reviewer"), null);
  assert.notEqual(agentDenial({ agents: { "spec-reviewer": "yes" } }, "canon:spec-reviewer"), null);
});

test("a new vault leaves spec-reviewer off", () => {
  const vault = path.join(tmp(), "vault");
  init(vault, { git: false });
  const cfg = JSON.parse(fs.readFileSync(path.join(vault, "canon.config.json"), "utf8"));
  assert.equal(cfg.agents["spec-reviewer"], false);
});

test("enabling the post-build reviewer does not enable spec-reviewer", () => {
  assert.notEqual(agentDenial({ agents: { reviewer: true } }, "canon:spec-reviewer"), null);
});

test("the session brief lists spec-reviewer only when it is enabled", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  assert.doesNotMatch(sessionBrief(vault, "demo"), /canon:spec-reviewer/);
  const cfgPath = path.join(vault, "canon.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.agents["spec-reviewer"] = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  assert.match(sessionBrief(vault, "demo"), /canon:spec-reviewer/);
});

test("spec-reviewer reports one line per finding and a ready or fix first verdict", () => {
  const { body } = agentFile();
  assert.match(body, /Verdict: ready \| fix first/);
  assert.match(body, /one line per finding/i);
  assert.match(body, /do not praise/i);
});

test("the flow skill spawns spec-reviewer after a new spec is filled and before approve", () => {
  const flow = read("skills/flow/SKILL.md");
  const step4 = /4\. \*\*Spec\.\*\*[\s\S]*?\n5\. /.exec(flow)?.[0] ?? "";
  assert.match(step4, /canon:spec-reviewer/);
  assert.ok(step4.indexOf("canon:spec-reviewer") < step4.indexOf("canon approve"), "review comes before approve");
  assert.match(step4, /session brief lists/i);
});

test("the flow skill skips the review for small edits and when the agent is off", () => {
  const step4 = /4\. \*\*Spec\.\*\*[\s\S]*?\n5\. /.exec(read("skills/flow/SKILL.md"))?.[0] ?? "";
  assert.match(step4, /small edit/i);
  assert.match(step4, /not listed/i);
  assert.match(step4, /do not ask the user to enable it/i);
});

test("the flow skill stops, and never reviews in the main session, when a fresh subagent cannot start", () => {
  const step4 = /4\. \*\*Spec\.\*\*[\s\S]*?\n5\. /.exec(read("skills/flow/SKILL.md"))?.[0] ?? "";
  assert.match(step4, /cannot (start|be started)/i);
  assert.match(step4, /stop/i);
  assert.match(step4, /never (run|review)[^.]*main session/i);
});
