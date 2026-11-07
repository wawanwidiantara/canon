// Stack-agnostic quality checks (a free stand-in for Sonar-style gates).
//
// Order of preference:
//   1. checks the repo already defines (package.json / composer.json scripts)
//   2. a registry of well-known tools per stack, used only when installed
//   3. a per-project override in the vault's canon.config.json:
//        "checks": { "onStop": false, "disable": ["knip"],
//                    "commands": [{ "name": "x", "cmd": "mytool", "args": ["{files}"], "scope": "files" }] }
// Output is capped: a passing tool prints one line, a failing one its tail.
// `verified: false` means flags are from memory; retry with the tool's --help.
import { spawnPortable } from "./platform.mjs";
import fs from "node:fs";
import path from "node:path";
import { changedFiles, isTest } from "./mutation.mjs";

const has = (repo, f) => fs.existsSync(path.join(repo, f));
const read = (repo, f) => (has(repo, f) ? fs.readFileSync(path.join(repo, f), "utf8") : "");
const json = (repo, f) => {
  try {
    return JSON.parse(read(repo, f) || "{}");
  } catch {
    return {};
  }
};
const dep = (repo, name) => {
  const p = json(repo, "package.json");
  return Boolean(p.dependencies?.[name] ?? p.devDependencies?.[name]);
};
const composerDep = (repo, name) => {
  const c = json(repo, "composer.json");
  return Boolean(c.require?.[name] ?? c["require-dev"]?.[name]);
};
const ext = (...e) => (f) => e.some((x) => f.endsWith(x));

// How to run a locally installed JS tool in this repo.
export function jsRunner(repo) {
  if (has(repo, "pnpm-lock.yaml")) return ["pnpm", "exec"];
  if (has(repo, "yarn.lock")) return ["yarn"];
  if (has(repo, "bun.lock") || has(repo, "bun.lockb")) return ["bunx"];
  return ["npx", "--no-install"];
}
function scriptRunner(repo) {
  if (has(repo, "pnpm-lock.yaml")) return ["pnpm", "run"];
  if (has(repo, "yarn.lock")) return ["yarn"];
  if (has(repo, "bun.lock") || has(repo, "bun.lockb")) return ["bun", "run"];
  return ["npm", "run", "--silent"];
}

const OWN_NAMES = /^(lint|lint:.+|typecheck|type-check|tsc|check|analy[sz]e|stan|phpstan|pint|format:check|fmt:check|test:lint|test:types)$/;

// Quality scripts the repo already defines.
export function ownScripts(repo) {
  const out = [];
  const pkg = json(repo, "package.json").scripts ?? {};
  for (const [name, cmd] of Object.entries(pkg)) {
    if (OWN_NAMES.test(name)) out.push({ id: `npm:${name}`, label: `package.json script "${name}"`, args: [...scriptRunner(repo), name], scope: "project", verified: true, text: cmd });
  }
  const comp = json(repo, "composer.json").scripts ?? {};
  for (const [name, cmd] of Object.entries(comp)) {
    if (OWN_NAMES.test(name)) out.push({ id: `composer:${name}`, label: `composer script "${name}"`, args: ["composer", "run", "--no-interaction", name], scope: "project", verified: true, text: JSON.stringify(cmd) });
  }
  return out;
}

export const TOOLS = [
  { id: "phpstan", label: "PHPStan/Larastan (PHP static analysis)", kind: "types", scope: "files", verified: false,
    detect: (r) => has(r, "phpstan.neon") || has(r, "phpstan.neon.dist") || composerDep(r, "larastan/larastan") || composerDep(r, "phpstan/phpstan"),
    files: ext(".php"), args: (r, f) => ["./vendor/bin/phpstan", "analyse", "--no-progress", "--error-format=raw", ...f] },
  { id: "pint", label: "Laravel Pint (PHP style)", kind: "lint", scope: "files", verified: false,
    detect: (r) => composerDep(r, "laravel/pint") || has(r, "pint.json"),
    files: ext(".php"), args: (r, f) => ["./vendor/bin/pint", "--test", ...f] },
  { id: "rector", label: "Rector (PHP dead and outdated code, dry run)", kind: "deadcode", scope: "files", verified: false,
    detect: (r) => composerDep(r, "rector/rector") || has(r, "rector.php"),
    files: ext(".php"), args: (r, f) => ["./vendor/bin/rector", "process", "--dry-run", "--no-progress-bar", ...f] },
  { id: "tsc", label: "TypeScript type check", kind: "types", scope: "project", verified: true,
    detect: (r) => has(r, "tsconfig.json") && dep(r, "typescript"),
    files: ext(".ts", ".tsx", ".vue"), args: (r) => [...jsRunner(r), "tsc", "--noEmit"] },
  { id: "eslint", label: "ESLint", kind: "lint", scope: "files", verified: true,
    detect: (r) => dep(r, "eslint"),
    files: ext(".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"), args: (r, f) => [...jsRunner(r), "eslint", ...f] },
  { id: "knip", label: "knip (unused files, exports, dependencies)", kind: "deadcode", scope: "project", verified: false,
    detect: (r) => dep(r, "knip"),
    files: ext(".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue"), args: (r) => [...jsRunner(r), "knip"] },
  { id: "dart", label: "dart/flutter analyze", kind: "types", scope: "project", verified: true,
    detect: (r) => has(r, "pubspec.yaml"),
    files: ext(".dart"), args: (r) => [/^\s*flutter:\s*$/m.test(read(r, "pubspec.yaml")) && /sdk:\s*flutter/.test(read(r, "pubspec.yaml")) ? "flutter" : "dart", "analyze"] },
  { id: "go-vet", label: "go vet", kind: "types", scope: "project", verified: true,
    detect: (r) => has(r, "go.mod"), files: ext(".go"), args: () => ["go", "vet", "./..."] },
  { id: "clippy", label: "cargo clippy", kind: "lint", scope: "project", verified: true,
    detect: (r) => has(r, "Cargo.toml"), files: ext(".rs"), args: () => ["cargo", "clippy", "--quiet", "--", "-D", "warnings"] },
  { id: "ruff", label: "ruff (Python lint)", kind: "lint", scope: "files", verified: false,
    detect: (r) => has(r, "ruff.toml") || /\[tool\.ruff/.test(read(r, "pyproject.toml")),
    files: ext(".py"), args: (r, f) => ["ruff", "check", ...f] },
  { id: "jscpd", label: "jscpd (copy-pasted code, any language)", kind: "duplication", scope: "project", verified: true, slow: true,
    detect: (r) => dep(r, "jscpd") || has(r, ".jscpd.json"),
    files: () => true, filter: "clones",
    args: (r) => [...jsRunner(r), "jscpd", "--min-lines", "8", "--min-tokens", "70", "--reporters", "console", "--ignore", "**/node_modules/**,**/vendor/**,**/dist/**,**/build/**,**/.git/**,**/storage/**", "."] },
  { id: "opengrep", label: "OpenGrep (security and custom rules)", kind: "security", scope: "files", verified: false, slow: true,
    detect: (r) => has(r, ".opengrep.yml") || has(r, ".semgrep.yml") || has(r, ".opengrep"),
    files: () => true, args: (r, f) => ["opengrep", "scan", "--quiet", ...(has(r, ".opengrep.yml") ? ["--config", ".opengrep.yml"] : has(r, ".semgrep.yml") ? ["--config", ".semgrep.yml"] : ["--config", ".opengrep"]), ...f] },
];

// Plans to run for this repo and change set.
export function planChecks(repo, files, { override = null, fast = false } = {}) {
  const disabled = new Set(override?.disable ?? []);
  const own = ownScripts(repo).filter((p) => !disabled.has(p.id));
  const ownText = own.map((p) => p.text).join(" ");
  const plans = [...own];
  const src = files.filter((f) => !f.startsWith("vendor/") && !f.startsWith("node_modules/"));
  for (const t of TOOLS) {
    if (disabled.has(t.id) || !t.detect(repo)) continue;
    if (ownText.includes(t.id === "go-vet" ? "go vet" : t.id === "dart" ? "analyze" : t.id)) continue; // repo already runs it
    if (fast && t.slow) continue;
    if (fast && t.kind === "deadcode" && t.scope === "project") continue;
    const mine = src.filter((f) => t.files(f));
    if (!mine.length) continue;
    const scoped = t.scope === "files" ? mine : [];
    if (t.scope === "files" && scoped.some((f) => !fs.existsSync(path.join(repo, f)))) {
      scoped.splice(0, scoped.length, ...scoped.filter((f) => fs.existsSync(path.join(repo, f))));
      if (!scoped.length) continue;
    }
    plans.push({ id: t.id, label: t.label, kind: t.kind, scope: t.scope, verified: t.verified, filter: t.filter, args: t.args(repo, scoped), changed: mine });
  }
  for (const c of override?.commands ?? []) {
    const f = src.filter((x) => !isTest(x) || c.includeTests);
    if (!f.length && c.scope !== "project") continue;
    const args = [c.cmd, ...(c.args ?? []).flatMap((a) => (a === "{files}" ? f : a === "{files,}" ? [f.join(",")] : [a]))];
    plans.push({ id: c.name ?? c.cmd, label: c.name ?? c.cmd, scope: c.scope ?? "files", verified: true, args, changed: f });
  }
  return plans;
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Keep only jscpd clone blocks that touch changed files. Real output has ANSI
// colour codes and a summary table after the last clone; both are dropped.
export function filterClones(text, files) {
  const blocks = [];
  let cur = null;
  for (const line of stripAnsi(text).split("\n")) {
    if (/^Clone found/.test(line)) {
      cur = [line];
      blocks.push(cur);
    } else if (cur && /^( - |   )\S/.test(line)) cur.push(line);
    else cur = null;
  }
  return blocks
    .filter((b) => files.some((f) => b.some((l) => l.includes(f))))
    .map((b) => b.join("\n"))
    .join("\n");
}

export const tail = (s, n) => {
  const lines = s.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.trimEnd()).filter(Boolean);
  return lines.length > n ? [`… ${lines.length - n} earlier line(s) omitted`, ...lines.slice(-n)].join("\n") : lines.join("\n");
};

export function runChecks(repo, plans, { maxLines = 25 } = {}) {
  return plans.map((p) => {
    const r = spawnPortable(p.args[0], p.args.slice(1), { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
    let raw = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    if (r.error) return { id: p.id, ok: false, note: `could not run ${p.args[0]}: ${r.error.message}`, output: "", verified: p.verified };
    if (p.filter === "clones") {
      raw = filterClones(raw, p.changed ?? []);
      return { id: p.id, ok: !raw, output: raw ? tail(raw, maxLines) : "", verified: p.verified };
    }
    return { id: p.id, ok: r.status === 0, output: r.status === 0 ? "" : tail(raw, maxLines), verified: p.verified };
  });
}

export function formatResults(results) {
  return results
    .map((r) => (r.ok ? `ok   ${r.id}` : `FAIL ${r.id}${r.verified ? "" : " (flags unverified)"}\n${r.note ?? r.output}`.trimEnd()))
    .join("\n");
}

export function checkFiles(repo, base) {
  return changedFiles(repo, base);
}
