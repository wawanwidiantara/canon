#!/usr/bin/env node
import { resolveVault, sessionBrief } from "../brain/src/context.mjs";
import { pullIfDue, syncSettings } from "../brain/src/sync.mjs";
import { readInput, target } from "./lib.mjs";

const input = readInput();
let pull = null;
let t = target(input);
const vault = t?.vault ?? resolveVault();
if (vault && syncSettings(vault).pullOnStart) {
  // Unknown repo: the vault on this device may simply be behind (a new device, or a
  // project added elsewhere), so pull first and try again. Known repo: pull, then brief.
  pull = pullIfDue(vault);
  if (!t && pull?.ok) t = target(input);
}
if (t) {
  const additionalContext = sessionBrief(t.vault, t.project, { pull });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
}
