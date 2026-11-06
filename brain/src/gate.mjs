// Privacy gate for tools that send code to a third party (Quicksilver/Jev).
// Deterministic: a PreToolUse hook denies the call, rather than asking the model nicely.
const QS_RE = /(^|[\s;&|(/])qs\s+(filter|classify|rank|find|ask)\b/;

export const isQuicksilverCall = (command) => QS_RE.test(String(command ?? ""));

// Returns a denial reason, or null if the call may proceed.
export function quicksilverDenial(config, project, command) {
  if (!project || !isQuicksilverCall(command)) return null;
  if (config.projects?.[project]?.quicksilver === true) return null;
  return `Blocked: \`qs\` sends file content to a third-party API (TypeSafe/Jev) and project "${project}" has not allowed it. Use grep, \`brain query\` or the static checks instead. To allow it, set projects.${project}.quicksilver = true in the vault's brain.config.json.`;
}
