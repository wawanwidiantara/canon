// Cross-platform helpers: running tools, finding them on PATH, comparing paths.
// Windows cannot spawn .cmd/.bat shims (npx, pnpm, composer, flutter, vendor/bin/*.bat)
// directly, and a bare `./vendor/bin/pest` is a Unix script there, so commands are
// resolved through PATH/PATHEXT and shims are run through cmd.exe.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};

const winExts = (env) =>
  (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((e) => e.toLowerCase())
    .sort((a, b) => ([".exe", ".cmd", ".bat", ".com"].indexOf(a) + 9) % 9 - ([".exe", ".cmd", ".bat", ".com"].indexOf(b) + 9) % 9);

// Absolute file for `cmd` on Windows, or `cmd` unchanged when not found / not Windows.
export function resolveCommand(cmd, { cwd = process.cwd(), env = process.env, platform = process.platform, exists = isFile } = {}) {
  if (platform !== "win32") return cmd;
  const w = path.win32;
  const hasExt = winExts(env).includes(w.extname(cmd).toLowerCase());
  const dirs = /[\\/]/.test(cmd) ? [cwd] : (env.Path ?? env.PATH ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    const base = w.resolve(dir, cmd);
    if (hasExt && exists(base)) return base;
    for (const e of winExts(env)) if (exists(base + e)) return base + e;
  }
  return cmd;
}

export const winQuote = (a) => (/^[\w@+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

// What to actually spawn for `cmd args`. Pure, so it is unit-tested on every OS.
export function buildInvocation(cmd, args, { cwd, env = process.env, platform = process.platform, exists } = {}) {
  if (platform !== "win32") return { file: cmd, args, verbatim: false };
  const exe = resolveCommand(cmd, { cwd, env, platform, exists });
  if (/\.(cmd|bat)$/i.test(exe)) {
    const line = [exe, ...args].map(winQuote).join(" ");
    return { file: env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
  }
  return { file: exe, args, verbatim: false };
}

export function spawnPortable(cmd, args = [], opts = {}) {
  const inv = buildInvocation(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env });
  return spawnSync(inv.file, inv.args, inv.verbatim ? { ...opts, windowsVerbatimArguments: true } : opts);
}

// Where an executable lives on PATH (null if absent). Honors PATHEXT on Windows.
export function findOnPath(name, { env = process.env, platform = process.platform } = {}) {
  const sep = platform === "win32" ? ";" : path.delimiter;
  for (const dir of (env.Path ?? env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    if (platform === "win32") {
      const r = resolveCommand(name, { cwd: dir, env: { ...env, Path: dir, PATH: dir }, platform });
      if (r !== name) return r;
    } else {
      const f = path.join(dir, name);
      if (isFile(f)) return f;
    }
  }
  return null;
}

// The real path of `p`: symlinks resolved (macOS /var is /private/var) and
// Windows 8.3 short names expanded (RUNNER~1). Falls back to a plain absolute
// path when `p` does not exist.
export function canonical(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

const norm = (p, platform) => {
  const r = platform === "win32" ? path.win32.resolve(p) : path.posix.resolve(p);
  return platform === "win32" || platform === "darwin" ? r.toLowerCase() : r;
};

// Is `child` the same as, or inside, `parent`? Case-insensitive on Windows and macOS.
export function isWithin(parent, child, platform = process.platform) {
  const sep = platform === "win32" ? "\\" : "/";
  const p = norm(parent, platform).replace(/[\\/]+$/, "");
  const c = norm(child, platform);
  return c === p || c.startsWith(p + sep);
}

// Anchors are stored with forward slashes so a spec means the same on every OS.
export const toPosix = (p) => String(p).split("\\").join("/");

// Windows device names cannot be file names, even with an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
export const isReservedName = (slug) => RESERVED.test(slug);

export function configDir(env = process.env, platform = process.platform, home = "") {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "canon");
  if (platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "canon");
  return path.join(home, ".config", "canon");
}
