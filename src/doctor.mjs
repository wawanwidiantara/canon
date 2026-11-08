// `canon doctor`: what is set up, what is missing, and the exact fix for each.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoFor } from "./anchors.mjs";
import { inspect as cgInspect } from "./codegraph.mjs";
import { resolveProject, resolveVault } from "./context.mjs";
import { findOnPath } from "./platform.mjs";
import { browsersDir, chromiumFolders, findBrowserBinary, missingLibraries, packageInstalled, usesPlaywright } from "./playwright.mjs";
import { SCHEMA_VERSION } from "./schema.mjs";
import { vaultState } from "./sync.mjs";
import { loadConfig } from "./vault.mjs";

export const MIN_NODE = [22, 13];

const ok = (name, detail = "") => ({ level: "ok", name, detail });
const warn = (name, detail, fix) => ({ level: "warn", name, detail, fix });
const fail = (name, detail, fix) => ({ level: "FAIL", name, detail, fix });

export function nodeCheck(version = process.versions.node) {
  const [maj, min] = version.split(".").map(Number);
  return maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1])
    ? ok("node", `v${version}`)
    : fail("node", `v${version} is too old`, `install Node ${MIN_NODE.join(".")} or newer (hooks and the CLI need it)`);
}

// Is `canon` allowed in Claude Code's permission rules (user or project settings)?
export function permissionCheck(cwd, home = os.homedir()) {
  const files = [path.join(home, ".claude", "settings.json"), path.join(home, ".claude", "settings.local.json"), path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json")];
  for (const f of files) {
    try {
      const allow = JSON.parse(fs.readFileSync(f, "utf8")).permissions?.allow ?? [];
      if (allow.some((r) => /^Bash\(canon(:\*|\s\*|\))/.test(r) || r === "Bash")) return ok("permission", `canon allowed in ${f.replace(home, "~")}`);
    } catch {
      // missing or unreadable file
    }
  }
  return warn("permission", "`Bash(canon:*)` is not in any permissions.allow list", "add \"Bash(canon:*)\" to permissions.allow in ~/.claude/settings.json so the agent can run canon without a prompt");
}

const lddListing = (bin) => {
  try {
    return execFileSync("ldd", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 });
  } catch {
    return null;
  }
};

// Can this machine run browser tests for this repo? Silent when the repo does not use Playwright.
// `run(binary)` lists a binary's shared libraries (ldd); the system, home folder and environment are
// parameters so every system can be checked from one machine. Nothing is installed or launched.
export function frontendCheck(repo, { platform = process.platform, home = os.homedir(), env = process.env, run = lddListing } = {}) {
  if (!usesPlaywright(repo)) return [];
  const out = [];
  out.push(packageInstalled(repo) ? ok("playwright", "installed in the repo") : warn("playwright", "the repo uses Playwright but it is not installed here", "run `npm install` (or your package manager's install) in the repo"));
  const dir = browsersDir({ repo, platform, home, env });
  const folders = chromiumFolders(dir);
  if (!folders.length) {
    out.push(warn("playwright browser", `no Chromium downloaded in ${dir}`, "run `npx playwright install chromium` in the repo"));
    return out;
  }
  out.push(ok("playwright browser", dir));
  if (platform !== "linux") return out;
  const bin = findBrowserBinary(dir, folders);
  const listing = bin ? run(bin) : null;
  if (listing == null) return out;
  const missing = missingLibraries(listing);
  out.push(
    missing.length
      ? warn("playwright libraries", `the browser is missing system libraries: ${missing.join(", ")}`, "run `sudo npx playwright install-deps chromium`. It needs a terminal with administrator rights, so run it yourself; the agent cannot")
      : ok("playwright libraries", "all present"),
  );
  return out;
}

export function doctor({ cwd = process.cwd(), env = process.env, home = os.homedir() } = {}) {
  const out = [nodeCheck()];
  out.push(findOnPath("git", { env }) ? ok("git") : fail("git", "not found on PATH", "install git"));

  let vault = null;
  try {
    vault = resolveVault();
  } catch {
    // handled below
  }
  if (!vault) {
    out.push(fail("vault", "no vault configured on this device", "run `canon init <dir>` to create one, or `canon setup <dir>` to use an existing clone"));
    return out;
  }
  if (!fs.existsSync(path.join(vault, "canon.config.json"))) {
    out.push(fail("vault", `${vault} has no canon.config.json`, "run `canon init` there, or point `canon setup` at the right folder"));
    return out;
  }
  out.push(ok("vault", vault));

  let config;
  try {
    config = loadConfig(vault);
  } catch (e) {
    out.push(fail("config", `canon.config.json is not valid JSON (${e.message})`, "fix the file, or restore it from git"));
    return out;
  }
  const sv = config.schema_version ?? 1;
  out.push(sv > SCHEMA_VERSION ? fail("schema", `vault uses schema ${sv}, this tool supports ${SCHEMA_VERSION}`, "update canon") : ok("schema", `version ${sv}`));

  const vs = vaultState(vault);
  if (!vs.git) out.push(warn("vault git", "the vault is not a git repo, so it cannot sync between devices", "run `git init` in the vault and add a private remote"));
  else if (!vs.hasRemote) out.push(warn("vault git", "no remote configured", "git remote add origin <private-repo-url> && git push -u origin main"));
  else out.push(vs.dirty || vs.ahead > 0 ? warn("vault git", `${vs.dirty} uncommitted change(s), ${vs.ahead ?? "?"} unpushed commit(s)`, "run `canon sync`") : ok("vault git", "clean and pushed"));

  for (const [slug, p] of Object.entries(config.projects ?? {})) {
    const repo = repoFor(config, slug);
    if (!repo) out.push(warn(`project ${slug}`, "not mapped on this device", p.remote ? `clone ${p.remote} and open it (it is found by its remote), or run \`canon map ${slug} <path>\`` : `run \`canon map ${slug} <path>\``));
    else if (!fs.existsSync(repo)) out.push(warn(`project ${slug}`, `${repo} does not exist`, `run \`canon map ${slug} <new path>\``));
    else if (!p.remote) out.push(warn(`project ${slug}`, "no git remote recorded, so other devices cannot find it by themselves", `add an origin remote to the repo, then \`canon map ${slug} ${repo}\``));
    else out.push(ok(`project ${slug}`, repo));
  }

  for (const slug of Object.keys(config.projects ?? {})) {
    const repo = repoFor(config, slug);
    if (repo) for (const r of frontendCheck(repo, { home, env })) out.push({ ...r, name: `${r.name} ${slug}` });
  }

  const here = resolveProject(vault, cwd);
  out.push(here ? ok("this directory", `project ${here}`) : warn("this directory", "not inside a mapped repo, so hooks stay silent here", "`canon map <project> <path>` (or open a repo whose remote is in the vault)"));
  out.push(permissionCheck(cwd, home));

  const cg = findOnPath("codegraph", { env });
  if (here) {
    const repo = repoFor(config, here);
    const s = cg ? cgInspect(repo) : null;
    out.push(!cg ? warn("codegraph", "CLI not installed (optional)", "npm i -g @colbymchenry/codegraph") : s.index && s.wired.length ? ok("codegraph", "indexed and wired") : warn("codegraph", "installed but this repo is not indexed or wired", "`canon codegraph --setup`"));
  } else out.push(cg ? ok("codegraph", "CLI installed") : warn("codegraph", "CLI not installed (optional)", "npm i -g @colbymchenry/codegraph"));
  // The skill runs as `node <skill dir>/scripts/qs.mjs`; a `qs` on PATH is the other way to have it.
  const qsSkill = path.join(home, ".claude", "skills", "quicksilver", "scripts", "qs.mjs");
  if (findOnPath("qs", { env }) || fs.existsSync(qsSkill)) {
    const hasKey = Boolean(env.JEV_API_KEY || env.TYPESAFE_API_KEY) || fs.existsSync(path.join(env.QUICKSILVER_HOME || path.join(home, ".quicksilver"), "config.json"));
    out.push(
      !hasKey
        ? warn("quicksilver", "installed but no API key found", "put the key in ~/.quicksilver/config.json (see docs/integrations.md)")
        : env.QUICKSILVER_API_BASE
          ? warn("quicksilver", `installed; QUICKSILVER_API_BASE is set (${env.QUICKSILVER_API_BASE}), so files and the key go there`, "unset it, or list its host in quicksilverHosts and keep it deliberate")
          : ok("quicksilver", "installed, key found; agents run it as `canon qs` (gated per project)"),
    );
  } else out.push(warn("quicksilver", "not installed (optional)", "see the README"));
  return out;
}

export function formatDoctor(results) {
  const lines = results.map((r) => `${r.level.padEnd(4)} ${r.name}${r.detail ? ` - ${r.detail}` : ""}${r.fix ? `\n     fix: ${r.fix}` : ""}`);
  const bad = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "warn").length;
  return `${lines.join("\n")}\n\n${bad} problem(s), ${warns} warning(s)`;
}
