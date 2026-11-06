import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addAnchors, init, mapProject, newDoc } from "../src/ops.mjs";
import { buildIndex, dependencies, dependents, governs, indexPath, listActive, openBehaviors, search, show } from "../src/index.mjs";

function fill(file, edits, status = "active") {
  let t = fs.readFileSync(file, "utf8");
  for (const [h, body] of Object.entries(edits)) t = t.replace(new RegExp(`## ${h}\\n\\n<!--.*?-->`, "s"), `## ${h}\n\n${body}`);
  fs.writeFileSync(file, t.replace("status: draft", `status: ${status}`));
}

function vaultWithDocs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brainx-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/login.php"), "x");
  init(vault);
  mapProject(vault, "demo", repo);
  const adr = newDoc(vault, { type: "adr", project: "demo", slug: "passwordless" });
  fill(adr.file, { Context: "Passwords get reused and leaked.", Decision: "We will use emailed magic links.", Consequences: "Needs reliable email delivery." });
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: "login", depends: [adr.id] });
  fill(spec.file, {
    Goal: "Employees can sign in through an emailed link.",
    Behaviors: "- [x] B1: link signs the user in (test: t.php::a)\n- [ ] B2: expired link is rejected",
    "Implementation Decisions": "Auth module issues single-use tokens.",
    "Testing Decisions": "HTTP seam only.",
    "Non-goals": "SSO.",
  });
  addAnchors(vault, spec.id, ["src/login.php"]);
  const other = newDoc(vault, { type: "spec", project: "demo", slug: "billing" });
  fill(other.file, { Goal: "Invoices.", Behaviors: "- [ ] B1: invoice is created", "Implementation Decisions": "x", "Testing Decisions": "x", "Non-goals": "x" });
  return { vault, adr, spec, other };
}

test("build counts docs; search ranks and stems", () => {
  const { vault, spec } = vaultWithDocs();
  assert.equal(buildIndex(vault), 3);
  const hits = search(vault, "logging in with magic link");
  assert.ok(hits[0].startsWith("demo-adr-001-passwordless") || hits[0].startsWith(spec.id));
  assert.ok(search(vault, "invoices")[0].startsWith("demo-spec-002-billing"));
  assert.deepEqual(search(vault, "zzzzqq"), []);
  assert.deepEqual(search(vault, "!!! ()"), []);
});

test("search filters by type and project", () => {
  const { vault } = vaultWithDocs();
  assert.ok(search(vault, "link", { type: "spec" }).every((l) => l.includes("[spec/")));
  assert.deepEqual(search(vault, "link", { project: "other" }), []);
});

test("governs finds the spec anchoring a path", () => {
  const { vault, spec } = vaultWithDocs();
  assert.ok(governs(vault, "src/login.php")[0].startsWith(spec.id));
  assert.deepEqual(governs(vault, "src/none.php"), []);
});

test("graph: dependencies and dependents", () => {
  const { vault, adr, spec } = vaultWithDocs();
  assert.ok(dependencies(vault, spec.id).some((l) => l.startsWith("depends:") && l.includes(adr.id)));
  assert.ok(dependents(vault, adr.id).some((l) => l.includes(spec.id)));
});

test("open behaviors and active listing", () => {
  const { vault } = vaultWithDocs();
  const open = openBehaviors(vault, "demo");
  assert.ok(open.some((l) => l.includes("B2 [todo] expired link is rejected")));
  assert.ok(!open.some((l) => l.includes("B1 [done]")));
  assert.equal(listActive(vault, "demo", "adr").length, 1);
});

test("superseded docs are hidden from search by default", () => {
  const { vault, adr } = vaultWithDocs();
  const f = adr.file;
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("status: active", "status: superseded\nsuperseded_by: demo-spec-001-login"));
  assert.ok(!search(vault, "magic links").some((l) => l.startsWith(adr.id)));
  assert.ok(search(vault, "magic links", { status: "superseded" }).some((l) => l.startsWith(adr.id)));
});

test("index rebuilds itself when a doc changes", () => {
  const { vault, other } = vaultWithDocs();
  search(vault, "invoices");
  const before = fs.statSync(indexPath(vault)).mtimeMs;
  fs.appendFileSync(other.file, "\nRefunds are handled by finance.\n");
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(other.file, future, future);
  assert.ok(search(vault, "refunds").length > 0);
  assert.ok(fs.statSync(indexPath(vault)).mtimeMs > before);
});

test("show prints a whole doc or one section", () => {
  const { vault, spec } = vaultWithDocs();
  assert.match(show(vault, spec.id), /^---/);
  assert.equal(show(vault, spec.id, "Non-goals"), "## Non-goals\nSSO.");
  assert.throws(() => show(vault, spec.id, "Nope"), /no section/);
  assert.throws(() => show(vault, "nope"), /no doc/);
});
