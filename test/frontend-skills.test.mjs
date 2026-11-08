import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = (n) => fs.readFileSync(path.join(ROOT, "skills", n, "SKILL.md"), "utf8");
const section = (md, heading) => {
  const m = new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(md);
  return m ? m[1] : null;
};
const bullets = (s) => (s ?? "").split("\n").filter((l) => /^- /.test(l));

test("the frontend skill starts from a reference and a token plan", () => {
  const t = skill("frontend");
  assert.match(t, /^name: frontend$/m);
  assert.match(t, /reference/i);
  assert.match(t, /never a blank page/i);
  assert.match(t, /canon query design-system/);
  assert.match(t, /token plan/i);
  assert.match(t, /before (you write )?(any )?code/i);
  assert.match(t, /new screen/i);
});

test("the frontend skill describes a design-system doc anchored to the token file", () => {
  const t = skill("frontend");
  assert.match(t, /canon new context <project> design-system/);
  assert.match(t, /canon anchor/);
  assert.match(t, /token file/i);
  assert.match(t, /stale/i);
  assert.match(t, /no raw (colors?|hex)/i);
});

test("the frontend skill requires states, widths and real content", () => {
  const t = skill("frontend");
  assert.match(t, /empty, loading, error/i);
  for (const w of ["375", "768", "1280"]) assert.match(t, new RegExp(w));
  assert.match(t, /real content/i);
  assert.match(t, /lorem/i);
});

test("the frontend skill lists the tells, the copy rules and the accessibility floor", () => {
  const t = skill("frontend");
  assert.ok(bullets(section(t, "Tells to avoid")).length >= 10, "at least ten tells");
  for (const re of [/purple/i, /identical/i, /emoji/i, /lorem|filler/i, /eyebrow|all-caps/i]) assert.match(section(t, "Tells to avoid"), re);
  const copy = section(t, "Copy");
  assert.match(copy, /Save changes/);
  assert.match(copy, /sentence case/i);
  assert.match(copy, /active voice/i);
  const a11y = section(t, "Accessibility floor");
  for (const re of [/focus/i, /keyboard/i, /contrast/i, /label/i, /reduced motion/i]) assert.match(a11y, re);
});

test("the frontend skill keeps browser tests optional and detectors private", () => {
  const t = skill("frontend");
  assert.match(t, /do not add browser tests to a project that has not asked/i);
  assert.match(t, /canon confirm/);
  assert.match(t, /telemetry/i);
});

test("the ui-review skill stress-tests with a realistic dataset and reports before fixing", () => {
  const t = skill("ui-review");
  assert.match(t, /^name: ui-review$/m);
  assert.match(t, /same (data )?(path|boundary)/i);
  assert.match(t, /report before (you )?fix/i);
  for (const sev of ["Broken", "Ugly", "Fragile"]) assert.match(t, new RegExp(sev));
  assert.match(t, /file:line|fix location/i);
  for (const re of [/names?/i, /unbreakable|long/i, /missing/i, /zero/i, /money/i, /dates?/i, /images?/i, /RTL/, /320/, /200% zoom/i, /dark mode/i]) assert.match(t, re);
  assert.match(t, /plausible/i);
  assert.match(t, /never ships?/i);
});

test("the ui-review skill separates verified from inferred findings", () => {
  const t = skill("ui-review");
  assert.match(t, /verified/i);
  assert.match(t, /inferred/i);
  assert.match(t, /regression test/i);
  assert.match(t, /project (that )?runs tests/i);
});

test("the flow skill routes to the new skills and the sources are credited", () => {
  const flow = skill("flow");
  const table = section(flow, "Which skill when");
  assert.match(table, /`frontend`/);
  assert.match(table, /`ui-review`/);
  assert.match(skill("frontend"), /anthropics\/skills/);
  assert.match(skill("ui-review"), /emilkowalski\/skills/);
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /anthropics\/skills/);
  assert.match(readme, /emilkowalski\/skills/);
});
