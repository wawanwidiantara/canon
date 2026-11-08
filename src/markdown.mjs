const COMMENT_RE = /<!--[\s\S]*?-->/g;
const FENCE_RE = /```[\s\S]*?```/g;

export const stripComments = (s) => s.replace(COMMENT_RE, "");
export const stripFences = (s) => s.replace(FENCE_RE, "");

// Returns the text under `## name` up to the next `## ` heading, or null.
export function getSection(body, name) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

export const isBlank = (s) => stripComments(s).trim() === "";

// A done behavior carries a test link or a hand confirmation (`(manual: 2026-11-08)`), not both.
const BEHAVIOR_RE = /^- \[([ x~])\] (B\d+): (.+?)(?: \((?:test: ([^)]+)|manual: ([^)]+))\))?\s*$/;
const STATE = { " ": "todo", "~": "doing", x: "done" };
const MARK = { todo: " ", doing: "~", done: "x" };

export function parseBehaviors(body) {
  const section = getSection(body, "Behaviors");
  if (section === null) return { items: [], bad: [] };
  const items = [];
  const bad = [];
  for (const line of stripComments(section).split("\n")) {
    if (!line.trim()) continue;
    const m = BEHAVIOR_RE.exec(line);
    if (m) items.push({ id: m[2], state: STATE[m[1]], text: m[3], test: m[4] ?? null, manual: m[5] ?? null });
    else bad.push(line);
  }
  return { items, bad };
}

// Rewrites one behavior line. Throws if the behavior is missing.
// `test` or `manual` set on a line replaces the other; leaving the state of a done line drops a manual mark.
export function updateBehavior(body, bid, { state, test, manual }) {
  const lines = body.split("\n");
  const section = getSection(body, "Behaviors");
  if (section === null) throw new Error("no ## Behaviors section");
  let hit = false;
  const out = lines.map((line) => {
    const m = BEHAVIOR_RE.exec(line);
    if (!m || m[2] !== bid) return line;
    hit = true;
    const mark = state ? MARK[state] : m[1];
    let t = test ?? (manual ? null : m[4]);
    let h = manual ?? (test ? null : m[5]);
    if (state && state !== "done") h = null;
    return `- [${mark}] ${bid}: ${m[3]}${t ? ` (test: ${t})` : h ? ` (manual: ${h})` : ""}`;
  });
  if (!hit) throw new Error(`behavior ${bid} not found`);
  return out.join("\n");
}
