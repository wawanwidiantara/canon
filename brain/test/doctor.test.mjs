import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { doctor, formatDoctor, nodeCheck, permissionCheck } from "../src/doctor.mjs";
import { usageReport, weekOf } from "../src/digest.mjs";
import { init, mapProject } from "../src/ops.mjs";
import { validate } from "../src/validate.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "braind-"));
const find = (r, name) => r.find((x) => x.name === name);

test("node version gate", () => {
  assert.equal(nodeCheck("24.1.0").level, "ok");
  assert.equal(nodeCheck("22.13.0").level, "ok");
  assert.equal(nodeCheck("22.12.9").level, "FAIL");
  assert.equal(nodeCheck("20.11.0").level, "FAIL");
});

test("permission check reads user and project settings", () => {
  const home = tmp();
  const cwd = tmp();
  assert.equal(permissionCheck(cwd, home).level, "warn");
  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(git status)"] } }));
  assert.equal(permissionCheck(cwd, home).level, "warn");
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(brain:*)"] } }));
  assert.equal(permissionCheck(cwd, home).level, "ok");
});

test("doctor: no vault, then a healthy vault with one unmapped project", () => {
  const prev = process.env.BRAIN_VAULT;
  const home = tmp();
  try {
    process.env.BRAIN_VAULT = path.join(tmp(), "missing");
    const noVault = doctor({ cwd: tmp(), home });
    assert.equal(find(noVault, "vault").level, "FAIL");

    const vault = tmp();
    init(vault);
    const repo = tmp();
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/me/app.git"]);
    mapProject(vault, "app", repo);
    const cfgPath = path.join(vault, "brain.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.projects.other = { remote: "github.com/me/other" };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    process.env.BRAIN_VAULT = vault;
    const r = doctor({ cwd: repo, home });
    assert.equal(find(r, "vault").level, "ok");
    assert.equal(find(r, "project app").level, "ok");
    assert.equal(find(r, "project other").level, "warn");
    assert.match(find(r, "project other").fix, /clone github\.com\/me\/other/);
    assert.equal(find(r, "this directory").detail, "project app");
    assert.equal(find(r, "vault git").level, "warn"); // no remote yet
    const text = formatDoctor(r);
    assert.match(text, /fix: /);
    assert.match(text, /\d+ problem\(s\), \d+ warning\(s\)/);
  } finally {
    if (prev === undefined) delete process.env.BRAIN_VAULT;
    else process.env.BRAIN_VAULT = prev;
  }
});

test("validate flags a vault newer than the tool", () => {
  const vault = tmp();
  init(vault, { git: false });
  const f = path.join(vault, "brain.config.json");
  const cfg = JSON.parse(fs.readFileSync(f, "utf8"));
  cfg.schema_version = 99;
  fs.writeFileSync(f, JSON.stringify(cfg));
  assert.match(validate(vault)[0], /schema 99, this tool supports 1/);
});

test("usage report groups by ISO week and ranks sessions", () => {
  assert.equal(weekOf("2026-11-06T10:00:00Z"), "2026-W45");
  assert.equal(weekOf("2026-01-01T00:00:00Z"), "2026-W01");
  assert.equal(weekOf("garbage"), "unknown");
  const d = (id, started, out) => ({ session_id: id, title: `t-${id}`, started, human_turns: 3, tokens: { input: 10, output: out, cache_read: 1000, cache_write: 50 }, tools: { Bash: 2, Read: 1 }, errors: [1] });
  const rep = usageReport([d("aaaaaaaa", "2026-11-03T00:00:00Z", 100), d("bbbbbbbb", "2026-11-05T00:00:00Z", 900), d("cccccccc", "2026-11-12T00:00:00Z", 50)], { top: 2 });
  assert.match(rep, /2026-W45\s+2\s+6\s+1,000\s+120\s+2,000\s+2/);
  assert.match(rep, /2026-W46\s+1/);
  assert.ok(rep.indexOf("bbbbbbbb") < rep.indexOf("aaaaaaaa"));
  assert.match(rep, /Most used tools: Bash 6, Read 3/);
  assert.match(usageReport([]), /No session digests yet/);
});
