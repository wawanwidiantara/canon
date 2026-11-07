import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAtomic, withLock } from "./fsx.mjs";
import { configDir } from "./platform.mjs";
import { parse } from "./frontmatter.mjs";

const SKIP_DIRS = new Set([".git", ".obsidian", ".claude", ".canon", "node_modules"]);
const SKIP_FILES = new Set(["README.md", "AGENTS.md", "CLAUDE.md"]);

// The vault this device was pointed at by `canon setup`, or null.
export function deviceVault() {
  for (const dir of [configDir(process.env, process.platform, os.homedir()), path.join(os.homedir(), ".config", "canon")]) {
    const f = path.join(dir, "vault");
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  }
  return null;
}

// Which vault: $CANON_VAULT, else the nearest ancestor holding canon.config.json
// (so inside a vault you work on that vault), else the one `canon setup` recorded.
export function findVault(start = process.cwd()) {
  if (process.env.CANON_VAULT) return path.resolve(process.env.CANON_VAULT);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "canon.config.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const device = deviceVault();
  if (device && fs.existsSync(path.join(device, "canon.config.json"))) return device;
  throw new Error("no vault found; run `canon init` and `canon setup <dir>`, or set CANON_VAULT");
}

// Two files: canon.config.json is shared through git (settings, remote URLs);
// .canon/local.json holds this device's repo paths and is never committed.
const localFile = (vault) => path.join(vault, ".canon", "local.json");

export function loadLocal(vault) {
  try {
    return JSON.parse(fs.readFileSync(localFile(vault), "utf8"));
  } catch {
    return {};
  }
}

export function saveLocal(vault, local) {
  fs.mkdirSync(path.dirname(localFile(vault)), { recursive: true });
  writeAtomic(localFile(vault), JSON.stringify(local, null, 2) + "\n");
}

// Shared config with this device's repo paths merged in as `projects.<slug>.repo`.
export function loadConfig(vault) {
  const config = JSON.parse(fs.readFileSync(path.join(vault, "canon.config.json"), "utf8"));
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
  writeAtomic(path.join(vault, "canon.config.json"), JSON.stringify(shared, null, 2) + "\n");
}

// Run fn while holding a named lock on the vault. Every read-modify-write of a
// doc or of the config goes through this, so two sessions or hooks cannot each
// read the old text and then overwrite the other's change.
export function lockVault(vault, name, fn) {
  return withLock(path.join(vault, ".canon", "locks", `rmw-${name}`.replace(/[^\w-]/g, "_")), fn);
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
