// `canon qs`: the one way an agent may run Quicksilver in a mapped project.
//
// Quicksilver sends file content to a third-party API. Blocking its spellings by regex
// loses to the next spelling, so the hook denies every direct call in a mapped project and
// this wrapper does the checks in code before it runs the skill's script:
//   - the project allows it (projects.<slug>.quicksilver = true)
//   - QUICKSILVER_API_BASE is unset, or its host is in canon.config.json "quicksilverHosts"
//   - no argument names a secrets file or a path outside the repo
//   - --no-secrets-guard is refused
// Unmapped directories are not governed by a project, but the argument checks still apply.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWithin } from "./platform.mjs";

export const DEFAULT_HOST = "api.typesafe.ai";
const SUBCOMMANDS = ["filter", "classify", "rank", "find", "ask", "status", "setup", "help"];
// Mirrors the skill's own secrets filter, which only covers files it collects itself.
const SECRET_RE = /(^|[\/\\])(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks|crt|cer)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;

export function skillScript(env = process.env, home = os.homedir()) {
  return env.CANON_QS_SCRIPT || path.join(home, ".claude", "skills", "quicksilver", "scripts", "qs.mjs");
}

// Why this call must not run, or null. `root` is the repo (or cwd) that inputs must stay inside.
export function qsDenial({ config = {}, project = null, args, env = process.env, root }) {
  const sub = args[0];
  if (!SUBCOMMANDS.includes(sub)) return `unknown Quicksilver command "${sub ?? ""}". Use filter, classify, rank, find, ask, status or setup.`;
  if (project && config.projects?.[project]?.quicksilver !== true) {
    return `project "${project}" has not allowed Quicksilver, which sends file content to a third-party API. Set projects.${project}.quicksilver = true in the vault's canon.config.json to allow it.`;
  }
  const base = env.QUICKSILVER_API_BASE;
  if (base) {
    let host;
    try {
      host = new URL(base).host.toLowerCase();
    } catch {
      return `QUICKSILVER_API_BASE is not a valid URL: ${base}`;
    }
    const allowed = [DEFAULT_HOST, ...(config.quicksilverHosts ?? [])].map((h) => String(h).toLowerCase());
    if (!allowed.includes(host)) return `QUICKSILVER_API_BASE points at ${host}, which is not in "quicksilverHosts" of canon.config.json. Your files and key would be sent there.`;
  }
  if (sub === "status" || sub === "setup" || sub === "help") return null;
  for (let i = 1; i < args.length; i++) {
    const raw = args[i];
    if (raw === "--no-secrets-guard") return "--no-secrets-guard is refused: it turns off the filter that keeps .env files and keys out.";
    for (const piece of raw.startsWith("--") && raw.includes("=") ? [raw.slice(raw.indexOf("=") + 1)] : [raw]) {
      const arg = piece.replace(/^@/, "");
      if (!arg || arg === "-" || arg.startsWith("--")) continue;
      const stat = arg.replace(/[*?[{].*$/, "").replace(/[\/\\]$/, "") || ".";
      const abs = path.resolve(root, stat);
      if (!fs.existsSync(abs)) continue; // not a path (a question, a label list), or a glob with no static part
      if (SECRET_RE.test(abs) || SECRET_RE.test(arg)) return `"${arg}" is a secrets file; it must not be sent to a third party.`;
      if (!isWithin(root, abs)) return `"${arg}" is outside ${root}; Quicksilver may only read inside the project.`;
    }
  }
  return null;
}

// Run it. Returns the child's exit status; throws with the reason when a check fails.
export function runQs({ config, project, args, env = process.env, cwd = process.cwd(), root = cwd }) {
  const why = qsDenial({ config, project, args, env, root });
  if (why) throw new Error(why);
  const script = skillScript(env);
  if (!fs.existsSync(script)) throw new Error(`Quicksilver is not installed (${script} is missing). See the README.`);
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env, stdio: "inherit" });
  return r.status ?? 1;
}
