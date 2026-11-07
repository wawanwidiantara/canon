import path from "node:path";
import { DELIVERED, NOT_YET_CANON, NO_CODE_SECTIONS, STATUS, TYPES, TYPE_NAMES } from "./schema.mjs";
import { getSection, isBlank, parseBehaviors, stripComments, stripFences } from "./markdown.mjs";
import { listDocs, projectFromPath } from "./vault.mjs";
import { parseAnchor } from "./anchors.mjs";
import { checkOwns } from "./packets.mjs";
import { SCHEMA_VERSION } from "./schema.mjs";
import { loadConfig } from "./vault.mjs";

const REQUIRED = ["id", "type", "project", "stack", "status", "depends_on"];
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?[^\]]*\]\]/g;
const PHASE_REF_RE = /^- \[\[([^\]#]+)#(B\d+)\]\]\s*$/;

export function validate(vault) {
  const findings = [];
  try {
    const sv = loadConfig(vault).schema_version ?? 1;
    if (sv > SCHEMA_VERSION) findings.push(`canon.config.json: vault uses schema ${sv}, this tool supports ${SCHEMA_VERSION}; update canon`);
  } catch {
    // no config: a bare folder of docs is still validated
  }
  const docs = listDocs(vault);
  const byId = new Map();
  for (const d of docs) if (d.data?.id && !byId.has(d.data.id)) byId.set(d.data.id, d);

  for (const d of docs) {
    const at = (msg) => findings.push(`${d.rel}: ${msg}`);
    const { data, body } = d;
    if (!data) {
      at("missing or malformed frontmatter");
      continue;
    }
    for (const k of REQUIRED) if (!(k in data)) at(`frontmatter missing '${k}'`);
    if (data.type && !TYPE_NAMES.includes(data.type)) at(`type '${data.type}' not in ${TYPE_NAMES.join("|")}`);
    if (data.status && !STATUS.includes(data.status)) at(`status '${data.status}' not in ${STATUS.join("|")}`);
    if ("depends_on" in data && !Array.isArray(data.depends_on)) at("depends_on must be an array");
    if ("stack" in data && !Array.isArray(data.stack)) at("stack must be an array");

    const fileId = path.basename(d.file, ".md");
    if (data.id && data.id !== fileId) at(`id '${data.id}' does not match filename '${fileId}'`);
    const proj = projectFromPath(vault, d.file);
    if (proj && data.project && data.project !== proj) at(`project '${data.project}' does not match folder '${proj}'`);
    if (proj && proj !== "global" && data.id && !data.id.startsWith(`${proj}-`)) {
      at(`id '${data.id}' must start with '${proj}-'`);
    }

    // wikilinks must resolve (code fences ignored)
    const text = stripComments(stripFences(d.text));
    for (const m of text.matchAll(WIKILINK_RE)) {
      const target = byId.get(m[1].trim());
      if (!target) at(`wikilink [[${m[1].trim()}]] does not resolve`);
      else if (m[2] && target.data?.type === "spec") {
        const has = parseBehaviors(target.body).items.some((b) => b.id === m[2]);
        if (!has) at(`[[${m[1].trim()}#${m[2]}]]: spec has no behavior ${m[2]}`);
      }
    }

    const def = TYPES[data.type];
    if (!def) continue;
    const filled = data.status && !NOT_YET_CANON.includes(data.status);
    for (const [name] of def.sections) {
      const sec = getSection(body, name);
      if (sec === null) at(`missing section '## ${name}'`);
      else if (filled && isBlank(sec)) at(`section '## ${name}' is empty`);
    }
    if (data.status === "superseded" && !data.superseded_by) at("superseded doc needs 'superseded_by'");
    if (data.superseded_by && !byId.has(data.superseded_by)) at(`superseded_by '${data.superseded_by}' does not resolve`);

    if (data.type === "spec") checkSpec(data, body, at);
    checkAnchorList(data, at);
    if (data.type === "phase") {
      checkPhase(body, byId, at);
      if ("owns" in data) {
        if (!Array.isArray(data.owns)) at("owns must be a list of repo paths");
        else if (data.owns.length) {
          try {
            checkOwns(data.owns);
          } catch (e) {
            at(e.message);
          }
        }
      }
    }
    if (data.type === "lesson" && "enforced" in data && !["true", "false"].includes(data.enforced)) {
      at("enforced must be true or false");
    }
  }
  return findings;
}

const URL_RE = /https?:\/\/\S+/g;
const PATH_RE = /(?:^|[\s`(])(?:\.{0,2}\/)?[\w.-]+\/[\w./-]*\.[A-Za-z0-9]{1,5}(?=$|[\s`).,:;])/m;
const FENCE_BLOCK_RE = /```(\S*)[\s\S]*?```/g;

function checkSpecProse(body, at) {
  for (const name of NO_CODE_SECTIONS) {
    const sec = getSection(body, name);
    if (sec === null) continue;
    for (const m of sec.matchAll(FENCE_BLOCK_RE)) {
      if (m[1] !== "prototype") at(`'## ${name}' has a code fence; spec prose must not (use \`\`\`prototype for a decision-encoding snippet)`);
    }
    const prose = stripComments(stripFences(sec)).replace(URL_RE, "");
    const hit = PATH_RE.exec(prose);
    if (hit) at(`'## ${name}' contains a file path ("${hit[0].trim()}"); put it in frontmatter anchors`);
  }
}

function checkSpec(data, body, at) {
  checkSpecProse(body, at);
  const { items, bad } = parseBehaviors(body);
  for (const line of bad) at(`bad behavior line: "${line.trim()}"`);
  const seen = new Set();
  for (const b of items) {
    if (seen.has(b.id)) at(`duplicate behavior ${b.id}`);
    seen.add(b.id);
    if (b.state === "done" && !b.test) at(`behavior ${b.id} is done but has no (test: ...)`);
  }
  if (DELIVERED.includes(data.status) && items.length === 0) at("active spec needs at least one behavior");
}

function checkAnchorList(data, at) {
  if (!("anchors" in data)) return;
  if (!Array.isArray(data.anchors)) return at("anchors must be an array");
  for (const a of data.anchors) if (!parseAnchor(a)) at(`malformed anchor '${a}' (want path@12hex)`);
}

function checkPhase(body, byId, at) {
  const sec = getSection(body, "Behaviors");
  if (sec === null) return;
  for (const line of stripComments(sec).split("\n")) {
    if (!line.trim()) continue;
    const m = PHASE_REF_RE.exec(line);
    if (!m) {
      at(`phase behavior line must be '- [[spec-id#B1]]': "${line.trim()}"`);
      continue;
    }
    const spec = byId.get(m[1]);
    if (spec && spec.data?.type !== "spec") at(`[[${m[1]}]] is not a spec`);
  }
}
