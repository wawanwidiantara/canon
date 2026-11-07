import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, mapProject } from "../src/ops.mjs";
import { qsDenial } from "../src/qs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "canon-qs-")));
const allowed = { projects: { demo: { quicksilver: true } } };

function repo() {
  const root = tmp();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.txt"), "x");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(root, "notes.json"), "{}");
  const outside = tmp();
  fs.writeFileSync(path.join(outside, "other.txt"), "x");
  return { root, outside };
}
const deny = (args, { config = allowed, project = "demo", env = {}, root } = {}) => qsDenial({ config, project, args, env, root });

test("a project that has not allowed Quicksilver is refused; an allowed one passes", () => {
  const { root } = repo();
  assert.match(deny(["filter", "q", "src"], { config: { projects: { demo: {} } }, root }), /has not allowed Quicksilver/);
  assert.equal(deny(["filter", "does this match?", "src"], { root }), null);
  assert.equal(deny(["filter", "q", "src"], { config: {}, project: null, root }), null); // unmapped: governed by the argument checks only
});

test("unknown subcommands are refused; status, setup and help send nothing", () => {
  const { root } = repo();
  assert.match(deny(["extract", "src"], { root }), /unknown Quicksilver command/);
  assert.match(deny([], { root }), /unknown Quicksilver command/);
  for (const c of ["status", "setup", "help"]) assert.equal(deny([c, "../../anywhere"], { root }), null);
});

test("an API host outside the allowlist is refused; the default and listed hosts pass", () => {
  const { root } = repo();
  assert.match(deny(["filter", "q", "src"], { env: { QUICKSILVER_API_BASE: "https://evil.example/v1" }, root }), /evil\.example.*not in "quicksilverHosts"/);
  assert.match(deny(["status"], { env: { QUICKSILVER_API_BASE: "https://evil.example" }, root }), /not in "quicksilverHosts"/);
  assert.match(deny(["status"], { env: { QUICKSILVER_API_BASE: "not a url" }, root }), /not a valid URL/);
  assert.equal(deny(["filter", "q", "src"], { env: { QUICKSILVER_API_BASE: "https://api.typesafe.ai" }, root }), null);
  const cfg = { projects: { demo: { quicksilver: true } }, quicksilverHosts: ["ai.mine.example"] };
  assert.equal(deny(["filter", "q", "src"], { config: cfg, env: { QUICKSILVER_API_BASE: "https://ai.mine.example/v1" }, root }), null);
});

test("secrets files, outside paths and the guard-off flag are refused however they are spelled", () => {
  const { root, outside } = repo();
  assert.match(deny(["filter", "q", ".env"], { root }), /secrets file/);
  assert.match(deny(["ask", "q", "--state", "@.env"], { root }), /secrets file/);
  assert.match(deny(["ask", "q", "--state=@.env"], { root }), /secrets file/);
  assert.match(deny(["filter", "q", path.join(outside, "other.txt")], { root }), /outside/);
  assert.match(deny(["filter", "q", "../" + path.basename(outside)], { root }), /outside/);
  assert.match(deny(["classify", "--items", path.join(outside, "other.txt")], { root }), /outside/);
  assert.match(deny(["filter", "q", "src", "--no-secrets-guard"], { root }), /--no-secrets-guard is refused/);
  assert.match(deny(["filter", "q", "src/*.txt", path.join(outside, "*.txt")], { root }), /outside/);
  assert.equal(deny(["ask", "spec.json"], { root }), null); // inside the repo and not a secrets file
  assert.equal(deny(["ask", "Is this ok? yes/no", "--state", "@src/a.txt"], { root }), null);
});

test("`canon qs` runs the skill script after the checks, and stops before it when one fails", () => {
  const root = tmp();
  const vault = path.join(root, "vault");
  const r = path.join(root, "repo");
  fs.mkdirSync(path.join(r, "src"), { recursive: true });
  fs.writeFileSync(path.join(r, "src/a.txt"), "x");
  init(vault, { git: false });
  mapProject(vault, "demo", r);
  const fake = path.join(root, "fake-qs.mjs");
  fs.writeFileSync(fake, 'console.log("FAKE QS", process.argv.slice(2).join(" "), process.env.QUICKSILVER_API_BASE ?? "-");');
  const run = (args, env = {}) => spawnSync("node", [path.join(ROOT, "bin/canon.mjs"), "qs", ...args], { cwd: r, env: { ...process.env, CANON_VAULT: vault, CANON_QS_SCRIPT: fake, ...env }, encoding: "utf8" });
  let res = run(["filter", "q", "src"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /has not allowed Quicksilver/);
  assert.ok(!res.stdout.includes("FAKE QS"));
  const cfgPath = path.join(vault, "canon.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.projects.demo.quicksilver = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  res = run(["filter", "is it?", "src"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /FAKE QS filter is it\? src/);
  res = run(["filter", "q", "src"], { QUICKSILVER_API_BASE: "https://evil.example" });
  assert.equal(res.status, 1);
  assert.ok(!res.stdout.includes("FAKE QS"));
});
