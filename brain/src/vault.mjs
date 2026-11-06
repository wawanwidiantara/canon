import fs from "node:fs";
import path from "node:path";
import { parse } from "./frontmatter.mjs";

const SKIP_DIRS = new Set([".git", ".obsidian", ".claude", ".brain", "node_modules"]);
const SKIP_FILES = new Set(["README.md", "AGENTS.md", "CLAUDE.md"]);

// Vault root = nearest ancestor containing brain.config.json.
export function findVault(start = process.cwd()) {
  if (process.env.BRAIN_VAULT) return path.resolve(process.env.BRAIN_VAULT);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "brain.config.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error("no brain.config.json found; run `brain init` or set BRAIN_VAULT");
    dir = up;
  }
}

// Two files: brain.config.json is shared through git (settings, remote URLs);
// .brain/local.json holds this device's repo paths and is never committed.
const localFile = (vault) => path.join(vault, ".brain", "local.json");

export function loadLocal(vault) {
  try {
    return JSON.parse(fs.readFileSync(localFile(vault), "utf8"));
  } catch {
    return {};
  }
}

export function saveLocal(vault, local) {
  fs.mkdirSync(path.dirname(localFile(vault)), { recursive: true });
  fs.writeFileSync(localFile(vault), JSON.stringify(local, null, 2) + "\n");
}

// Shared config with this device's repo paths merged in as `projects.<slug>.repo`.
export function loadConfig(vault) {
  const config = JSON.parse(fs.readFileSync(path.join(vault, "brain.config.json"), "utf8"));
  const local = loadLocal(vault);
  for (const [slug, p] of Object.entries(config.projects ?? {})) {
    if (local.projects?.[slug]?.repo) p.repo = local.projects[slug].repo;
  }
  return config;
}

// Repo paths are split out to the local file, everything else is shared.
export function saveConfig(vault, config) {
  const shared = JSON.parse(JSON.stringify(config));
  const local = loadLocal(vault);
  local.projects ??= {};
  for (const [slug, p] of Object.entries(shared.projects ?? {})) {
    if (p.repo) {
      local.projects[slug] = { ...local.projects[slug], repo: p.repo };
      delete p.repo;
    }
  }
  saveLocal(vault, local);
  fs.writeFileSync(path.join(vault, "brain.config.json"), JSON.stringify(shared, null, 2) + "\n");
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (e.isFile() && e.name.endsWith(".md") && !SKIP_FILES.has(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

export function projectFromPath(vault, file) {
  const parts = path.relative(vault, file).split(path.sep);
  if (parts[0] === "projects" && parts.length > 2) return parts[1];
  if (parts[0] === "00_global_standards") return "global";
  return null;
}

// Every markdown node in the vault with its parsed frontmatter.
export function listDocs(vault) {
  return walk(vault, []).map((file) => {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
    const parsed = parse(text);
    return {
      file,
      rel: path.relative(vault, file),
      text,
      data: parsed?.data ?? null,
      body: parsed?.body ?? text,
    };
  });
}

export function findDoc(vault, id) {
  return listDocs(vault).find((d) => d.data?.id === id) ?? null;
}
