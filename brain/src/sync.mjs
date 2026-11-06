// Moving the vault between devices through its own git remote.
// Pull is read-only for your work and never merges; push only happens when asked.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configDir } from "./platform.mjs";
import { loadConfig } from "./vault.mjs";

const NET_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=5",
};

const run = (vault, args, { net = false, timeout = 20000 } = {}) => {
  const r = spawnSync("git", ["-C", vault, ...args], { encoding: "utf8", env: net ? NET_ENV : process.env, timeout });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim(), error: r.error };
};

export function vaultState(vault) {
  if (!fs.existsSync(path.join(vault, ".git"))) return { git: false };
  const remote = run(vault, ["remote"]).out.split("\n").filter(Boolean);
  const dirty = run(vault, ["status", "--porcelain"]).out.split("\n").filter(Boolean);
  const ahead = run(vault, ["rev-list", "--count", "@{u}..HEAD"]);
  return { git: true, hasRemote: remote.length > 0, dirty: dirty.length, ahead: ahead.ok ? Number(ahead.out) : null };
}

// Fast-forward pull. Skips (with a reason) rather than ever touching local edits.
export function pullVault(vault, { timeout = 8000 } = {}) {
  const s = vaultState(vault);
  if (!s.git) return { ok: false, skipped: "vault is not a git repo" };
  if (!s.hasRemote) return { ok: false, skipped: "vault has no remote" };
  if (s.dirty) return { ok: false, skipped: `vault has ${s.dirty} uncommitted change(s); run \`brain sync\`` };
  const r = run(vault, ["pull", "--ff-only", "--quiet"], { net: true, timeout });
  if (r.ok) return { ok: true };
  const why = r.error?.code === "ETIMEDOUT" ? "timed out" : (r.err.split("\n").pop() || "failed");
  return { ok: false, skipped: `pull ${why}` };
}

// Pull at most once per `minutes`, so reopening sessions is not slowed down.
export function pullIfDue(vault, { minutes = 10 } = {}) {
  const marker = path.join(os.tmpdir(), `brain-pull-${Buffer.from(vault).toString("hex").slice(-24)}`);
  try {
    if (Date.now() - fs.statSync(marker).mtimeMs < minutes * 60000) return null;
  } catch {
    // never pulled
  }
  fs.writeFileSync(marker, String(Date.now()));
  return pullVault(vault);
}

// Commit local changes, rebase onto the remote, push. Stops on any conflict.
export function syncVault(vault, { push = true, message } = {}) {
  const log = [];
  const s = vaultState(vault);
  if (!s.git) throw new Error("the vault is not a git repo; run `git init` in it first");
  if (s.dirty) {
    const host = os.hostname();
    run(vault, ["add", "-A"]);
    const c = run(vault, ["commit", "-q", "-m", message ?? `chore: sync vault from ${host}`]);
    if (!c.ok) throw new Error(`commit failed: ${c.err || c.out}`);
    log.push(`committed ${s.dirty} change(s)`);
  }
  if (!s.hasRemote) {
    log.push("no remote configured; nothing to pull or push");
    return log;
  }
  const pull = run(vault, ["pull", "--rebase", "--quiet"], { net: true, timeout: 60000 });
  if (!pull.ok) {
    run(vault, ["rebase", "--abort"]);
    throw new Error(`pull found a conflict or failed, rebase aborted (your changes are safe, committed locally):\n${pull.err}\nResolve in the vault with git, then rerun \`brain sync\`.`);
  }
  log.push("pulled");
  if (push) {
    const p = run(vault, ["push", "--quiet"], { net: true, timeout: 60000 });
    if (!p.ok) throw new Error(`push failed: ${p.err}`);
    log.push("pushed");
  }
  return log;
}

// Remember the vault location for this device.
export function setupDevice(vaultPath, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const vault = path.resolve(vaultPath);
  if (!fs.existsSync(path.join(vault, "brain.config.json"))) throw new Error(`${vault} is not a vault (no brain.config.json); run \`brain init\` there or clone your vault first`);
  const dir = configDir(env, platform, home);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "vault"), vault + "\n");
  return { vault, file: path.join(dir, "vault") };
}

export function syncSettings(vault) {
  try {
    return { pullOnStart: true, digests: false, ...(loadConfig(vault).sync ?? {}) };
  } catch {
    return { pullOnStart: false, digests: false };
  }
}
