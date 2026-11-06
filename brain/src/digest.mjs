// Turns a Claude Code session transcript (JSONL) into a small digest, with no
// LLM. The retro skill reads digests instead of raw transcripts, which are huge.
import fs from "node:fs";
import path from "node:path";

const CORRECTION_RE =
  /^(no\b|nope|wrong|stop\b|don'?t|dont|not\b|that'?s not|actually|why (did|do|are|is)|undo|revert|i said|i told|you (forgot|missed|should|didn'?t|did not))|\b(wrong|incorrect|not what i|that is not|you forgot|again\?)\b/i;

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

const resultText = (c) =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n") : "";

const BIG_RESULT = 20000;

export function buildDigest(jsonl) {
  const d = {
    session_id: null,
    title: null,
    cwd: null,
    branch: null,
    started: null,
    ended: null,
    human_turns: 0,
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    tools: {},
    edited: [],
    corrections: [],
    errors: [],
    repeated_reads: [],
    big_results: [],
  };
  const usageById = new Map();
  const uses = new Map(); // tool_use id -> { name, input }
  const reads = new Map();
  const edited = new Set();

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    d.session_id ??= o.sessionId ?? null;
    d.cwd ??= o.cwd ?? null;
    d.branch ??= o.gitBranch ?? null;
    if (o.timestamp) {
      d.started ??= o.timestamp;
      d.ended = o.timestamp;
    }
    if (o.type === "ai-title" && o.aiTitle) d.title = o.aiTitle;

    if (o.type === "assistant" && o.message) {
      const m = o.message;
      if (m.id && m.usage) {
        const u = usageById.get(m.id) ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
        u.input = Math.max(u.input, m.usage.input_tokens ?? 0);
        u.output = Math.max(u.output, m.usage.output_tokens ?? 0);
        u.cache_read = Math.max(u.cache_read, m.usage.cache_read_input_tokens ?? 0);
        u.cache_write = Math.max(u.cache_write, m.usage.cache_creation_input_tokens ?? 0);
        usageById.set(m.id, u);
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type !== "tool_use") continue;
        uses.set(b.id, { name: b.name, input: b.input ?? {} });
        d.tools[b.name] = (d.tools[b.name] ?? 0) + 1;
        const fp = b.input?.file_path;
        if (b.name === "Read" && fp) reads.set(fp, (reads.get(fp) ?? 0) + 1);
        if ((b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit") && fp) edited.add(fp);
      }
    }

    if (o.type === "user" && o.message) {
      const c = o.message.content;
      if (typeof c === "string") {
        if (o.origin?.kind === "human" || o.origin === undefined) {
          const text = c.trim();
          if (text && !text.startsWith("<") && !text.startsWith("[")) {
            d.human_turns++;
            if (CORRECTION_RE.test(text)) d.corrections.push(clip(text, 200));
          }
        }
      } else if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== "tool_result") continue;
          const use = uses.get(b.tool_use_id);
          const text = resultText(b.content);
          if (text.length > BIG_RESULT) d.big_results.push({ tool: use?.name ?? "?", chars: text.length });
          if (b.is_error) {
            const what = use?.name === "Bash" ? use.input.command : use?.input?.file_path ?? use?.input?.url ?? use?.input?.pattern ?? use?.input?.query ?? "";
            d.errors.push({ tool: use?.name ?? "?", what: clip(what, 100), message: clip(text.split("\n").find((l) => l.trim()) ?? "", 140) });
          }
        }
      }
    }
  }

  for (const u of usageById.values()) {
    d.tokens.input += u.input;
    d.tokens.output += u.output;
    d.tokens.cache_read += u.cache_read;
    d.tokens.cache_write += u.cache_write;
  }
  d.edited = [...edited];
  d.repeated_reads = [...reads].filter(([, n]) => n > 2).map(([file, n]) => ({ file, reads: n })).sort((a, b) => b.reads - a.reads);
  return d;
}

export function digestDir(vault, project) {
  return path.join(vault, ".brain", "digests", project);
}

export function saveDigest(vault, project, digest) {
  const dir = digestDir(vault, project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${digest.session_id ?? Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(digest, null, 1) + "\n");
  return file;
}

export function loadDigests(vault, project, since = null) {
  const dir = digestDir(vault, project);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter((d) => !since || (d.ended ?? "") > since)
    .sort((a, b) => (a.started ?? "").localeCompare(b.started ?? ""));
}

const markerFile = (vault, project) => path.join(digestDir(vault, project), ".last-retro");

export function lastRetro(vault, project) {
  const f = markerFile(vault, project);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : null;
}

export function markRetroDone(vault, project) {
  fs.mkdirSync(digestDir(vault, project), { recursive: true });
  fs.writeFileSync(markerFile(vault, project), new Date().toISOString() + "\n");
}

const tally = (items, keyFn) => {
  const m = new Map();
  for (const it of items) m.set(keyFn(it), (m.get(keyFn(it)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

// Compact text for the retro skill: what to look at, not what to conclude.
export function retroReport(digests, { max = 6000 } = {}) {
  if (!digests.length) return "No new session digests since the last retro.";
  const sum = (f) => digests.reduce((n, d) => n + f(d), 0);
  const L = [];
  L.push(`Sessions: ${digests.length}; human turns: ${sum((d) => d.human_turns)}`);
  L.push(
    `Tokens (all sessions): output ${sum((d) => d.tokens.output)}, fresh input ${sum((d) => d.tokens.input) + sum((d) => d.tokens.cache_write)}, cache read ${sum((d) => d.tokens.cache_read)}`,
  );
  for (const d of digests) {
    L.push(`- ${(d.started ?? "").slice(0, 10)} ${String(d.session_id).slice(0, 8)} "${clip(d.title ?? "", 60)}": ${d.human_turns} turns, out ${d.tokens.output}, ${d.errors.length} tool error(s), ${d.corrections.length} correction(s)`);
  }
  const corrections = digests.flatMap((d) => d.corrections);
  if (corrections.length) {
    L.push("", "User corrections (candidate mistakes the agent made):");
    for (const c of corrections.slice(0, 15)) L.push(`- ${c}`);
  }
  const errs = tally(digests.flatMap((d) => d.errors), (e) => `${e.tool}: ${e.what} -> ${e.message}`).slice(0, 12);
  if (errs.length) {
    L.push("", "Tool errors (count, tool, what, message):");
    for (const [k, n] of errs) L.push(`- ${n}x ${k}`);
  }
  const reads = tally(digests.flatMap((d) => d.repeated_reads.map((r) => ({ file: r.file }))), (r) => r.file).slice(0, 8);
  if (reads.length) {
    L.push("", "Files re-read 3+ times in a session (navigation problem?):");
    for (const [f, n] of reads) L.push(`- ${f} (in ${n} session(s))`);
  }
  const big = tally(digests.flatMap((d) => d.big_results), (r) => r.tool).slice(0, 5);
  if (big.length) {
    L.push("", `Tool results over ${BIG_RESULT} chars (tool economy):`);
    for (const [t, n] of big) L.push(`- ${t}: ${n}`);
  }
  const text = L.join("\n");
  return text.length > max ? text.slice(0, max) + "\n… (truncated)" : text;
}
