// Detects how codegraph is set up for a repo and plans only the missing pieces.
// It never edits files git tracks (.mcp.json, .claude/settings.json, CLAUDE.md).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

const git = (repo, args) => {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

export function cliPath(env = process.env) {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    const f = path.join(dir, "codegraph");
    if (dir && fs.existsSync(f)) return f;
  }
  return null;
}

// Every place the codegraph MCP server is registered for this repo.
export function wiring(repo, home = os.homedir()) {
  const found = [];
  if (readJson(path.join(repo, ".mcp.json"))?.mcpServers?.codegraph) found.push("repo .mcp.json");
  const user = readJson(path.join(home, ".claude.json"));
  if (user?.projects?.[repo]?.mcpServers?.codegraph) found.push("user config, this project only");
  if (user?.mcpServers?.codegraph) found.push("user config, all projects");
  return found;
}

export function inspect(repo, { home, env } = {}) {
  const dir = path.join(repo, ".codegraph");
  const hasIndex = fs.existsSync(path.join(dir, "codegraph.db"));
  const tracked = (git(repo, ["ls-files", ".codegraph"]) ?? "").split("\n").filter(Boolean);
  return {
    repo,
    cli: cliPath(env),
    index: hasIndex,
    wired: wiring(repo, home),
    ignored: git(repo, ["check-ignore", "-q", ".codegraph"]) !== null,
    tracked,
    // everything tracked besides the self-ignoring .gitignore is a problem (db committed)
    trackedIndexFiles: tracked.filter((f) => f !== ".codegraph/.gitignore"),
    isGit: git(repo, ["rev-parse", "--git-dir"]) !== null,
  };
}

// Ordered actions for the gaps only. `run` is performed by apply().
export function plan(s) {
  const actions = [];
  if (!s.cli) {
    actions.push({ what: "install the CLI (not done automatically)", manual: "npm i -g @colbymchenry/codegraph" });
    return actions;
  }
  if (!s.index) actions.push({ what: "build the index", cmd: ["codegraph", "init", s.repo] });
  if (!s.wired.length) {
    actions.push({
      what: "register the MCP server for this project only (user config, telemetry off)",
      cmd: ["claude", "mcp", "add", "--scope", "local", "-e", "CODEGRAPH_TELEMETRY=0", "codegraph", "--", "codegraph", "serve", "--mcp"],
      cwd: s.repo,
    });
  }
  if (s.index && s.isGit && !s.ignored && s.tracked.length === 0) {
    actions.push({ what: "hide .codegraph/ locally (.git/info/exclude, never committed)", exclude: true });
  }
  return actions;
}

export function apply(s, actions, { run = defaultRun } = {}) {
  const log = [];
  for (const a of actions) {
    if (a.manual) {
      log.push(`manual: ${a.manual}`);
      continue;
    }
    if (a.exclude) {
      const rel = git(s.repo, ["rev-parse", "--git-path", "info/exclude"])?.trim();
      const file = rel && path.resolve(s.repo, rel);
      if (file) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        if (!/^\.codegraph\/?$/m.test(cur)) fs.appendFileSync(file, `${cur && !cur.endsWith("\n") ? "\n" : ""}.codegraph/\n`);
        log.push(`done: ${a.what}`);
      }
      continue;
    }
    const r = run(a.cmd, a.cwd ?? s.repo);
    log.push(r.status === 0 ? `done: ${a.what}` : `FAILED: ${a.what} (${a.cmd.join(" ")}): ${(r.stderr || r.error?.message || "").trim().split("\n").pop()}`);
  }
  return log;
}

function defaultRun(cmd, cwd) {
  return spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf8", timeout: 600000 });
}

export function describe(s) {
  const L = [`${s.repo}`];
  L.push(`  cli:      ${s.cli ?? "not installed"}`);
  L.push(`  index:    ${s.index ? "present" : "missing"}`);
  L.push(`  wired:    ${s.wired.length ? s.wired.join("; ") : "no"}${s.wired.length > 1 ? "  (duplicate: remove all but one)" : ""}`);
  if (s.index) L.push(`  git:      ${s.ignored ? "ignored" : "not ignored"}${s.tracked.length ? `, tracked: ${s.tracked.join(", ")}` : ""}`);
  if (s.trackedIndexFiles.length) L.push(`  WARNING:  index files are committed: ${s.trackedIndexFiles.join(", ")}`);
  return L.join("\n");
}
