#!/usr/bin/env node
import { agentDenial, quicksilverDenial, ratificationPrompt } from "../src/gate.mjs";
import { governingLine, resolveVault } from "../src/context.mjs";
import { findDoc, loadConfig } from "../src/vault.mjs";
import fs from "node:fs";
import path from "node:path";
import { ownershipDenial } from "../src/packets.mjs";
import { guard, readInput, target } from "./lib.mjs";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

guard(() => {
  const input = readInput();
  if (input.tool_name === "Agent" || input.tool_name === "Task") {
    // Not tied to a mapped project: the plugin's agents are blocked everywhere unless enabled.
    const vault = resolveVault();
    const config = vault && fs.existsSync(vault) ? loadConfig(vault) : {};
    const reason = agentDenial(config, input.tool_input?.subagent_type);
    if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
    return;
  }
  if (FILE_TOOLS.has(input.tool_name)) {
    const vault = resolveVault();
    if (!vault || !fs.existsSync(vault)) return;
    const cwd = input.cwd ?? process.cwd();
    const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    // Ownership first, and only where this device has claims. A denial is the whole answer.
    if (fs.existsSync(path.join(vault, ".canon", "claims.json"))) {
      const reason = ownershipDenial(vault, cwd, file);
      if (reason) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
        return;
      }
    }
    const t = target(input);
    const line = t && governingLine(vault, t.project, cwd, file);
    if (line) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: line } }));
    return;
  }
  const t = target(input);
  if (!t || input.tool_name !== "Bash") return;
  const config = loadConfig(t.vault);
  const command = input.tool_input?.command;
  const reason = quicksilverDenial(config, t.project, command);
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
    return;
  }
  const ask = ratificationPrompt(config, t.project, command, (id) => findDoc(t.vault, id)?.data?.type ?? null);
  if (ask) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: ask } }));
  }
});
