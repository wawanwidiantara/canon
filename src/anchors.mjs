import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonical, toPosix } from "./platform.mjs";
import { gitCommonDir, gitTop } from "./remote.mjs";

// Text files hash with CRLF folded to LF, so a Windows checkout (autocrlf) and a
// Linux one give the same hash. Binary files hash their raw bytes.
export function hashFile(file) {
  const buf = fs.readFileSync(file);
  const isText = !buf.subarray(0, 8000).includes(0);
  const data = isText ? Buffer.from(buf.toString("latin1").replace(/\r\n/g, "\n"), "latin1") : buf;
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 12);
}

// "src/a.php@abc123def456" -> { path, hash }
export function parseAnchor(s) {
  const i = s.lastIndexOf("@");
  if (i <= 0) return null;
  const hash = s.slice(i + 1);
  return /^[0-9a-f]{12}$/.test(hash) ? { path: s.slice(0, i), hash } : null;
}

// The working tree to check for a project. Normally the mapped repo. When cwd is
// inside another worktree of that same repo (`git worktree add`), that worktree,
// so anchors, stale checks and the Stop gate see the edits being made there.
export function repoFor(config, project, cwd = process.cwd()) {
  const mapped = config.projects?.[project]?.repo ?? null;
  return mapped ? (worktreeOf(mapped, cwd) ?? mapped) : null;
}

// Top of the linked worktree of `mapped` that contains `cwd`, else null.
export function worktreeOf(mapped, cwd) {
  try {
    const top = gitTop(cwd);
    if (!top || canonical(top) === canonical(mapped)) return null;
    const common = gitCommonDir(top);
    return common && common === gitCommonDir(mapped) ? canonical(top) : null;
  } catch {
    return null;
  }
}

// Compare each anchor's recorded hash with the file on disk.
export function checkAnchors(repo, anchors) {
  const problems = [];
  for (const a of anchors) {
    const p = parseAnchor(a);
    if (!p) {
      problems.push({ anchor: a, kind: "malformed" });
      continue;
    }
    const abs = path.join(repo, p.path);
    if (!fs.existsSync(abs)) problems.push({ anchor: a, kind: "missing" });
    else if (hashFile(abs) !== p.hash) problems.push({ anchor: a, kind: "changed" });
  }
  return problems;
}

// "changed src/a.php@abc, missing src/b.php@def": one way to print stale problems.
export const describeProblems = (problems) => problems.map((p) => `${p.kind} ${p.anchor}`).join(", ");

export function anchorFor(repo, relPath) {
  const rel = toPosix(relPath).replace(/^\.\//, "");
  const abs = path.join(repo, rel);
  if (!fs.existsSync(abs)) throw new Error(`anchor file not found: ${abs}`);
  return `${rel}@${hashFile(abs)}`;
}
