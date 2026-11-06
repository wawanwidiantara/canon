// Picks the mutation tool for a repo, scopes it to changed files, and keeps only
// the lines the model needs (surviving mutants + score). Flags for Pest and
// Infection follow their docs; Stryker and go-mutesting flags are unverified
// here, so a failed run should be retried with the tool's --help.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const has = (repo, f) => fs.existsSync(path.join(repo, f));
const read = (repo, f) => (has(repo, f) ? fs.readFileSync(path.join(repo, f), "utf8") : "");

export function detectStack(repo) {
  const composer = read(repo, "composer.json");
  if (/pestphp\/pest/.test(composer)) return "pest";
  if (has(repo, "infection.json5") || has(repo, "infection.json") || /infection\/infection/.test(composer)) return "infection";
  if (/@stryker-mutator\//.test(read(repo, "package.json")) || has(repo, "stryker.config.json") || has(repo, "stryker.config.mjs")) return "stryker";
  if (has(repo, "go.mod")) return "go";
  return null;
}

// Files changed vs base (default: uncommitted changes plus commits ahead of base).
export function changedFiles(repo, base = null) {
  const run = (args) => {
    try {
      return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  const names = new Set();
  const add = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean).forEach((n) => names.add(n));
  add(run(["diff", "--name-only", "--diff-filter=AMR", base ? `${base}...HEAD` : "HEAD"]));
  add(run(["ls-files", "--others", "--exclude-standard"]));
  return [...names];
}

const isTest = (f) => /(^|\/)(tests?|__tests__|spec)\//.test(f) || /\.(test|spec)\.[jt]sx?$/.test(f) || /_test\.go$/.test(f) || /Test\.php$/.test(f);

// `app/Http/X.php` -> `App\Http\X` (default Laravel PSR-4 root).
export function phpClass(file) {
  return file.replace(/^app\//, "App/").replace(/\.php$/, "").replace(/\//g, "\\");
}

// Returns { cmd, args, notes } or null when nothing mutable changed.
export function commandFor(stack, files, { base = "main" } = {}) {
  const src = files.filter((f) => !isTest(f));
  const notes = [];
  switch (stack) {
    case "pest": {
      const classes = src.filter((f) => /^app\/.+\.php$/.test(f)).map(phpClass);
      if (!classes.length) return null;
      notes.push("Pest needs covers()/mutates() in the test file, or --everything. Needs Xdebug 3 or PCOV.");
      return { cmd: "./vendor/bin/pest", args: ["--mutate", "--parallel", "--everything", "--covered-only", `--class=${classes.join(",")}`], notes };
    }
    case "infection":
      if (!src.some((f) => f.endsWith(".php"))) return null;
      return { cmd: "./vendor/bin/infection", args: ["--git-diff-lines", `--git-diff-base=${base}`, "--threads=max", "--no-progress", "--show-mutations=30", "--logger-text=php://stdout"], notes };
    case "stryker": {
      const js = src.filter((f) => /\.(m?[jt]sx?|vue)$/.test(f));
      if (!js.length) return null;
      notes.push("Stryker flags unverified; run `npx stryker run --help` if this fails.");
      return { cmd: "npx", args: ["stryker", "run", "--mutate", js.join(","), "--reporters", "clear-text"], notes };
    }
    case "go": {
      const pkgs = [...new Set(src.filter((f) => f.endsWith(".go")).map((f) => `./${path.dirname(f)}/...`))];
      if (!pkgs.length) return null;
      notes.push("go-mutesting flags unverified; install with `go install github.com/avito-tech/go-mutesting/cmd/go-mutesting@latest`.");
      return { cmd: "go-mutesting", args: pkgs, notes };
    }
    default:
      return null;
  }
}

const KEEP = /\b(UNTESTED|UNCOVERED|SURVIVED|Survived|Escaped|ESCAPED|FAIL)\b|^\s*(Score|Mutation Score|Mutations?:|Mutation score|The mutation score)/;

// Survivors and score only; drops diffs, progress and passing mutants.
export function filterSurvivors(text, max = 40) {
  const lines = text.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).filter((l) => KEEP.test(l));
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`... ${lines.length - max} more`);
  return shown.join("\n");
}

export function runMutation(repo, { base } = {}) {
  const stack = detectStack(repo);
  if (!stack) throw new Error("no mutation tool detected (Pest, Infection, Stryker or go-mutesting)");
  const files = changedFiles(repo, base);
  const plan = commandFor(stack, files, { base: base ?? "main" });
  if (!plan) return { stack, files, plan: null, output: "" };
  const r = spawnSync(plan.cmd, plan.args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const raw = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const output = filterSurvivors(raw);
  return { stack, files, plan, output: output || (r.status === 0 ? "no surviving mutants reported" : raw.trim().split("\n").slice(-15).join("\n")), status: r.status };
}
