#!/usr/bin/env node
import { quicksilverDenial } from "../brain/src/gate.mjs";
import { loadConfig } from "../brain/src/vault.mjs";
import { readInput, target } from "./lib.mjs";

const input = readInput();
const t = target(input);
if (t && input.tool_name === "Bash") {
  const reason = quicksilverDenial(loadConfig(t.vault), t.project, input.tool_input?.command);
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  }
}
