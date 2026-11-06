// Identify a repo across devices by its git remote, not by a local path.
import { execFileSync } from "node:child_process";

// "git@github.com-personal:Owner/Repo.git", "https://github.com/owner/repo", "ssh://git@host/owner/repo.git"
// all reduce to "github.com/owner/repo". SSH host aliases like "github.com-personal" fold to the real host.
export function normalizeRemote(url) {
  let s = String(url ?? "").trim();
  if (!s) return null;
  let host;
  let rest;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(s);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    [, host, rest] = scp;
  } else {
    try {
      const u = new URL(s);
      host = u.hostname;
      rest = u.pathname;
    } catch {
      return null;
    }
  }
  host = host.toLowerCase().replace(/-[^.]*$/, "");
  rest = rest.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
  return host && rest ? `${host}/${rest}` : null;
}

const git = (dir, args) => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

export const gitTop = (dir) => git(dir, ["rev-parse", "--show-toplevel"]);
export const originOf = (dir) => git(dir, ["remote", "get-url", "origin"]);
