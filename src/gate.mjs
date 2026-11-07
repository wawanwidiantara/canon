// Privacy gate for tools that send code to a third party (Quicksilver/Jev).
// Deterministic: a PreToolUse hook denies the call, rather than asking the model nicely.
const QS_RE = /(^|[\s;&|(/])qs\s+(filter|classify|rank|find|ask)\b/;

export const isQuicksilverCall = (command) => QS_RE.test(String(command ?? ""));

// Returns a denial reason, or null if the call may proceed.
export function quicksilverDenial(config, project, command) {
  if (!project || !isQuicksilverCall(command)) return null;
  if (config.projects?.[project]?.quicksilver === true) return null;
  return `Blocked: \`qs\` sends file content to a third-party API (TypeSafe/Jev) and project "${project}" has not allowed it. Use grep, \`canon query\` or the static checks instead. To allow it, set projects.${project}.quicksilver = true in the vault's canon.config.json.`;
}

// Ratification: a doc becomes canon, or stops being canon, only when a person
// says so. `approve` and `supersede` therefore ask for confirmation every time,
// even if `canon` is allowed in the permission rules. Set "ratify": "auto" in
// canon.config.json to turn this off.
const RATIFY_RE = /(^|[\s;&|(/])canon\s+(approve|supersede)\b/;

export const isRatification = (command) => RATIFY_RE.test(String(command ?? ""));

export function ratificationPrompt(config, project, command) {
  if (!project || !isRatification(command)) return null;
  if (config.ratify === "auto") return null;
  const verb = RATIFY_RE.exec(command)[2];
  return verb === "approve"
    ? "Approving makes this doc canon: later work will treat it as decided. Confirm only if you have read it."
    : "Superseding retires a canon doc in favour of another. Confirm only if you agree with the replacement.";
}

// Opt-in subagents. They cost extra tokens, so the plugin's agents are blocked
// unless canon.config.json enables them: "agents": { "reviewer": true, "researcher": true }.
export const AGENTS = ["reviewer", "researcher"];

export function agentDenial(config, subagentType) {
  const m = /^canon:([\w-]+)$/.exec(String(subagentType ?? ""));
  if (!m || !AGENTS.includes(m[1])) return null;
  if (config?.agents?.[m[1]] === true) return null;
  return `Blocked: the ${m[1]} subagent is opt-in because it spends extra tokens, and it is not enabled. Do the work in this session instead. To allow it, set agents.${m[1]} = true in the vault's canon.config.json.`;
}
