// Packets: an approved phase doc, claimed by one agent in its own git worktree.
//
// A phase may carry `owns: ["src/auth/", "tests/auth/**"]` in its frontmatter,
// the paths its work may touch. `canon claim` refuses a phase that is not
// approved, has unfinished dependencies, or owns paths another live claim
// already owns. A PreToolUse hook then denies edits outside those paths in the
// claimed worktree. Scripts decide; the agent only does the work.
//
// Claims live in <vault>/.canon/claims.json: device-local, never committed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mainRepoFor } from "./anchors.mjs";
import { writeAtomic } from "./fsx.mjs";
import { parseBehaviors } from "./markdown.mjs";
import { DELIVERED } from "./schema.mjs";
import { canonical, isWithin, toPosix } from "./platform.mjs";
import { findDoc, listDocs, loadConfig, lockVault } from "./vault.mjs";

const claimsFile = (vault) => path.join(vault, ".canon", "claims.json");

export function loadClaims(vault) {
  try {
    return JSON.parse(fs.readFileSync(claimsFile(vault), "utf8")).claims ?? {};
  } catch {
    return {};
  }
}

function saveClaims(vault, claims) {
  fs.mkdirSync(path.dirname(claimsFile(vault)), { recursive: true });
  writeAtomic(claimsFile(vault), JSON.stringify({ claims }, null, 2) + "\n");
}

// ---- ownership paths -------------------------------------------------------

const clean = (p) => toPosix(String(p)).replace(/^\.\//, "");

// Throws on an entry that could escape the repo or means nothing.
export function checkOwns(owns) {
  if (!Array.isArray(owns) || !owns.length) throw new Error("owns must be a non-empty list of repo paths");
  for (const raw of owns) {
    const p = clean(raw);
    if (typeof raw !== "string" || !p) throw new Error("owns has an empty entry");
    if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) throw new Error(`owns entry '${raw}' must be a path inside the repo`);
  }
}

// Does a repo-relative path fall under one of the owned entries?
export function owned(owns, rel) {
  const r = clean(rel);
  return owns.some((raw) => {
    const e = clean(raw);
    if (/[*?]/.test(e)) {
      const re = e
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\/?/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, "(?:.*/)?");
      return new RegExp(`^${re}$`).test(r);
    }
    return e.endsWith("/") ? r.startsWith(e) : r === e || r.startsWith(e + "/");
  });
}

// Conservative: true when two owns lists could cover the same file.
export function overlaps(a, b) {
  const parts = (raw) => {
    const e = clean(raw).replace(/\/$/, "");
    const cut = e.search(/[*?]/);
    const stat = cut === -1 ? e : e.slice(0, cut);
    const comps = stat.split("/").filter(Boolean);
    const partial = cut !== -1 && !stat.endsWith("/") && comps.length > 0;
    return { comps, partial };
  };
  return a.some((x) => b.some((y) => {
    const px = parts(x);
    const py = parts(y);
    const n = Math.min(px.comps.length, py.comps.length);
    for (let i = 0; i < n; i++) {
      const [c, d] = [px.comps[i], py.comps[i]];
      const lastX = i === px.comps.length - 1 && px.partial;
      const lastY = i === py.comps.length - 1 && py.partial;
      if (lastX || lastY) return c.startsWith(d) || d.startsWith(c);
      if (c !== d) return false;
    }
    return true;
  }));
}

// ---- claim / release -------------------------------------------------------

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function mustPhase(vault, id) {
  const doc = findDoc(vault, id);
  if (!doc?.data) throw new Error(`no doc with id '${id}'`);
  if (doc.data.type !== "phase") throw new Error(`${id} is a ${doc.data.type}; only phases can be claimed`);
  return doc;
}

// Why this phase cannot be claimed right now, or [] when it can.
export function blockers(vault, doc, claims = loadClaims(vault)) {
  const out = [];
  const id = doc.data.id;
  if (doc.data.status !== "active") out.push(`${id} is ${doc.data.status}; a person must approve it first`);
  try {
    checkOwns(doc.data.owns);
  } catch (e) {
    out.push(`${id}: ${e.message}`);
  }
  if (claims[id]) out.push(`${id} is already claimed by ${claims[id].agent}`);
  for (const dep of doc.data.depends_on ?? []) {
    const depId = String(dep).replace(/^\[\[|\]\]$/g, "");
    const d = findDoc(vault, depId);
    const ok = d?.data && (d.data.type === "phase" ? d.data.status === "completed" : DELIVERED.includes(d.data.status));
    if (!ok) out.push(`waits for ${depId}${d?.data ? ` (${d.data.status})` : " (not found)"}`);
  }
  if (Array.isArray(doc.data.owns)) {
    for (const [otherId, c] of Object.entries(claims)) {
      if (otherId !== id && c.project === doc.data.project && overlaps(doc.data.owns, c.owns)) out.push(`owns paths that ${otherId} (${c.agent}) already owns`);
    }
  }
  return out;
}

export function claim(vault, phaseId, { agent = "agent", worktree = true } = {}) {
  return lockVault(vault, "claims", () => {
    const doc = mustPhase(vault, phaseId);
    const claims = loadClaims(vault);
    const why = blockers(vault, doc, claims);
    if (why.length) throw new Error(`cannot claim ${phaseId}:\n${why.map((w) => `- ${w}`).join("\n")}`);
    const project = doc.data.project;
    const repo = mainRepoFor(loadConfig(vault), project);
    if (!repo) throw new Error(`project '${project}' has no repo mapped; run \`canon map\``);
    const main = canonical(repo);
    const entry = { project, agent, owns: doc.data.owns.map(clean), base_sha: git(main, ["rev-parse", "HEAD"]), claimed_at: new Date().toISOString(), worktree: null, branch: null };
    if (worktree) {
      entry.branch = `canon/${phaseId}`;
      const dir = path.join(path.dirname(main), `${path.basename(main)}-wt`, phaseId);
      git(main, ["worktree", "add", "-q", dir, "-b", entry.branch]);
      entry.worktree = canonical(dir);
    }
    claims[phaseId] = entry;
    saveClaims(vault, claims);
    return { phaseId, ...entry };
  });
}

export function release(vault, phaseId, { removeWorktree = false } = {}) {
  return lockVault(vault, "claims", () => {
    const claims = loadClaims(vault);
    const c = claims[phaseId];
    if (!c) throw new Error(`${phaseId} is not claimed`);
    if (removeWorktree && c.worktree) {
      const main = canonical(mainRepoFor(loadConfig(vault), c.project));
      git(main, ["worktree", "remove", c.worktree]); // refuses when the worktree has uncommitted work
    }
    delete claims[phaseId];
    saveClaims(vault, claims);
    return c;
  });
}

// ---- views -----------------------------------------------------------------

// Approved phases of a project, with the reasons each one cannot start yet.
export function readiness(vault, project) {
  const claims = loadClaims(vault);
  const ready = [];
  const blocked = [];
  for (const d of listDocs(vault)) {
    if (d.data?.type !== "phase" || (project && d.data.project !== project)) continue;
    if (d.data.status !== "active" || claims[d.data.id]) continue;
    const why = blockers(vault, d, claims);
    (why.length ? blocked : ready).push({ id: d.data.id, why });
  }
  return { ready, blocked };
}

export function board(vault) {
  return Object.entries(loadClaims(vault)).map(([id, c]) => {
    const doc = findDoc(vault, id);
    const refs = (doc?.body ?? "").match(/\[\[([^\]#]+)#(B\d+)\]\]/g) ?? [];
    let done = 0;
    for (const r of refs) {
      const [, sid, bid] = /\[\[([^\]#]+)#(B\d+)\]\]/.exec(r);
      const spec = findDoc(vault, sid);
      if (spec && parseBehaviors(spec.body).items.find((b) => b.id === bid)?.state === "done") done++;
    }
    return { id, ...c, done, total: refs.length };
  });
}

// Files changed since the claim that the phase does not own. The backstop for
// edits the hook cannot see (a shell redirect, `sed -i`).
export function outsideOwns(vault, phaseId) {
  const c = loadClaims(vault)[phaseId];
  if (!c) throw new Error(`${phaseId} is not claimed`);
  const dir = c.worktree ?? canonical(mainRepoFor(loadConfig(vault), c.project));
  const names = new Set();
  for (const args of [["diff", "--name-only", c.base_sha], ["ls-files", "--others", "--exclude-standard"]]) {
    for (const n of git(dir, args).split("\n")) if (n.trim()) names.add(n.trim());
  }
  return [...names].filter((n) => !owned(c.owns, n));
}

// ---- the edit guard ---------------------------------------------------------

// Reason to deny an Edit/Write, or null. Only sessions working inside a claimed
// worktree are bound; a person in the main checkout is never blocked.
export function ownershipDenial(vault, cwd, file) {
  const claims = loadClaims(vault);
  const entries = Object.entries(claims);
  if (!entries.length || !file) return null;
  const here = canonical(cwd);
  const target = canonical(path.resolve(cwd, file));
  for (const [id, c] of entries) {
    if (!c.worktree || !isWithin(c.worktree, here)) continue;
    if (isWithin(c.worktree, target)) {
      const rel = toPosix(path.relative(c.worktree, target));
      return owned(c.owns, rel) ? null : `Blocked: ${rel} is outside the paths phase ${id} owns (${c.owns.join(", ")}). Edit only what the phase owns. If this file belongs in the phase, a person must change \`owns\` in the phase doc first.`;
    }
    // Reaching into the main checkout from the worktree would skip the ownership check.
    const main = mainRepoFor(loadConfig(vault), c.project);
    if (main && isWithin(canonical(main), target)) return `Blocked: ${file} is in the main checkout, outside your worktree ${c.worktree}. Edit the same file inside the worktree.`;
  }
  return null;
}
