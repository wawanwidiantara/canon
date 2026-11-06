import fs from "node:fs";
import path from "node:path";
import { stringify } from "./frontmatter.mjs";
import { SLUG_RE, TYPES } from "./schema.mjs";
import { parseBehaviors, updateBehavior } from "./markdown.mjs";
import { anchorFor, checkAnchors, repoFor } from "./anchors.mjs";
import { findDoc, listDocs, loadConfig, saveConfig } from "./vault.mjs";

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

export function init(vault) {
  fs.mkdirSync(vault, { recursive: true });
  const cfg = path.join(vault, "brain.config.json");
  const ignore = path.join(vault, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, ".brain/\n");
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify({ schema_version: 1, projects: {} }, null, 2) + "\n");
}

export function mapProject(vault, slug, repo) {
  if (!SLUG_RE.test(slug)) throw new Error(`bad project slug '${slug}'`);
  const config = loadConfig(vault);
  config.projects ??= {};
  config.projects[slug] = { repo: path.resolve(repo) };
  saveConfig(vault, config);
}

// Creates a doc from the schema. Returns { id, file }.
export function newDoc(vault, { type, project, slug, title, depends = [], stack = [] }) {
  const def = TYPES[type];
  if (!def) throw new Error(`unknown type '${type}'`);
  if (!SLUG_RE.test(slug)) throw new Error(`slug must be kebab-case, got '${slug}'`);
  if (!SLUG_RE.test(project)) throw new Error(`project must be kebab-case, got '${project}'`);
  if (type === "global-rule" && project !== "global") throw new Error("global-rule uses project 'global'");
  if (type !== "global-rule" && project === "global") throw new Error("only global-rule uses project 'global'");

  const dir =
    project === "global" ? path.join(vault, def.dir) : path.join(vault, "projects", project, def.dir);
  const base = project === "global" ? "" : `${project}-`;
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
  if (type === "lesson") data.enforced = "false";

  const body =
    `\n# ${title ?? titleCase(slug)}\n\n` +
    def.sections.map(([h, hint]) => `## ${h}\n\n<!-- ${hint} -->\n`).join("\n");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, stringify(data, body));
  return { id, file };
}

function mustDoc(vault, id) {
  const doc = findDoc(vault, id);
  if (!doc || !doc.data) throw new Error(`no doc with id '${id}'`);
  return doc;
}

function write(doc, data, body) {
  fs.writeFileSync(doc.file, stringify(data, body));
}

export function setTask(vault, specId, bid, state, test) {
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

export function addAnchors(vault, specId, relPaths) {
  const doc = mustDoc(vault, specId);
  if (doc.data.type !== "spec") throw new Error(`${specId} is not a spec`);
  const repo = repoFor(loadConfig(vault), doc.data.project);
  if (!repo) throw new Error(`project '${doc.data.project}' has no repo mapped; run \`brain map\``);
  const current = new Map((doc.data.anchors ?? []).map((a) => [a.slice(0, a.lastIndexOf("@")), a]));
  for (const p of relPaths) current.set(p, anchorFor(repo, p));
  write(doc, { ...doc.data, anchors: [...current.values()] }, doc.body);
}

// Active specs whose anchored code changed or vanished.
export function findStale(vault) {
  const config = loadConfig(vault);
  const out = [];
  for (const d of listDocs(vault)) {
    if (d.data?.type !== "spec" || d.data.status !== "active") continue;
    const anchors = d.data.anchors ?? [];
    if (!anchors.length) continue;
    const repo = repoFor(config, d.data.project);
    if (!repo) {
      out.push({ id: d.data.id, problems: [{ anchor: "-", kind: "no-repo-mapped" }] });
      continue;
    }
    const problems = checkAnchors(repo, anchors);
    if (problems.length) out.push({ id: d.data.id, problems });
  }
  return out;
}

export function markStale(vault) {
  const stale = findStale(vault);
  for (const s of stale) {
    const doc = mustDoc(vault, s.id);
    write(doc, { ...doc.data, status: "needs-review" }, doc.body);
  }
  return stale;
}

// Human confirms the spec still matches the code: re-hash and reactivate.
export function verifySpec(vault, specId) {
  const doc = mustDoc(vault, specId);
  const repo = repoFor(loadConfig(vault), doc.data.project);
  if (!repo) throw new Error(`project '${doc.data.project}' has no repo mapped`);
  const anchors = (doc.data.anchors ?? []).map((a) => anchorFor(repo, a.slice(0, a.lastIndexOf("@"))));
  const status = doc.data.status === "needs-review" ? "active" : doc.data.status;
  write(doc, { ...doc.data, anchors, status }, doc.body);
}

