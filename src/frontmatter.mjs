// Flat YAML-subset frontmatter: `key: value` and `key: [a, b]`. No nesting.
const RE = /^---\n([\s\S]*?)\n---\n?/;

export function parse(text) {
  text = text.replace(/\r\n?/g, "\n");
  const m = RE.exec(text);
  if (!m) return null;
  const data = {};
  for (const raw of m[1].split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    const c = value.indexOf(" #");
    if (c !== -1) value = value.slice(0, c).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")) : [];
    } else {
      data[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { data, body: text.slice(m[0].length) };
}

const PLAIN = /^[\w./@:-]+$/;

function fmt(value) {
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  const s = String(value);
  return PLAIN.test(s) ? s : JSON.stringify(s);
}

const ORDER = ["id", "type", "project", "stack", "status", "depends_on"];

export function stringify(data, body) {
  const keys = [...ORDER.filter((k) => k in data), ...Object.keys(data).filter((k) => !ORDER.includes(k))];
  const lines = keys.map((k) => `${k}: ${fmt(data[k])}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}
