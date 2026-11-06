// Generated SQLite index over the vault: full-text search plus the doc graph.
// Markdown stays the source of truth; the index is rebuilt whenever any doc is
// newer than it, so it can never go stale.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getSection, parseBehaviors, stripComments } from "./markdown.mjs";
import { listDocs } from "./vault.mjs";

const WIKILINK_RE = /\[\[([^\]|#]+)/g;
const SUMMARY_SECTIONS = ["Goal", "Summary", "Question", "Context", "Objective", "Scope", "Mistake", "Rule"];

export const indexPath = (vault) => path.join(vault, ".brain", "index.sqlite");

const SCHEMA = `
  CREATE TABLE docs (id TEXT PRIMARY KEY, type TEXT, project TEXT, status TEXT, path TEXT, title TEXT, summary TEXT, superseded_by TEXT);
  CREATE TABLE links (from_id TEXT, to_id TEXT, kind TEXT);
  CREATE TABLE anchors (doc_id TEXT, path TEXT, hash TEXT);
  CREATE TABLE behaviors (doc_id TEXT, bid TEXT, state TEXT, text TEXT, test TEXT);
  CREATE VIRTUAL TABLE fts USING fts5(id UNINDEXED, title, body, tokenize = 'porter unicode61');
  CREATE INDEX links_to ON links(to_id);
  CREATE INDEX anchors_path ON anchors(path);
`;

const clip = (s, n) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function summaryOf(body) {
  for (const name of SUMMARY_SECTIONS) {
    const sec = getSection(body, name);
    if (sec) {
      const t = stripComments(sec).trim();
      if (t) return clip(t, 160);
    }
  }
  return "";
}

export function buildIndex(vault) {
  const file = indexPath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insDoc = db.prepare("INSERT INTO docs VALUES (?,?,?,?,?,?,?,?)");
  const insLink = db.prepare("INSERT INTO links VALUES (?,?,?)");
  const insAnchor = db.prepare("INSERT INTO anchors VALUES (?,?,?)");
  const insBeh = db.prepare("INSERT INTO behaviors VALUES (?,?,?,?,?)");
  const insFts = db.prepare("INSERT INTO fts VALUES (?,?,?)");
  let count = 0;
  db.exec("BEGIN");
  for (const d of listDocs(vault)) {
    const m = d.data;
    if (!m?.id || !m.type) continue;
    const title = /^# (.+)$/m.exec(d.body)?.[1]?.trim() ?? m.id;
    insDoc.run(m.id, m.type, m.project ?? "", m.status ?? "", d.rel, title, summaryOf(d.body), m.superseded_by ?? null);
    insFts.run(m.id, title, stripComments(d.body));
    const seen = new Set();
    for (const dep of m.depends_on ?? []) {
      const to = dep.replace(/^\[\[|\]\]$/g, "").split("#")[0];
      insLink.run(m.id, to, "depends");
      seen.add(to);
    }
    for (const x of stripComments(d.body).matchAll(WIKILINK_RE)) {
      const to = x[1].trim();
      if (!seen.has(to)) insLink.run(m.id, to, "mentions");
      seen.add(to);
    }
    for (const a of m.anchors ?? []) {
      const i = a.lastIndexOf("@");
      if (i > 0) insAnchor.run(m.id, a.slice(0, i), a.slice(i + 1));
    }
    if (m.type === "spec") for (const b of parseBehaviors(d.body).items) insBeh.run(m.id, b.id, b.state, b.text, b.test);
    count++;
  }
  db.exec("COMMIT");
  db.close();
  return count;
}

// Newest doc mtime vs index mtime: rebuild only when something changed.
export function ensureIndex(vault) {
  const file = indexPath(vault);
  const built = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (![".git", ".brain", ".obsidian", "node_modules"].includes(e.name)) walk(path.join(dir, e.name));
      } else if (e.name.endsWith(".md")) newest = Math.max(newest, fs.statSync(path.join(dir, e.name)).mtimeMs);
    }
  };
  walk(vault);
  if (newest > built) buildIndex(vault);
}

export function openIndex(vault) {
  ensureIndex(vault);
  return new DatabaseSync(indexPath(vault), { readOnly: true });
}

const fmt = (r) => `${r.id} [${r.type}/${r.status}] ${r.title}${r.summary ? ` - ${r.summary}` : ""}`;

// Free text -> safe FTS5 query: AND of prefix tokens, falling back to OR.
function ftsQueries(text) {
  const toks = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!toks.length) return [];
  const q = toks.map((t) => `"${t}"*`);
  return [q.join(" AND "), q.join(" OR ")];
}

export function search(vault, text, { project, type, status, limit = 8 } = {}) {
  const db = openIndex(vault);
  try {
    for (const q of ftsQueries(text)) {
      const where = ["fts MATCH ?"];
      const args = [q];
      if (project) (where.push("d.project = ?"), args.push(project));
      if (type) (where.push("d.type = ?"), args.push(type));
      if (status) (where.push("d.status = ?"), args.push(status));
      else where.push("d.status NOT IN ('superseded')");
      const rows = db
        .prepare(`SELECT d.*, snippet(fts, 2, '[', ']', '…', 12) AS snip FROM fts JOIN docs d ON d.id = fts.id WHERE ${where.join(" AND ")} ORDER BY bm25(fts, 0, 4, 1) LIMIT ?`)
        .all(...args, limit);
      if (rows.length) return rows.map((r) => `${fmt(r)}\n    ${r.snip.replace(/\s+/g, " ")}`);
    }
    return [];
  } finally {
    db.close();
  }
}

// Specs that anchor this path (suffix match, so `src/a.php` finds `app/src/a.php`).
export function governs(vault, p) {
  const db = openIndex(vault);
  try {
    return db
      .prepare("SELECT d.* FROM anchors a JOIN docs d ON d.id = a.doc_id WHERE a.path = ? OR a.path LIKE ? OR ? LIKE '%' || a.path ORDER BY d.id")
      .all(p, `%/${p}`, p)
      .map(fmt);
  } finally {
    db.close();
  }
}

export function dependencies(vault, id) {
  const db = openIndex(vault);
  try {
    return db
      .prepare("SELECT l.kind, d.* FROM links l JOIN docs d ON d.id = l.to_id WHERE l.from_id = ? ORDER BY l.kind, d.id")
      .all(id)
      .map((r) => `${r.kind}: ${fmt(r)}`);
  } finally {
    db.close();
  }
}

export function dependents(vault, id) {
  const db = openIndex(vault);
  try {
    return db
      .prepare("SELECT l.kind, d.* FROM links l JOIN docs d ON d.id = l.from_id WHERE l.to_id = ? ORDER BY l.kind, d.id")
      .all(id)
      .map((r) => `${r.kind}: ${fmt(r)}`);
  } finally {
    db.close();
  }
}

export function openBehaviors(vault, project) {
  const db = openIndex(vault);
  try {
    return db
      .prepare("SELECT b.*, d.status FROM behaviors b JOIN docs d ON d.id = b.doc_id WHERE b.state != 'done' AND d.status IN ('draft','active','needs-review') AND (? IS NULL OR d.project = ?) ORDER BY b.doc_id, b.bid")
      .all(project ?? null, project ?? null)
      .map((r) => `${r.doc_id} ${r.bid} [${r.state}] ${r.text}`);
  } finally {
    db.close();
  }
}

// Active docs of a project, one line each: the cheap "what exists" listing.
export function listActive(vault, project, type) {
  const db = openIndex(vault);
  try {
    return db
      .prepare("SELECT * FROM docs WHERE project = ? AND status IN ('active','needs-review') AND (? IS NULL OR type = ?) ORDER BY type, id")
      .all(project, type ?? null, type ?? null)
      .map(fmt);
  } finally {
    db.close();
  }
}

// Print a whole doc or just one section (saves tokens vs reading the file).
export function show(vault, id, section) {
  const doc = listDocs(vault).find((d) => d.data?.id === id);
  if (!doc) throw new Error(`no doc with id '${id}'`);
  if (!section) return doc.text;
  const sec = getSection(doc.body, section);
  if (sec === null) throw new Error(`${id} has no section '## ${section}'`);
  return `## ${section}\n${sec.trim()}`;
}
