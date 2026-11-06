// Logic behind the Claude Code hooks. Kept pure/testable; hooks/*.mjs are thin wrappers.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBehaviors } from "./markdown.mjs";
import { validate } from "./validate.mjs";
import { listDocs, loadConfig } from "./vault.mjs";
import { checkAnchors, repoFor } from "./anchors.mjs";

// Vault location: $BRAIN_VAULT, else the path in ~/.config/brain/vault.
export function resolveVault() {
  if (process.env.BRAIN_VAULT) return path.resolve(process.env.BRAIN_VAULT);
  const f = path.join(os.homedir(), ".config", "brain", "vault");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  return null;
}

// Project whose mapped repo contains cwd (longest match wins), else null.
export function projectForCwd(config, cwd) {
  let best = null;
  for (const [slug, p] of Object.entries(config.projects ?? {})) {
    const repo = path.resolve(p.repo);
    if ((cwd === repo || cwd.startsWith(repo + path.sep)) && (!best || repo.length > best.len)) {
      best = { slug, len: repo.length };
    }
  }
  return best?.slug ?? null;
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

export function sessionBrief(vault, project) {
  const work = openWork(vault, project);
  const findings = projectFindings(vault, project);
  const stale = staleFor(vault, project);
  const lines = [
    `Project brain: project "${project}", vault ${vault}.`,
    `Find existing docs with \`brain query <words>\` and read one section with \`brain show <id> --section <Name>\` instead of opening whole files. Create docs only with \`brain new <type> ${project} <slug>\`, then fill the sections. Never hand-write frontmatter. Track behaviors with \`brain task\`, record code a spec governs with \`brain anchor\`, check with \`brain validate\` and \`brain stale\`.`,
  ];
  if (work.length) {
    lines.push("Open specs:");
    for (const w of work) {
      lines.push(`- ${w.id} [${w.status}] ${w.done}/${w.total} done`);
      for (const o of w.open.slice(0, 5)) lines.push(`  - ${o}`);
    }
  } else lines.push("No open specs.");
  for (const s of stale) lines.push(`Stale: ${s.id} (${s.problems.map((p) => `${p.kind} ${p.anchor}`).join(", ")}) - review, then \`brain verify ${s.id}\`.`);
  if (findings.length) lines.push(`Doc validation: ${findings.length} finding(s). Run \`brain validate\`.`);
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
  path.join(os.tmpdir(), `brain-${kind}-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)}`);

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
export function stopReasons(vault, project) {
  const reasons = [];
  const findings = projectFindings(vault, project);
  if (findings.length) reasons.push(`brain validate found ${findings.length} problem(s):\n${findings.slice(0, 8).map((f) => `- ${f}`).join("\n")}`);
  for (const s of staleFor(vault, project)) {
    reasons.push(`Spec ${s.id} is stale (${s.problems.map((p) => `${p.kind} ${p.anchor}`).join(", ")}). Update the spec to match the code, then run \`brain verify ${s.id}\`.`);
  }
  const repo = repoFor(loadConfig(vault), project);
  const code = repo ? gitState(repo) : null;
  const docs = gitState(vault, [path.join("projects", project)]);
  if (code && docs === "" && !skipped(repo, code)) {
    reasons.push(
      `Code changed in ${repo} but no doc changed under projects/${project}. Update or create the spec (\`brain new spec ${project} <slug>\`, \`brain task\`, \`brain anchor\`). If these changes need no doc, run \`brain skip-docs\` in the repo.`,
    );
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
