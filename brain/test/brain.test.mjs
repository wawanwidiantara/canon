import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "../src/frontmatter.mjs";
import { parseBehaviors, updateBehavior } from "../src/markdown.mjs";
import { validate } from "../src/validate.mjs";
import { addAnchors, findStale, init, mapProject, markStale, newDoc, setTask, verifySpec } from "../src/ops.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/login.php"), "<?php // v1\n");
  fs.writeFileSync(path.join(repo, "tests/LoginTest.php"), "<?php // test\n");
  init(vault);
  mapProject(vault, "demo", repo);
  return { vault, repo };
}

function fillSpec(file) {
  let t = fs.readFileSync(file, "utf8");
  t = t
    .replace(/## Goal\n\n<!--.*?-->/s, "## Goal\n\nUsers can log in.")
    .replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: valid credentials log in\n- [ ] B2: bad password is rejected")
    .replace(/## Implementation Decisions\n\n<!--.*?-->/s, "## Implementation Decisions\n\nAuth module owns sessions.")
    .replace(/## Testing Decisions\n\n<!--.*?-->/s, "## Testing Decisions\n\nTest through the HTTP seam only.")
    .replace(/## Non-goals\n\n<!--.*?-->/s, "## Non-goals\n\nSSO.")
    .replace("status: draft", "status: active");
  fs.writeFileSync(file, t);
}

test("frontmatter round-trips", () => {
  const data = { id: "a-b", type: "spec", project: "a", stack: ["php"], status: "draft", depends_on: ["[[x]]"], anchors: [] };
  const text = stringify(data, "\n# T\n");
  assert.deepEqual(parse(text).data, data);
});

test("new scaffolds a valid draft with numbered id", () => {
  const { vault } = fixture();
  const a = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  const b = newDoc(vault, { type: "spec", project: "demo", slug: "logout" });
  assert.equal(a.id, "demo-spec-001-login");
  assert.equal(b.id, "demo-spec-002-logout");
  assert.deepEqual(validate(vault), []);
});

test("new rejects bad slug and wrong global use", () => {
  const { vault } = fixture();
  assert.throws(() => newDoc(vault, { type: "spec", project: "demo", slug: "Bad Slug" }), /kebab/);
  assert.throws(() => newDoc(vault, { type: "spec", project: "global", slug: "x" }), /global/);
  assert.equal(newDoc(vault, { type: "global-rule", project: "global", slug: "no-secrets" }).id, "no-secrets");
});

test("validate flags empty sections on active docs", () => {
  const { vault } = fixture();
  const { file } = newDoc(vault, { type: "adr", project: "demo", slug: "pick-db" });
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: draft", "status: active"));
  const f = validate(vault);
  assert.ok(f.some((x) => x.includes("'## Decision' is empty")));
});

test("validate flags broken wikilink, id mismatch, missing section", () => {
  const { vault } = fixture();
  const { file } = newDoc(vault, { type: "adr", project: "demo", slug: "x", depends: ["nope"] });
  let t = fs.readFileSync(file, "utf8").replace("id: demo-adr-001-x", "id: demo-adr-009-x");
  t = t.replace("## Consequences", "## Other");
  fs.writeFileSync(file, t);
  const f = validate(vault).join("\n");
  assert.match(f, /does not match filename/);
  assert.match(f, /\[\[nope\]\] does not resolve/);
  assert.match(f, /missing section '## Consequences'/);
});

test("behaviors parse and update", () => {
  const body = "## Behaviors\n\n- [ ] B1: a thing\n- [x] B2: other (test: t.php::x)\n";
  const { items } = parseBehaviors(body);
  assert.equal(items[1].state, "done");
  assert.equal(items[1].test, "t.php::x");
  const next = updateBehavior(body, "B1", { state: "doing" });
  assert.equal(parseBehaviors(next).items[0].state, "doing");
  assert.throws(() => updateBehavior(body, "B9", { state: "done" }), /not found/);
});

test("task done requires an existing test file", () => {
  const { vault } = fixture();
  const { id, file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(file);
  assert.throws(() => setTask(vault, id, "B1", "done"), /needs a test/);
  assert.throws(() => setTask(vault, id, "B1", "done", "tests/Missing.php::x"), /test file not found/);
  setTask(vault, id, "B1", "done", "tests/LoginTest.php::logs in");
  assert.deepEqual(validate(vault), []);
});

test("active spec with no behaviors is rejected", () => {
  const { vault } = fixture();
  const { file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(file);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/- \[ \] B\d.*\n?/g, "x\n"));
  assert.ok(validate(vault).some((x) => x.includes("bad behavior line")));
});

test("stale check: changed code flags spec, verify clears it", () => {
  const { vault, repo } = fixture();
  const { id, file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(file);
  addAnchors(vault, id, ["src/login.php"]);
  assert.deepEqual(findStale(vault), []);

  fs.writeFileSync(path.join(repo, "src/login.php"), "<?php // v2\n");
  const stale = findStale(vault);
  assert.equal(stale[0].problems[0].kind, "changed");

  markStale(vault);
  assert.match(fs.readFileSync(file, "utf8"), /status: needs-review/);
  assert.deepEqual(findStale(vault), []); // needs-review specs are not re-reported

  verifySpec(vault, id);
  assert.match(fs.readFileSync(file, "utf8"), /status: active/);
  assert.deepEqual(findStale(vault), []);
});

test("stale check reports a deleted anchored file", () => {
  const { vault, repo } = fixture();
  const { id, file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(file);
  addAnchors(vault, id, ["src/login.php"]);
  fs.rmSync(path.join(repo, "src/login.php"));
  assert.equal(findStale(vault)[0].problems[0].kind, "missing");
});

test("phase refs must point at real spec behaviors", () => {
  const { vault } = fixture();
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(spec.file);
  const phase = newDoc(vault, { type: "phase", project: "demo", slug: "p1", depends: [spec.id] });
  let t = fs.readFileSync(phase.file, "utf8");
  t = t.replace(/## Behaviors\n\n<!--.*?-->/s, `## Behaviors\n\n- [[${spec.id}#B1]]\n- [[${spec.id}#B7]]`);
  fs.writeFileSync(phase.file, t);
  const f = validate(vault).join("\n");
  assert.match(f, /spec has no behavior B7/);
  assert.doesNotMatch(f, /B1\]\]: spec has no/);
});

test("spec prose rejects file paths and code fences, allows urls and prototype fences", () => {
  const { vault } = fixture();
  const { file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(file);
  const base = fs.readFileSync(file, "utf8");

  const bad = base.replace("Auth module owns sessions.", "Edit src/Auth/Login.php to add it.\n\n```php\necho 1;\n```");
  fs.writeFileSync(file, bad);
  const f = validate(vault).join("\n");
  assert.match(f, /contains a file path/);
  assert.match(f, /has a code fence/);

  const ok = base.replace(
    "Auth module owns sessions.",
    "See https://example.com/docs/guide.html for background.\n\n```prototype\ntype State = 'a' | 'b'\n```",
  );
  fs.writeFileSync(file, ok);
  assert.deepEqual(validate(vault), []);
});

test("behavior test links may contain paths", () => {
  const { vault } = fixture();
  const { id, file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fillSpec(file);
  setTask(vault, id, "B1", "done", "tests/LoginTest.php::logs in");
  assert.deepEqual(validate(vault), []);
});
