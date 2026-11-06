import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toPosix } from "./platform.mjs";

export function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
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
