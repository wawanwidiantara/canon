// Stack-agnostic mutation helper.
//
// A registry of mutation tools. Each entry detects itself from repo files and
// builds a command scoped to the changed files. Anything not built in is
// handled by a per-project override in the vault's canon.config.json:
//
//   "projects": { "app": { "repo": "...", "mutation": {
//       "cmd": "mytool", "args": ["run", "{files}"], "notes": ["..."] } } }
//
// `{files}` expands to one argument per changed source file; `{files,}` is a
// single comma-joined argument. `verified: false` entries were not checked
// against the tool's docs when written; a failed run should be retried with
// the tool's --help.
import { execFileSync } from "node:child_process";
import { spawnPortable } from "./platform.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const has = (repo, f) => fs.existsSync(path.join(repo, f));
const read = (repo, f) => (has(repo, f) ? fs.readFileSync(path.join(repo, f), "utf8") : "");
const anyFile = (repo, re) => {
  try {
    return fs.readdirSync(repo).some((f) => re.test(f));
  } catch {
    return false;
  }
};

const TEST_RE = [
  /(^|\/)(tests?|__tests__|spec|specs|integration_test|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.(go|dart|py|rs)$/,
  /(^|\/)test_[^/]*\.py$/,
  /Tests?\.(php|cs|java|kt|swift)$/,
  /(^|\/)src\/test\//,
  /\.Tests?\//,
];
export const isTest = (f) => TEST_RE.some((re) => re.test(f));

const ext = (...e) => (f) => e.some((x) => f.endsWith(x));
const sourceFiles = (files, pred) => files.filter((f) => !isTest(f) && pred(f));

// `app/Http/X.php` -> `App\Http\X` (default Laravel PSR-4 root).
export function phpClass(file) {
  return file.replace(/^app\//, "App/").replace(/\.php$/, "").replace(/\//g, "\\");
}

// `src/main/java/com/a/B.java` -> `com.a.B`
function jvmClass(file) {
  const m = /src\/main\/(?:java|kotlin)\/(.+)\.(?:java|kt)$/.exec(file);
  return m ? m[1].replace(/\//g, ".") : null;
}

export const TOOLS = [
  {
    id: "pest",
    label: "Pest (PHP)",
    verified: true,
    detect: (r) => /pestphp\/pest/.test(read(r, "composer.json")),
    plan: (files) => {
      const classes = sourceFiles(files, (f) => /^app\/.+\.php$/.test(f)).map(phpClass);
      if (!classes.length) return null;
      return {
        args: ["./vendor/bin/pest", "--mutate", "--parallel", "--everything", "--covered-only", `--class=${classes.join(",")}`],
        notes: ["Needs Xdebug 3 or PCOV. Combining --class with --everything is unconfirmed; if Pest rejects it, add covers()/mutates() to the test and drop --everything."],
      };
    },
  },
  {
    id: "infection",
    label: "Infection (PHP)",
    verified: true,
    excludes: ["pest"],
    detect: (r) => has(r, "infection.json5") || has(r, "infection.json") || /infection\/infection/.test(read(r, "composer.json")),
    plan: (files, ctx) =>
      sourceFiles(files, ext(".php")).length
        ? { args: ["./vendor/bin/infection", "--git-diff-lines", `--git-diff-base=${ctx.base}`, "--threads=max", "--no-progress", "--show-mutations=30", "--logger-text=php://stdout"], notes: ["Needs Xdebug, phpdbg or PCOV."] }
        : null,
  },
  {
    id: "stryker-js",
    label: "StrykerJS (TypeScript, JavaScript, Vue; NestJS, Next, React, Node)",
    verified: false,
    detect: (r) => /@stryker-mutator\//.test(read(r, "package.json")) || anyFile(r, /^stryker\.(config|conf)\.[cm]?[jt]s(on)?$/),
    plan: (files) => {
      const js = sourceFiles(files, ext(".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"));
      return js.length ? { args: ["npx", "stryker", "run", "--mutate", js.join(",")], notes: ["--mutate is documented; check `npx stryker run --help` for the rest."] } : null;
    },
  },
  {
    id: "dart",
    label: "dart_mutant (Dart, Flutter)",
    verified: false,
    detect: (r) => has(r, "pubspec.yaml"),
    plan: (files) => {
      const d = sourceFiles(files, ext(".dart")).filter((f) => f.startsWith("lib/"));
      return d.length ? { args: ["dart_mutant", "run", ...d], notes: ["Install: dart pub global activate dart_mutant (needs Dart 3.11+). Alternative: the mutation_test package (`dart run mutation_test`)."] } : null;
    },
  },
  {
    id: "cargo-mutants",
    label: "cargo-mutants (Rust)",
    verified: true,
    detect: (r) => has(r, "Cargo.toml"),
    plan: (files, ctx) => {
      if (!sourceFiles(files, ext(".rs")).length) return null;
      return { args: ["cargo", "mutants", "--in-diff", ctx.diffFile()], notes: ["Install: cargo install cargo-mutants. Untracked files are not in the diff; `git add -N` them first."] };
    },
  },
  {
    id: "mutmut",
    label: "mutmut (Python)",
    verified: false,
    detect: (r) => /mutmut/.test(read(r, "pyproject.toml") + read(r, "setup.cfg") + read(r, "requirements-dev.txt") + read(r, "requirements.txt")),
    plan: (files) => {
      const py = sourceFiles(files, ext(".py"));
      return py.length
        ? { args: ["mutmut", "run", "--paths-to-mutate", py.join(",")], after: ["mutmut", "results"], notes: ["mutmut 3.x may take paths from config only; if --paths-to-mutate is rejected, set paths_to_mutate in setup.cfg."] }
        : null;
    },
  },
  {
    id: "pit",
    label: "PIT (Java, Kotlin)",
    verified: false,
    detect: (r) => /pitest/.test(read(r, "pom.xml") + read(r, "build.gradle") + read(r, "build.gradle.kts")),
    plan: (files, ctx) => {
      const classes = sourceFiles(files, ext(".java", ".kt")).map(jvmClass).filter(Boolean);
      if (!classes.length) return null;
      const maven = has(ctx.repo, "pom.xml");
      return {
        args: maven ? ["mvn", "org.pitest:pitest-maven:mutationCoverage", `-DtargetClasses=${classes.join(",")}`] : ["./gradlew", "pitest"],
        notes: ["Survivors are in the HTML/XML report (target/pit-reports or build/reports/pitest); console output has only the summary."],
      };
    },
  },
  {
    id: "stryker-net",
    label: "Stryker.NET (C#)",
    verified: false,
    detect: (r) => anyFile(r, /\.sln$/) && /dotnet-stryker/.test(read(r, ".config/dotnet-tools.json") + read(r, "stryker-config.json")),
    plan: (files) => {
      const cs = sourceFiles(files, ext(".cs"));
      return cs.length ? { args: ["dotnet", "stryker", ...cs.flatMap((f) => ["--mutate", f])], notes: ["Check `dotnet stryker --help`; --mutate scoping is from memory."] } : null;
    },
  },
  {
    id: "go-mutesting",
    label: "go-mutesting (Go)",
    verified: false,
    detect: (r) => has(r, "go.mod"),
    plan: (files) => {
      const pkgs = [...new Set(sourceFiles(files, ext(".go")).map((f) => `./${path.dirname(f)}/...`))];
      return pkgs.length ? { args: ["go-mutesting", ...pkgs], notes: ["Install: go install github.com/avito-tech/go-mutesting/cmd/go-mutesting@latest"] } : null;
    },
  },
];

// Changed files vs base (default: uncommitted changes), plus untracked files.
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

export function detectTools(repo) {
  const found = TOOLS.filter((t) => t.detect(repo));
  const ids = new Set(found.map((t) => t.id));
  return found.filter((t) => !(t.excludes ?? []).some((x) => ids.has(x)));
}

function expand(args, files) {
  return args.flatMap((a) => (a === "{files}" ? files : a === "{files,}" ? [files.join(",")] : [a]));
}

// All runnable plans for this repo: the project override if set, else every
// detected tool that has something mutable in the change set.
export function plansFor(repo, files, { base = null, override = null } = {}) {
  const ctx = {
    repo,
    base: base ?? "main",
    diffFile: () => {
      const f = path.join(os.tmpdir(), `canon-mutate-${process.pid}.diff`);
      fs.writeFileSync(f, execFileSync("git", ["-C", repo, "diff", base ? `${base}...HEAD` : "HEAD"], { encoding: "utf8" }));
      return f;
    },
  };
  if (override) {
    const src = files.filter((f) => !isTest(f));
    if (!src.length) return [];
    return [{ id: "custom", args: [override.cmd, ...expand(override.args ?? [], src)], notes: override.notes ?? [], verified: true }];
  }
  return detectTools(repo)
    .map((t) => {
      const p = t.plan(files, ctx);
      return p && { id: t.id, label: t.label, verified: t.verified, ...p };
    })
    .filter(Boolean);
}

const KEEP =
  /\b(UNTESTED|UNCOVERED|SURVIVED|Survived|Escaped|ESCAPED|MISSED|Missed|FAIL|alive|Alive)\b|^\s*(Score|Mutation Score|Mutations?:|Mutation score|The mutation score|Generated \d+ mutations|\d+ mutants?)/;

// Survivors and score only; drops diffs, progress and passing mutants.
export function filterSurvivors(text, max = 40) {
  const lines = text.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).filter((l) => KEEP.test(l));
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`... ${lines.length - max} more`);
  return shown.join("\n");
}

function exec(repo, args) {
  const r = spawnPortable(args[0], args.slice(1), { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { raw: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, status: r.status, error: r.error };
}

export function runMutation(repo, { base, override } = {}) {
  const files = changedFiles(repo, base);
  const plans = plansFor(repo, files, { base, override });
  const results = plans.map((p) => {
    const r = exec(repo, p.args);
    const after = p.after ? exec(repo, p.after) : null;
    const raw = r.raw + (after ? "\n" + after.raw : "");
    const filtered = filterSurvivors(raw);
    const tail = raw.trim().split("\n").slice(-15).join("\n");
    const output = filtered || (r.error ? `could not start ${p.args[0]}: ${r.error.message}` : r.status === 0 ? "no surviving mutants reported" : tail);
    return { id: p.id, notes: p.notes, verified: p.verified, status: r.status, output };
  });
  return { files, results };
}
