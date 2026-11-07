// Privacy gate for tools that send code to a third party (Quicksilver/Jev).
// Deterministic: a PreToolUse hook denies the call, rather than asking the model nicely.
// Matches `qs filter ...` and the form the skill actually runs: `node ".../scripts/qs.mjs" filter ...`.
// Only the subcommands that send file content are blocked; setup, status and help are not.
const QS_RE = /(^|[\s;&|("'/])qs(\.mjs)?["']?\s+(filter|classify|rank|find|ask)\b/;

// `canon qs ...` is the sanctioned wrapper, which checks the project, host and inputs itself.
// Take it out before testing, so `canon qs filter x && qs filter y` still finds the second call.
const WRAPPER_RE = /(^|[\s;&|(])canon\s+qs\b/g;

export const isQuicksilverCall = (command) => QS_RE.test(String(command ?? "").replace(WRAPPER_RE, "$1"));

// Returns a denial reason, or null if the call may proceed. In a mapped project every direct
// call is refused, allowed or not, so the checks in `canon qs` cannot be skipped.
export function quicksilverDenial(config, project, command) {
  if (!project || !isQuicksilverCall(command)) return null;
  if (config.projects?.[project]?.quicksilver === true) {
    return `Blocked: run Quicksilver as \`canon qs <command> ...\` in project "${project}". It checks the project setting, the API host and the input paths before anything is sent.`;
  }
  return `Blocked: Quicksilver sends file content to a third-party API and project "${project}" has not allowed it. Use grep, \`canon query\` or the static checks instead. To allow it, set projects.${project}.quicksilver = true in the vault's canon.config.json, then use \`canon qs\`.`;
}

// Ratification: a doc becomes canon, or stops being canon, only when a person
// says so. `approve` and `supersede` therefore ask for confirmation every time,
// even if `canon` is allowed in the permission rules. Set "ratify": "auto" in
// canon.config.json to turn this off.
const RATIFY_RE = /(^|[\s;&|(/])canon\s+(approve|supersede)\b/;

export const isRatification = (command) => RATIFY_RE.test(String(command ?? ""));

// "ratify" in canon.config.json:
//   "ask" (default)  every approve and supersede asks
//   "auto"           none ask
//   { "types": { "lesson": "auto", "discovery": "auto" }, "supersede": "ask", "default": "ask" }
//                    approve asks unless its doc type is listed as "auto";
//                    supersede follows "supersede", else "default"
// Anything unrecognized asks, so a typo can never turn the gate off.
export function ratifyMode(config, verb, docType) {
  const r = config.ratify;
  if (r === "auto") return "auto";
  if (r && typeof r === "object") {
    const v = verb === "approve" ? (r.types?.[docType] ?? r.default) : (r.supersede ?? r.default);
    return v === "auto" ? "auto" : "ask";
  }
  return "ask";
}

// Every ratification in the command is checked, so `canon approve lesson && canon approve spec`
// still asks. `typeOf(id)` gives a doc's type; an id it cannot resolve (or a shell variable) asks.
export function ratificationPrompt(config, project, command, typeOf = () => null) {
  if (!project || !isRatification(command)) return null;
  const each = /(?:^|[\s;&|(/])canon\s+(approve|supersede)(?:\s+([\w.-]+))?/g;
  const text = String(command);
  let m;
  while ((m = each.exec(text))) {
    const [, verb, id] = m;
    const type = id ? typeOf(id) : null;
    if (ratifyMode(config, verb, type) === "auto") continue;
    return verb === "approve"
      ? "Approving makes this doc canon: later work will treat it as decided. Confirm only if you have read it."
      : "Superseding retires a canon doc in favour of another. Confirm only if you agree with the replacement.";
  }
  return null;
}

// Opt-in subagents. They cost extra tokens, so the plugin's agents are blocked
// unless canon.config.json enables them, for example "agents": { "reviewer": true }.
// This list is the only place the names are written: a new vault's config is built
// from it, and a test checks it against the files in agents/.
export const AGENTS = ["reviewer", "researcher", "spec-reviewer"];

export function agentDenial(config, subagentType) {
  const m = /^canon:([\w-]+)$/.exec(String(subagentType ?? ""));
  if (!m || !AGENTS.includes(m[1])) return null;
  if (config?.agents?.[m[1]] === true) return null;
  return `Blocked: the ${m[1]} subagent is opt-in because it spends extra tokens, and it is not enabled. Do the work in this session instead. To allow it, set agents.${m[1]} = true in the vault's canon.config.json.`;
}
