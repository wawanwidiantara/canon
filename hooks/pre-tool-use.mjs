#!/usr/bin/env node
import { quicksilverDenial, ratificationPrompt } from "../src/gate.mjs";
import { loadConfig } from "../src/vault.mjs";
import { guard, readInput, target } from "./lib.mjs";

guard(() => {
  const input = readInput();
  const t = target(input);
  if (!t || input.tool_name !== "Bash") return;
  const config = loadConfig(t.vault);
  const command = input.tool_input?.command;
  const reason = quicksilverDenial(config, t.project, command);
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
    return;
  }
  const ask = ratificationPrompt(config, t.project, command);
  if (ask) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: ask } }));
  }
});
