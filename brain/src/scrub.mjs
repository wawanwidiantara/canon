// Remove things that look like secrets before text is stored in the vault.
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g,
];

// name=value pairs keep the name so the log stays readable
const KEYED = /\b((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|auth)[A-Za-z0-9_]*)(\s*[:=]\s*)(?!<REDACTED>)\S+/gi;

export function scrubSecrets(text) {
  let s = String(text);
  for (const re of PATTERNS) s = s.replace(re, "<REDACTED>");
  return s.replace(KEYED, (_, key, sep) => `${key}${sep}<REDACTED>`);
}

export function scrubDeep(value) {
  if (typeof value === "string") return scrubSecrets(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  return value;
}
