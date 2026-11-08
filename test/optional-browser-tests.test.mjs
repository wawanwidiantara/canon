import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doctor } from "../src/doctor.mjs";
import { suggestGate } from "../src/gates.mjs";
import { init, mapProject } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-opt-"));
const names = (gate) => gate.full.map((c) => c.name);

function playwrightRepo() {
  const repo = tmp();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { "@playwright/test": "^1.65.0" } }));
  fs.writeFileSync(path.join(repo, "playwright.config.ts"), "export default {};\n");
  return repo;
}

test("the proposed gate leaves browser tests out unless asked", () => {
  const repo = playwrightRepo();
  assert.deepEqual(names(suggestGate(repo)), ["test"]);
  assert.deepEqual(names(suggestGate(repo, {})), ["test"]);
  assert.deepEqual(names(suggestGate(repo, { e2e: false })), ["test"]);
  assert.deepEqual(names(suggestGate(repo, { e2e: true })), ["test", "e2e"]);
  // The command line: no option leaves them out, the e2e option adds them.
  const vault = tmp();
  init(vault, { git: false });
  const run = (...args) => {
    const r = spawnSync("node", [path.join(ROOT, "bin/canon.mjs"), "gate", "init", ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, CANON_VAULT: vault } });
    assert.equal(r.status, 0, r.stderr);
    const gate = JSON.parse(fs.readFileSync(path.join(repo, "canon.gate.json"), "utf8"));
    fs.rmSync(path.join(repo, "canon.gate.json"));
    return names(gate);
  };
  assert.deepEqual(run(), ["test"]);
  assert.deepEqual(run("--e2e"), ["test", "e2e"]);
});

test("the doctor skips browser checks for a project that turned them off", () => {
  const vault = tmp();
  const home = tmp();
  const web = playwrightRepo();
  const other = playwrightRepo();
  init(vault, { git: false });
  mapProject(vault, "web", web);
  mapProject(vault, "other", other);
  const cfgFile = path.join(vault, "canon.config.json");
  const run = (browserTests) => {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    if (browserTests === undefined) delete cfg.projects.web.browserTests;
    else cfg.projects.web.browserTests = browserTests;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
    const prev = process.env.CANON_VAULT;
    process.env.CANON_VAULT = vault;
    try {
      return doctor({ cwd: other, env: { ...process.env, CANON_VAULT: vault }, home }).filter((r) => /^playwright/.test(r.name)).map((r) => r.name);
    } finally {
      if (prev === undefined) delete process.env.CANON_VAULT;
      else process.env.CANON_VAULT = prev;
    }
  };
  const has = (list, slug) => list.some((n) => n.endsWith(` ${slug}`));
  assert.ok(has(run(undefined), "web"), "checked when the setting is missing");
  assert.ok(has(run(true), "web"), "checked when true");
  const off = run(false);
  assert.ok(!has(off, "web"), "skipped when false");
  assert.ok(has(off, "other"), "other projects are still checked");
});

test("the flow skill offers a browser test or a hand check and leaves the choice to the person", () => {
  const flow = fs.readFileSync(path.join(ROOT, "skills/flow/SKILL.md"), "utf8");
  const step4 = /^4\. \*\*Spec\.\*\*[\s\S]*?(?=^5\. )/m.exec(flow)[0];
  assert.match(step4, /browser test/i);
  assert.match(step4, /canon confirm/);
  assert.match(step4, /person chooses|the person decides|person'?s choice/i);
  assert.doesNotMatch(step4, /A UI behavior's test is a browser test/);
});
