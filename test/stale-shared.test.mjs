import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeProblems } from "../src/anchors.mjs";
import { sessionBrief, staleFor, stopReasons } from "../src/context.mjs";
import { addAnchors, findStale, init, mapProject, newDoc } from "../src/ops.mjs";
import { loadConfig, saveConfig } from "../src/vault.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/a.php"), "v1\n");
  fs.writeFileSync(path.join(repo, "src/b.php"), "v1\n");
  init(vault, { git: false });
  mapProject(vault, "demo", repo);
  const spec = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  fs.writeFileSync(spec.file, fs.readFileSync(spec.file, "utf8").replace("status: draft", "status: active"));
  return { vault, repo, spec };
}

test("describeProblems prints each problem as kind and anchor, joined with commas", () => {
  assert.equal(describeProblems([{ kind: "changed", anchor: "src/a.php@abc" }, { kind: "missing", anchor: "src/b.php@def" }]), "changed src/a.php@abc, missing src/b.php@def");
  assert.equal(describeProblems([]), "");
});

test("the stale command, the session brief and the stop check agree on the same stale docs and text", () => {
  const { vault, repo, spec } = fixture();
  addAnchors(vault, spec.id, ["src/a.php", "src/b.php"]);
  fs.writeFileSync(path.join(repo, "src/a.php"), "v2\n");
  fs.rmSync(path.join(repo, "src/b.php"));

  const command = findStale(vault);
  assert.equal(command.length, 1);
  const text = describeProblems(command[0].problems);
  assert.match(text, /changed src\/a\.php@[0-9a-f]{12}, missing src\/b\.php@[0-9a-f]{12}/);

  assert.deepEqual(staleFor(vault, "demo").map((s) => ({ id: s.id, problems: s.problems })), command.map((s) => ({ id: s.id, problems: s.problems })));
  assert.ok(sessionBrief(vault, "demo").includes(`Stale: ${spec.id} (${text})`));
  assert.ok(stopReasons(vault, "demo").some((r) => r.startsWith(`${spec.id} is stale (${text})`)));
});

test("a project with no repo mapped adds no stale entry to the brief or the stop check", () => {
  const { vault, spec } = fixture();
  addAnchors(vault, spec.id, ["src/a.php"]);
  const config = loadConfig(vault);
  delete config.projects.demo.repo;
  saveConfig(vault, config);
  fs.rmSync(path.join(vault, ".canon", "local.json"), { force: true });

  assert.deepEqual(findStale(vault).map((s) => s.problems[0].kind), ["no-repo-mapped"]);
  assert.deepEqual(staleFor(vault, "demo"), []);
  assert.doesNotMatch(sessionBrief(vault, "demo"), /Stale:/);
  assert.deepEqual(stopReasons(vault, "demo").filter((r) => /is stale/.test(r)), []);
});
