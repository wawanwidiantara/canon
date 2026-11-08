import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const skill = (n) => read(`skills/${n}/SKILL.md`);

test("the correct skill is gone and nothing names it", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "skills/correct")));
  const files = execFileSync("git", ["-C", ROOT, "ls-files", "skills", "docs", "README.md", "hooks", "src"], { encoding: "utf8" }).trim().split("\n");
  for (const f of files) assert.doesNotMatch(read(f), /`correct`/, `${f} still names correct`);
});

test("retro covers both evidence sources with one ladder", () => {
  const t = skill("retro");
  assert.match(t, /session digests?/i);
  assert.match(t, /commits?, reverts?/i);
  assert.equal((t.match(/^## .*(ladder|Route each fix)/gim) ?? []).length, 1);
  assert.match(t, /failing on a real past mistake/i);
});

test("vault points to flow for the close-out steps", () => {
  const t = skill("vault");
  assert.doesNotMatch(t, /^## When code changes/m);
  assert.match(t, /`flow`/);
});

test("ub-mode keeps only its own principles", () => {
  const t = skill("ub-mode");
  assert.ok(t.trimEnd().split("\n").length <= 30, "ub-mode is longer than 30 lines");
  assert.doesNotMatch(t, /^## Practice/m);
});

test("grilling points to domain-model for the ADR test", () => {
  assert.match(skill("grilling"), /`domain-model`/);
});
