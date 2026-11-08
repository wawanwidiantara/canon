import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const flow = () => read("skills/flow/SKILL.md");

test("the ub-mode skill is gone and nothing names it", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "skills/ub-mode")));
  const files = execFileSync("git", ["-C", ROOT, "ls-files", "skills", "docs", "hooks", "src", ".claude-plugin"], { encoding: "utf8" }).trim().split("\n");
  for (const f of files) assert.doesNotMatch(read(f).replaceAll("unclebob/ub-mode", ""), /ub-mode/, `${f} still names ub-mode`);
});

test("flow build step states the five habits", () => {
  const m = /^6\. \*\*Build\.\*\*[\s\S]*?(?=^7\. )/m.exec(flow());
  assert.ok(m, "flow has a Build step");
  for (const re of [/first principles/i, /subtract before you add/i, /attack the premise/i, /idempotent/i, /one writer/i])
    assert.match(m[0], re);
});

test("flow credits the author of the habits", () => {
  assert.match(flow(), /unclebob\/ub-mode/);
});
