#!/usr/bin/env node
import { sessionBrief } from "../brain/src/context.mjs";
import { readInput, target } from "./lib.mjs";

const t = target(readInput());
if (t) {
  const additionalContext = sessionBrief(t.vault, t.project);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
}
