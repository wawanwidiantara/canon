// What Canon needs to know about Playwright in a repo: whether it is used, and where its browsers live.
// Shared by the gate proposal (`canon gate init`) and the doctor, so both use one rule.
import fs from "node:fs";
import path from "node:path";

const CONFIGS = ["ts", "js", "mjs", "cjs", "mts", "cts"].map((e) => `playwright.config.${e}`);

const readPkg = (repo) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  } catch {
    return {};
  }
};

export const playwrightScripts = (repo) => readPkg(repo).scripts ?? {};

// A Playwright config file, or the test package in the repo's dependencies.
export function usesPlaywright(repo) {
  if (!repo || !fs.existsSync(repo)) return false;
  if (CONFIGS.some((c) => fs.existsSync(path.join(repo, c)))) return true;
  const pkg = readPkg(repo);
  return Boolean({ ...pkg.dependencies, ...pkg.devDependencies }["@playwright/test"]);
}

export const packageInstalled = (repo) =>
  fs.existsSync(path.join(repo, "node_modules", "@playwright", "test")) || fs.existsSync(path.join(repo, "node_modules", "playwright"));

// Where Playwright keeps downloaded browsers: the variable if set ("0" means inside the repo's
// node_modules), otherwise the default cache folder of the operating system.
export function browsersDir({ repo, platform, home, env }) {
  const set = env.PLAYWRIGHT_BROWSERS_PATH;
  if (set === "0") return path.join(repo, "node_modules", "playwright-core", ".local-browsers");
  if (set) return set;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "ms-playwright");
  if (platform === "darwin") return path.join(home, "Library", "Caches", "ms-playwright");
  return path.join(home, ".cache", "ms-playwright");
}

export function chromiumFolders(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => /^chromium(_headless_shell)?-/.test(n));
  } catch {
    return [];
  }
}

const BINARIES = new Set(["headless_shell", "chrome-headless-shell", "chrome"]);

// The browser executable inside a downloaded folder, searched a few levels down.
export function findBrowserBinary(dir, folders, depth = 4) {
  const walk = (d, left) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) if (e.isFile() && BINARIES.has(e.name)) return path.join(d, e.name);
    if (left <= 0) return null;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const hit = walk(path.join(d, e.name), left - 1);
      if (hit) return hit;
    }
    return null;
  };
  for (const f of [...folders].sort().reverse()) {
    const hit = walk(path.join(dir, f), depth);
    if (hit) return hit;
  }
  return null;
}

// Names of shared libraries that a `ldd` listing reports as missing.
export const missingLibraries = (listing) =>
  [...String(listing ?? "").matchAll(/^\s*(\S+)\s+=>\s+not found/gm)].map((m) => m[1]);
