// Logic behind the Claude Code hooks. Kept pure/testable; hooks/*.mjs are thin wrappers.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBehaviors } from "./markdown.mjs";
import { validate } from "./validate.mjs";
import { listDocs, loadConfig, loadLocal, saveLocal } from "./vault.mjs";
import { gitTop, normalizeRemote, originOf } from "./remote.mjs";
import { pullIfDue, syncSettings, vaultState } from "./sync.mjs";
import { checkAnchors, repoFor } from "./anchors.mjs";
import { configDir, isWithin } from "./platform.mjs";
import { inspect as cgInspect } from "./codegraph.mjs";
import { formatResults, planChecks, runChecks } from "./check.mjs";
import { changedFiles } from "./mutation.mjs";

// Vault location: $CANON_VAULT, else the path stored in <config dir>/vault
// (~/.config/canon on Linux and macOS, %APPDATA%\canon on Windows).
export function resolveVault() {
  if (process.env.CANON_VAULT) return path.resolve(process.env.CANON_VAULT);
  for (const dir of [configDir(process.env, process.platform, os.homedir()), path.join(os.homedir(), ".config", "canon")]) {
    const f = path.join(dir, "vault");
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  }
  return null;
}

// Project whose mapped repo contains cwd (longest match wins), else null.
export function projectForCwd(config, cwd) {
  let best = null;
  for (const [slug, p] of Object.entries(config.projects ?? {})) {
    if (!p.repo) continue; // known by remote only, not mapped on this device
    const repo = path.resolve(p.repo);
    if (isWithin(repo, cwd) && (!best || repo.length > best.len)) {
      best = { slug, len: repo.length };
    }
  }
  return best?.slug ?? null;
}

// Which project is this directory in? Path first; otherwise by git remote, which
// is how a repo is recognized on a device where it was never mapped by hand.
// A second clone of an already-mapped repo is left alone rather than guessed at.
export function resolveProject(vault, cwd) {
  const config = loadConfig(vault);
  const byPath = projectForCwd(config, cwd);
  if (byPath) return byPath;
  const top = gitTop(cwd);
  const remote = top && normalizeRemote(originOf(top));
  if (!remote) return null;
  const slug = Object.entries(config.projects ?? {}).find(([, p]) => p.remote && (p.remote === remote || normalizeRemote(p.remote) === remote))?.[0];
  if (!slug) return null;
  const current = config.projects[slug].repo;
  if (current && fs.existsSync(current)) return null;
  const local = loadLocal(vault);
  local.projects ??= {};
  local.projects[slug] = { ...local.projects[slug], repo: path.resolve(top) };
  saveLocal(vault, local);
  return slug;
}

const inProject = (d, project) => d.data?.project === project;

// Unfinished specs and their open behaviors.
export function openWork(vault, project) {
  const out = [];
  for (const d of listDocs(vault)) {
    if (d.data?.type !== "spec" || !inProject(d, project)) continue;
    if (!["draft", "active", "needs-review"].includes(d.data.status)) continue;
    const { items } = parseBehaviors(d.body);
    out.push({
      id: d.data.id,
      status: d.data.status,
      done: items.filter((b) => b.state === "done").length,
      total: items.length,
      open: items.filter((b) => b.state !== "done").map((b) => `${b.id} [${b.state}] ${b.text}`),
    });
  }
  return out;
}

export function projectFindings(vault, project) {
  return validate(vault).filter((f) => f.startsWith(`projects${path.sep}${project}${path.sep}`) || f.startsWith(`projects/${project}/`));
}

export function staleFor(vault, project) {
  const repo = repoFor(loadConfig(vault), project);
  if (!repo) return [];
  const out = [];
  for (const d of listDocs(vault)) {
    if (d.data?.type !== "spec" || d.data.status !== "active" || !inProject(d, project)) continue;
    const problems = checkAnchors(repo, d.data.anchors ?? []);
    if (problems.length) out.push({ id: d.data.id, problems });
  }
  return out;
}

export function sessionBrief(vault, project, { pull = null } = {}) {
  const work = openWork(vault, project);
  const findings = projectFindings(vault, project);
  const stale = staleFor(vault, project);
  const lines = [
    `Canon: project "${project}", vault ${vault}.`,
    `Find existing docs with \`canon query <words>\` and read one section with \`canon show <id> --section <Name>\` instead of opening whole files. Create docs only with \`canon new <type> ${project} <slug>\`, then fill the sections. Never hand-write frontmatter. Track behaviors with \`canon task\`, record code a spec governs with \`canon anchor\`, check with \`canon validate\` and \`canon stale\`.`,
  ];
  const repo = repoFor(loadConfig(vault), project);
  if (repo) {
    const cg = cgInspect(repo);
    if (cg.index && cg.wired.length) lines.push("Code graph is available: for \"how does X work\" or \"where is X used\" questions, call `codegraph_explore` before grepping.");
    if (loadConfig(vault).projects?.[project]?.quicksilver === true) lines.push("Quicksilver (`qs`) is allowed in this project for bulk fuzzy triage; do not use it for decisions.");
  }
  const agents = Object.entries(loadConfig(vault).agents ?? {}).filter(([, v]) => v === true).map(([k]) => k);
  if (agents.length) lines.push(`Opt-in subagents enabled: ${agents.map((a) => `canon:${a}`).join(", ")}. Use them only where a skill says to.`);
  if (pull && !pull.ok && pull.skipped) lines.push(`Vault sync: ${pull.skipped}.`);
  const vs = vaultState(vault);
  if (vs.git && vs.hasRemote && vs.ahead > 0) lines.push(`Vault has ${vs.ahead} commit(s) not pushed; \`canon sync\` publishes them.`);
  if (work.length) {
    lines.push("Open specs:");
    for (const w of work) {
      lines.push(`- ${w.id} [${w.status}] ${w.done}/${w.total} done`);
      for (const o of w.open.slice(0, 5)) lines.push(`  - ${o}`);
    }
  } else lines.push("No open specs.");
  for (const s of stale) lines.push(`Stale: ${s.id} (${s.problems.map((p) => `${p.kind} ${p.anchor}`).join(", ")}) - review, then \`canon verify ${s.id}\`.`);
  if (findings.length) lines.push(`Doc validation: ${findings.length} finding(s). Run \`canon validate\`.`);
  return lines.join("\n");
}

export function compactNotes(vault, project) {
  const work = openWork(vault, project);
  const lines = [
    `Keep in the summary: the project slug "${project}" and vault path ${vault}; the active spec id(s) and which behaviors are open; files changed so far; failing tests and their errors; decisions made in this session that are not yet in a spec or ADR.`,
  ];
  for (const w of work) lines.push(`Open: ${w.id} ${w.done}/${w.total} done${w.open.length ? "; open " + w.open.map((o) => o.split(" ")[0]).join(", ") : ""}.`);
  return lines.join("\n");
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// Fingerprint of uncommitted changes; null if not a git repo.
export function gitState(repo, paths = []) {
  const status = git(repo, ["status", "--porcelain", ...(paths.length ? ["--", ...paths] : [])]);
  if (status === null) return null;
  if (!status.trim()) return "";
  const diff = git(repo, ["diff", "HEAD", ...(paths.length ? ["--", ...paths] : [])]) ?? "";
  return crypto.createHash("sha256").update(status + diff).digest("hex").slice(0, 16);
}

const tmpFile = (kind, key) =>
  path.join(os.tmpdir(), `canon-${kind}-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)}`);

// Session start marker, so "did docs change this session" does not depend on git
// state (a mid-session `canon sync` commits the docs and would hide the edit).
// Kept per repo; an unchanged session id (compaction, resume) keeps the first time.
export function markSession(vault, project, sessionId) {
  const repo = repoFor(loadConfig(vault), project);
  if (!repo) return;
  const f = tmpFile("session", repo);
  try {
    if (JSON.parse(fs.readFileSync(f, "utf8")).id === (sessionId ?? "none")) return;
  } catch {
    // first session for this repo
  }
  fs.writeFileSync(f, JSON.stringify({ id: sessionId ?? "none", ms: Date.now() }));
}

export function sessionStartMs(vault, project) {
  const repo = repoFor(loadConfig(vault), project);
  try {
    return JSON.parse(fs.readFileSync(tmpFile("session", repo), "utf8")).ms;
  } catch {
    return null;
  }
}

export function docsTouchedSince(vault, project, ms) {
  const root = path.join(vault, "projects", project);
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return false;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (walk(p)) return true;
      } else if (e.name.endsWith(".md") && fs.statSync(p).mtimeMs > ms) return true;
    }
    return false;
  };
  return walk(root);
}

// "No doc needed for the current changes": ties the skip to the exact diff.
export function writeSkip(repo) {
  const state = gitState(repo);
  if (!state) throw new Error("no uncommitted changes to skip");
  fs.writeFileSync(tmpFile("skip", repo), state);
}

function skipped(repo, state) {
  const f = tmpFile("skip", repo);
  return fs.existsSync(f) && fs.readFileSync(f, "utf8") === state;
}

// Why the turn should not end yet, or [] if fine.
export function stopReasons(vault, project, { since = null } = {}) {
  const reasons = [];
  const findings = projectFindings(vault, project);
  if (findings.length) reasons.push(`canon validate found ${findings.length} problem(s):\n${findings.slice(0, 8).map((f) => `- ${f}`).join("\n")}`);
  for (const s of staleFor(vault, project)) {
    reasons.push(`Spec ${s.id} is stale (${s.problems.map((p) => `${p.kind} ${p.anchor}`).join(", ")}). Update the spec to match the code, then run \`canon verify ${s.id}\`.`);
  }
  const repo = repoFor(loadConfig(vault), project);
  const code = repo ? gitState(repo) : null;
  const docs = gitState(vault, [path.join("projects", project)]);
  const touched = since != null ? docsTouchedSince(vault, project, since) : null;
  const docsChanged = (docs !== null && docs !== "") || touched === true;
  const known = docs !== null || touched !== null;
  if (code && known && !docsChanged && !skipped(repo, code)) {
    reasons.push(
      `Code changed in ${repo} but no doc changed under projects/${project}. Update or create the spec (\`canon new spec ${project} <slug>\`, \`canon task\`, \`canon anchor\`). If these changes need no doc, run \`canon skip-docs\` in the repo.`,
    );
  }
  // Opt-in fast quality checks (projects.<slug>.checks.onStop = true).
  const checks = loadConfig(vault).projects?.[project]?.checks;
  if (checks?.onStop && repo && code) {
    const plans = planChecks(repo, changedFiles(repo), { override: checks, fast: true });
    const failed = runChecks(repo, plans).filter((r) => !r.ok);
    if (failed.length) reasons.push(`Quality checks failed on the changed files. Fix them:\n${formatResults(failed)}`);
  }
  return reasons;
}

// Block each distinct reason set once per session; a repeat means the model
// disagrees or cannot fix it, so let the turn end instead of looping.
export function shouldBlock(sessionId, reasons) {
  if (!reasons.length) return false;
  const f = tmpFile("stop", sessionId || "none");
  const sig = crypto.createHash("sha256").update(reasons.join("\n")).digest("hex");
  const seen = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n") : [];
  if (seen.includes(sig)) return false;
  fs.appendFileSync(f, sig + "\n");
  return true;
}
