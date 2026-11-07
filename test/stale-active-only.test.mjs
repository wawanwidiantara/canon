import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addAnchors, findStale, init, mapProject, newDoc } from "../src/ops.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-act-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/login.php"), "<?php // v1\n");
  init(vault);
  mapProject(vault, "demo", repo);
  return { vault, repo };
}

const setStatus = (file, to) => {
  const t = fs.readFileSync(file, "utf8").replace(/^status: .*$/m, `status: ${to}`);
  fs.writeFileSync(file, t.replace(/^(status: superseded)$/m, "$1\nsuperseded_by: demo-other"));
};

test("B12: only active docs are checked for staleness", () => {
  const { vault, repo } = fixture();
  const { id, file } = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  setStatus(file, "active");
  addAnchors(vault, id, ["src/login.php"]);
  fs.writeFileSync(path.join(repo, "src/login.php"), "<?php // v2\n");

  // control: while active, the changed file is reported
  assert.deepEqual(findStale(vault).map((s) => s.id), [id]);

  for (const status of ["draft", "needs-review", "superseded", "completed"]) {
    setStatus(file, status);
    assert.deepEqual(findStale(vault), [], `${status} must be skipped`);
  }
  setStatus(file, "active");
  assert.deepEqual(findStale(vault).map((s) => s.id), [id], "back to active, reported again");
});
