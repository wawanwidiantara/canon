import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stringify } from "./frontmatter.mjs";
import { writeAtomic, withLock } from "./fsx.mjs";
import { canonical, isReservedName } from "./platform.mjs";
import { ANCHORED, SLUG_RE, TYPES } from "./schema.mjs";
import { getSection, isBlank, parseBehaviors, stripComments, updateBehavior } from "./markdown.mjs";
import { AGENTS } from "./gate.mjs";
import { validate } from "./validate.mjs";
import { anchorFor, checkAnchors, describeProblems, inWorktree, repoFor } from "./anchors.mjs";
import { findDoc, listDocs, loadConfig, lockVault, saveConfig } from "./vault.mjs";
import { gitCommonDir, normalizeRemote, originOf } from "./remote.mjs";

const titleCase = (slug) => slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function nextNumber(dir, prefix) {
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = new RegExp(`^${prefix}-(\\d+)-`).exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return String(max + 1).padStart(3, "0");
}

const VAULT_README = `# Canon vault

Specs, phases, ADRs, lessons and notes for my projects, managed by the \`canon\` CLI
(canon). This repo is the single source of truth for project documentation.

- Create and change docs with \`canon\` (\`canon new\`, \`canon task\`, \`canon approve\`, \`canon complete\`). Do not hand-write frontmatter.
- \`canon validate\` checks every doc; \`canon query <words>\` searches them.
- \`projects/<slug>/\` holds one project: 00_context, 01_architecture, 02_specs, 03_phases, 04_audits, 05_lessons.
- \`.canon/\` is generated or per-device (search index, local repo paths) and is not committed.

Keep this repository private.
`;

export function init(vault, { git = true } = {}) {
  fs.mkdirSync(vault, { recursive: true });
  const readme = path.join(vault, "README.md");
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, VAULT_README);
  if (git && !fs.existsSync(path.join(vault, ".git"))) {
    try {
      execFileSync("git", ["-C", vault, "init", "-q", "-b", "main"], { stdio: "ignore" });
    } catch {
      // git missing or too old for -b: leave the folder usable without it
    }
  }
  const cfg = path.join(vault, "canon.config.json");
  const ignore = path.join(vault, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, ".canon/\n");
  // Pin line endings so a Windows checkout does not rewrite every doc (and every hash).
  const attrs = path.join(vault, ".gitattributes");
  if (!fs.existsSync(attrs)) fs.writeFileSync(attrs, "* text=auto eol=lf\n");
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify({ schema_version: 1, projects: {}, sync: { pullOnStart: true, digests: false }, ratify: "ask", agents: Object.fromEntries(AGENTS.map((a) => [a, false])) }, null, 2) + "\n");
}

// Maps a project to a repo on this device. The repo's git remote is recorded in
// the shared config, so other devices recognize the same repo without mapping.
export function mapProject(vault, slug, repo, { remote } = {}) {
  if (!SLUG_RE.test(slug)) throw new Error(`bad project slug '${slug}'`);
  return lockVault(vault, "config", () => {
    const config = loadConfig(vault);
    config.projects ??= {};
    // Mapped from inside a linked worktree: map the main checkout, not the worktree.
    const common = gitCommonDir(canonical(repo));
    const abs = common && path.basename(common) === ".git" ? canonical(path.dirname(common)) : canonical(repo);
    const found = remote ?? originOf(abs);
    config.projects[slug] = { ...config.projects[slug], repo: abs };
    const norm = normalizeRemote(found);
    if (norm) config.projects[slug].remote = norm;
    saveConfig(vault, config);
    return norm;
  });
}

// Creates a doc from the schema. Returns { id, file }.
export function newDoc(vault, { type, project, slug, title, depends = [], stack = [] }) {
  const def = TYPES[type];
  if (!def) throw new Error(`unknown type '${type}'`);
  if (!SLUG_RE.test(slug)) throw new Error(`slug must be kebab-case, got '${slug}'`);
  if (!SLUG_RE.test(project)) throw new Error(`project must be kebab-case, got '${project}'`);
  if (project === "global" && isReservedName(slug)) throw new Error(`'${slug}' is a reserved file name on Windows`);
  if (type === "global-rule" && project !== "global") throw new Error("global-rule uses project 'global'");
  if (type !== "global-rule" && project === "global") throw new Error("only global-rule uses project 'global'");

  const dir =
    project === "global" ? path.join(vault, def.dir) : path.join(vault, "projects", project, def.dir);
  const base = project === "global" ? "" : `${project}-`;
  return withLock(path.join(vault, ".canon", "locks", `${base}${type}`.replace(/[^\w-]/g, "_")), () => create());

  function create() {
    const id = def.numbered
      ? `${base}${type}-${nextNumber(dir, `${base}${type}`)}-${slug}`
      : `${base}${slug}`;
    const file = path.join(dir, `${id}.md`);
    if (fs.existsSync(file)) throw new Error(`already exists: ${file}`);

    const data = {
      id,
      type,
      project,
      stack,
      status: "draft",
      depends_on: depends.map((d) => `[[${d}]]`),
    };
    if (type === "spec") data.anchors = [];
    if (type === "phase") data.owns = [];
    if (type === "lesson") data.enforced = "false";

    const body =
      `\n# ${title ?? titleCase(slug)}\n\n` +
      def.sections.map(([h, hint]) => `## ${h}\n\n<!-- ${hint} -->\n`).join("\n");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, stringify(data, body), { flag: "wx" });
    return { id, file, heading: title ?? titleCase(slug) };
  }
}

function mustDoc(vault, id) {
  const doc = findDoc(vault, id);
  if (!doc || !doc.data) throw new Error(`no doc with id '${id}'`);
  return doc;
}

function write(doc, data, body) {
  writeAtomic(doc.file, stringify(data, body));
}

export function setTask(vault, specId, bid, state, test) {
  return lockVault(vault, `doc-${specId}`, () => setTaskLocked(vault, specId, bid, state, test));
}

function setTaskLocked(vault, specId, bid, state, test) {
  const doc = mustDoc(vault, specId);
  if (doc.data.type !== "spec") throw new Error(`${specId} is not a spec`);
  const b = parseBehaviors(doc.body).items.find((x) => x.id === bid);
  if (!b) throw new Error(`behavior ${bid} not found in ${specId}`);
  const testRef = test ?? b.test;
  if (state === "done") {
    if (!testRef) throw new Error(`${bid} needs a test before it can be done (pass --test path::name)`);
    const repo = repoFor(loadConfig(vault), doc.data.project);
    if (repo) {
      const f = path.join(repo, testRef.split("::")[0]);
      if (!fs.existsSync(f)) throw new Error(`test file not found: ${f}`);
    }
  }
  write(doc, doc.data, updateBehavior(doc.body, bid, { state, test }));
}

export function addAnchors(vault, docId, relPaths) {
  return lockVault(vault, `doc-${docId}`, () => addAnchorsLocked(vault, docId, relPaths));
}

function addAnchorsLocked(vault, docId, relPaths) {
  const doc = mustDoc(vault, docId);
  if (!ANCHORED.includes(doc.data.type)) throw new Error(`${docId} is a ${doc.data.type}; only ${ANCHORED.join(", ")} docs take anchors`);
  const repo = repoFor(loadConfig(vault), doc.data.project);
  if (!repo) throw new Error(`project '${doc.data.project}' has no repo mapped; run \`canon map\``);
  const current = new Map((doc.data.anchors ?? []).map((a) => [a.slice(0, a.lastIndexOf("@")), a]));
  for (const p of relPaths) current.set(p, anchorFor(repo, p));
  const at = gitPoint(repo);
  write(doc, { ...doc.data, anchors: [...current.values()], ...(at ? { verified_at: at } : {}) }, doc.body);
}

// "branch@shortsha" of the repo right now, or null outside git.
export function gitPoint(repo) {
  try {
    const run = (a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const sha = run(["rev-parse", "--short", "HEAD"]);
    const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
    return `${branch}@${sha}`;
  } catch {
    return null;
  }
}

// Active specs, ADRs and data models whose anchored code changed or vanished. Pass a project to look at one.
export function findStale(vault, project = null) {
  const config = loadConfig(vault);
  const out = [];
  for (const d of listDocs(vault)) {
    if (!ANCHORED.includes(d.data?.type) || d.data.status !== "active") continue;
    if (project && d.data.project !== project) continue;
    const anchors = d.data.anchors ?? [];
    if (!anchors.length) continue;
    const repo = repoFor(config, d.data.project);
    if (!repo) {
      out.push({ id: d.data.id, problems: [{ anchor: "-", kind: "no-repo-mapped" }] });
      continue;
    }
    const problems = checkAnchors(repo, anchors);
    if (problems.length) out.push({ id: d.data.id, problems, verified_at: d.data.verified_at ?? null, now: gitPoint(repo) });
  }
  return out;
}

export function markStale(vault) {
  const stale = findStale(vault);
  // From a linked worktree the stale list describes a branch, not the project, and
  // the status lives in the shared vault. Marking from here would flip it for every session.
  const config = loadConfig(vault);
  for (const s of stale) {
    const project = findDoc(vault, s.id)?.data?.project;
    if (project && inWorktree(config, project)) {
      throw new Error("refusing to mark docs stale from inside a worktree: the result describes this branch, not the project. Run `canon stale --mark` in the main checkout (after the branch lands).");
    }
  }
  for (const s of stale) {
    lockVault(vault, `doc-${s.id}`, () => {
      const doc = mustDoc(vault, s.id);
      write(doc, { ...doc.data, status: "needs-review" }, doc.body);
    });
  }
  return stale;
}

// Human confirms the spec still matches the code: re-hash and reactivate.
export function verifySpec(vault, specId) {
  return lockVault(vault, `doc-${specId}`, () => verifySpecLocked(vault, specId));
}

function verifySpecLocked(vault, specId) {
  const doc = mustDoc(vault, specId);
  const repo = repoFor(loadConfig(vault), doc.data.project);
  if (!repo) throw new Error(`project '${doc.data.project}' has no repo mapped`);
  const anchors = (doc.data.anchors ?? []).map((a) => anchorFor(repo, a.slice(0, a.lastIndexOf("@"))));
  const status = doc.data.status === "needs-review" ? "active" : doc.data.status;
  const at = gitPoint(repo);
  write(doc, { ...doc.data, anchors, status, ...(at ? { verified_at: at } : {}) }, doc.body);
}


// ---- lifecycle -------------------------------------------------------------


const REF_RE = /^- \[\[([^\]#]+)#(B\d+)\]\]\s*$/;

const relOf = (vault, doc) => path.relative(vault, doc.file);
const findingsFor = (vault, doc) => validate(vault).filter((f) => f.startsWith(`${relOf(vault, doc)}:`));

// draft -> active. The doc must pass validation as an active doc, otherwise it
// is left as a draft.
export function approve(vault, id) {
  return lockVault(vault, `doc-${id}`, () => approveLocked(vault, id));
}

function approveLocked(vault, id) {
  const doc = mustDoc(vault, id);
  if (doc.data.status !== "draft") throw new Error(`${id} is ${doc.data.status}, only drafts can be approved`);
  write(doc, { ...doc.data, status: "active" }, doc.body);
  const problems = findingsFor(vault, doc);
  if (problems.length) {
    write(doc, doc.data, doc.body); // revert to draft
    throw new Error(`${id} is not ready:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  }
}

function specProblems(vault, specId) {
  const doc = mustDoc(vault, specId);
  const open = parseBehaviors(doc.body).items.filter((b) => b.state !== "done");
  const out = open.map((b) => `${specId} ${b.id} is ${b.state}: ${b.text}`);
  for (const s of findStale(vault)) if (s.id === specId) out.push(`${specId} is stale (${describeProblems(s.problems)}); update it, then \`canon verify ${specId}\``);
  if (doc.data.status === "needs-review") out.push(`${specId} needs review; update it, then \`canon verify ${specId}\``);
  return out;
}

// active -> completed, only when the work is really done.
//  phase: every behavior it lists is done and its specs are not stale
//  spec:  every behavior is done and the spec is not stale
//  other: just needs to validate
export function complete(vault, id) {
  return lockVault(vault, `doc-${id}`, () => completeLocked(vault, id));
}

function completeLocked(vault, id) {
  const doc = mustDoc(vault, id);
  if (!["active", "needs-review"].includes(doc.data.status)) throw new Error(`${id} is ${doc.data.status}; only active docs can be completed`);
  const problems = completionProblems(vault, id);
  if (problems.length) throw new Error(`cannot complete ${id}:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  write(doc, { ...doc.data, status: "completed" }, doc.body);
}

// Everything that stops a doc from being completed right now. Empty means it can be.
export function completionProblems(vault, id) {
  const doc = mustDoc(vault, id);
  const problems = [];
  if (doc.data.type === "phase") {
    const sec = getSection(doc.body, "Behaviors");
    const specs = new Set();
    const wanted = [];
    for (const line of stripComments(sec ?? "").split("\n")) {
      const m = REF_RE.exec(line.trim());
      if (m) (specs.add(m[1]), wanted.push([m[1], m[2]]));
    }
    if (!wanted.length) problems.push(`${id} lists no behaviors`);
    for (const [specId, bid] of wanted) {
      const spec = findDoc(vault, specId);
      const b = spec && parseBehaviors(spec.body).items.find((x) => x.id === bid);
      if (!b) problems.push(`${specId}#${bid} does not exist`);
      else if (b.state !== "done") problems.push(`${specId} ${bid} is ${b.state}: ${b.text}`);
    }
    const stale = findStale(vault);
    for (const s of specs) {
      const st = stale.find((x) => x.id === s);
      if (st) problems.push(`${s} is stale (${describeProblems(st.problems)}); update it, then \`canon verify ${s}\``);
      const sd = findDoc(vault, s);
      if (sd?.data?.status === "needs-review") problems.push(`${s} needs review; update it, then \`canon verify ${s}\``);
    }
  } else if (doc.data.type === "spec") {
    problems.push(...specProblems(vault, id));
  }
  problems.push(...findingsFor(vault, doc));
  return problems;
}

// Replace a doc with another instead of deleting or archiving it.
export function supersede(vault, oldId, newId) {
  if (oldId === newId) throw new Error("a doc cannot supersede itself");
  const [a, b] = [oldId, newId].sort();
  return lockVault(vault, `doc-${a}`, () => lockVault(vault, `doc-${b}`, () => supersedeLocked(vault, oldId, newId)));
}

function supersedeLocked(vault, oldId, newId) {
  if (oldId === newId) throw new Error("a doc cannot supersede itself");
  const oldDoc = mustDoc(vault, oldId);
  const newDoc_ = mustDoc(vault, newId);
  if (oldDoc.data.project !== newDoc_.data.project) throw new Error("both docs must belong to the same project");
  if (oldDoc.data.status === "superseded") throw new Error(`${oldId} is already superseded`);
  if (newDoc_.data.status === "superseded") throw new Error(`${newId} is itself superseded`);
  write(oldDoc, { ...oldDoc.data, status: "superseded", superseded_by: newId }, oldDoc.body);
}

// Mark a lesson as enforced once a check exists that prevents the mistake.
export function enforce(vault, lessonId) {
  return lockVault(vault, `doc-${lessonId}`, () => enforceLocked(vault, lessonId));
}

function enforceLocked(vault, lessonId) {
  const doc = mustDoc(vault, lessonId);
  if (doc.data.type !== "lesson") throw new Error(`${lessonId} is not a lesson`);
  if (isBlank(getSection(doc.body, "Prevention") ?? "")) throw new Error("fill the Prevention section with the check that now exists before enforcing");
  write(doc, { ...doc.data, enforced: "true" }, doc.body);
}
