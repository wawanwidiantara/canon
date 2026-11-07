import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toPosix } from "./platform.mjs";

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

export function repoFor(config, project) {
  return config.projects?.[project]?.repo ?? null;
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

export function anchorFor(repo, relPath) {
  const rel = toPosix(relPath).replace(/^\.\//, "");
  const abs = path.join(repo, rel);
  if (!fs.existsSync(abs)) throw new Error(`anchor file not found: ${abs}`);
  return `${rel}@${hashFile(abs)}`;
}
