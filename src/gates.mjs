// Gates as code: the repo says which commands must pass, a script runs them.
// canon.gate.json sits at the repo root, so it is versioned with the code and
// every worktree and branch carries the gate it was written against.
//
//   { "fast": [ { "name": "lint", "cmd": "npm", "args": ["run", "lint"] } ],
//     "full": [ { "name": "test", "cmd": "npm", "args": ["test"], "timeoutSec": 600 } ],
//     "regen": [ { "name": "codegen", "cmd": "npm", "args": ["run", "gen"] } ] }
//
// `regen` rebuilds generated files; `canon land` runs it after rebasing a branch
// onto main and commits whatever changes.
//
// `fast` is cheap enough to run after every step. `full` runs `fast` first, then
// its own commands. Commands are argv lists, never shell strings, so a gate
// behaves the same on every OS and cannot be bent by quoting.
import fs from "node:fs";
import path from "node:path";
import { tail, ownScripts } from "./check.mjs";
import { spawnPortable } from "./platform.mjs";
import { writeAtomic } from "./fsx.mjs";

export const GATE_FILE = "canon.gate.json";
const LEVELS = ["fast", "full", "regen"];

// { fast: [...], full: [...] } or null when the repo has no gate file.
// Throws with a precise message when the file is malformed.
export function loadGate(repo) {
  const file = path.join(repo, GATE_FILE);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${GATE_FILE} is not valid JSON: ${e.message}`);
  }
  const gate = {};
  for (const level of LEVELS) {
    const list = raw[level] ?? [];
    if (!Array.isArray(list)) throw new Error(`${GATE_FILE}: "${level}" must be a list`);
    gate[level] = list.map((c, i) => {
      const at = `${GATE_FILE}: ${level}[${i}]`;
      if (!c || typeof c !== "object") throw new Error(`${at} must be an object`);
      if (typeof c.cmd !== "string" || !c.cmd) throw new Error(`${at} needs a "cmd" string`);
      if (c.args !== undefined && (!Array.isArray(c.args) || c.args.some((a) => typeof a !== "string"))) throw new Error(`${at}: "args" must be a list of strings`);
      if (c.timeoutSec !== undefined && !(Number(c.timeoutSec) > 0)) throw new Error(`${at}: "timeoutSec" must be a positive number`);
      return { name: c.name ?? c.cmd, cmd: c.cmd, args: c.args ?? [], timeoutSec: c.timeoutSec ?? (level === "fast" ? 60 : 300) };
    });
  }
  for (const k of Object.keys(raw)) if (!LEVELS.includes(k)) throw new Error(`${GATE_FILE}: unknown key "${k}" (use fast, full and regen)`);
  return gate;
}

// Commands to run for a level. `full` includes everything in `fast`.
export const commandsFor = (gate, level) => (level === "full" ? [...gate.fast, ...gate.full] : gate.fast);

// Run commands in order and stop at the first failure. `budgetMs` caps the
// whole run (hooks have a time limit); a command that would not fit is skipped
// and reported, never silently passed.
export function runGate(repo, level, { budgetMs = Infinity, maxLines = 25 } = {}) {
  const gate = loadGate(repo);
  if (!gate) throw new Error(`no ${GATE_FILE} in ${repo}; run \`canon gate init\``);
  const results = [];
  const start = Date.now();
  for (const c of commandsFor(gate, level)) {
    const left = budgetMs - (Date.now() - start);
    if (left <= 0) {
      results.push({ name: c.name, ok: false, skipped: true, ms: 0, output: "not run: time budget used up" });
      break;
    }
    const t0 = Date.now();
    const r = spawnPortable(c.cmd, c.args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: Math.min(c.timeoutSec * 1000, left) });
    const ms = Date.now() - t0;
    if (r.error) {
      const why = r.error.code === "ETIMEDOUT" ? `timed out after ${Math.round(ms / 1000)}s` : `could not run ${c.cmd}: ${r.error.message}`;
      results.push({ name: c.name, ok: false, ms, output: why });
      break;
    }
    const ok = r.status === 0;
    results.push({ name: c.name, ok, ms, output: ok ? "" : tail(`${r.stdout ?? ""}\n${r.stderr ?? ""}`, maxLines) });
    if (!ok) break;
  }
  return results;
}

export function formatGate(level, results) {
  const lines = results.map((r) => (r.ok ? `ok   ${r.name} (${(r.ms / 1000).toFixed(1)}s)` : `FAIL ${r.name}\n${r.output}`.trimEnd()));
  lines.push(results.every((r) => r.ok) ? `gate ${level}: passed` : `gate ${level}: FAILED`);
  return lines.join("\n");
}

// Propose a gate from scripts the repo already defines. It invents no tool
// flags: only existing lint, type-check and test scripts are listed.
export function suggestGate(repo) {
  const fast = ownScripts(repo).map((p) => ({ name: p.id.replace(/^[a-z]+:/, ""), cmd: p.args[0], args: p.args.slice(1) }));
  const full = [];
  const pkg = readJson(path.join(repo, "package.json")).scripts ?? {};
  const comp = readJson(path.join(repo, "composer.json")).scripts ?? {};
  const has = (repo_, f) => fs.existsSync(path.join(repo_, f));
  const run = has(repo, "pnpm-lock.yaml") ? ["pnpm", "run"] : has(repo, "yarn.lock") ? ["yarn"] : (has(repo, "bun.lock") || has(repo, "bun.lockb")) ? ["bun", "run"] : ["npm", "run", "--silent"];
  if (pkg.test) full.push({ name: "test", cmd: run[0], args: [...run.slice(1), "test"] });
  if (comp.test) full.push({ name: "test", cmd: "composer", args: ["run", "--no-interaction", "test"] });
  if (has(repo, "go.mod")) full.push({ name: "go-test", cmd: "go", args: ["test", "./..."] });
  if (has(repo, "Cargo.toml")) full.push({ name: "cargo-test", cmd: "cargo", args: ["test", "--quiet"] });
  return { fast, full };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// Write canon.gate.json if absent. Returns { file, gate }.
export function initGate(repo) {
  const file = path.join(repo, GATE_FILE);
  if (fs.existsSync(file)) throw new Error(`${GATE_FILE} already exists; edit it by hand`);
  const gate = suggestGate(repo);
  writeAtomic(file, JSON.stringify(gate, null, 2) + "\n");
  return { file, gate };
}

// Run the regen commands in order; throws on the first failure.
export function runRegen(repo) {
  const gate = loadGate(repo);
  for (const c of gate?.regen ?? []) {
    const r = spawnPortable(c.cmd, c.args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: c.timeoutSec * 1000 });
    if (r.error || r.status !== 0) throw new Error(`regen "${c.name}" failed:\n${tail(`${r.stdout ?? ""}\n${r.stderr ?? ""}\n${r.error?.message ?? ""}`, 25)}`);
  }
  return (gate?.regen ?? []).map((c) => c.name);
}
