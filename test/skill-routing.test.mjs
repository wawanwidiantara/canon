import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionBrief } from "../src/context.mjs";
import { init, mapProject } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "skills");
const names = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, "SKILL.md")));
const text = (n) => fs.readFileSync(path.join(SKILLS, n, "SKILL.md"), "utf8");

// The body of a "## <heading>" section, up to the next "## " heading or the end.
const section = (md, heading) => {
  const m = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(md);
  return m ? m[1] : null;
};
const ticked = (s) => [...s.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]);

test("flow names every other skill", () => {
  const table = section(text("flow"), "Which skill when");
  assert.ok(table, "flow has a 'Which skill when' section");
  const named = new Set(ticked(table));
  for (const n of names.filter((n) => n !== "flow")) assert.ok(named.has(n), `flow does not name ${n}`);
});

test("every skill ends with a Next section", () => {
  for (const n of names.filter((n) => n !== "flow")) {
    const md = text(n);
    const next = section(md, "Next");
    assert.ok(next, `${n} has no Next section`);
    assert.ok(ticked(next).some((s) => s !== n && names.includes(s)), `${n}: Next names no other skill`);
    assert.ok(md.trimEnd().endsWith(next.trimEnd()), `${n}: Next is not the last section`);
  }
});

test("routing names only skills that exist", () => {
  // In these sections a lone word in backticks is a skill name; commands have spaces and are ignored.
  for (const n of names) {
    for (const h of ["Which skill when", "Next"]) {
      const s = section(text(n), h);
      if (!s) continue;
      for (const t of ticked(s)) assert.ok(names.includes(t), `${n}: \`${t}\` is not a skill`);
    }
  }
});

test("the session brief points to flow", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  assert.match(sessionBrief(vault, "demo"), /`flow` skill/);
});
