#!/usr/bin/env node
import { shouldBlock, stopReasons } from "../brain/src/context.mjs";
import { readInput, target } from "./lib.mjs";

const input = readInput();
const t = target(input);
if (t) {
  const reasons = stopReasons(t.vault, t.project);
  if (shouldBlock(input.session_id, reasons)) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: reasons.join("\n\n").slice(0, 3000) }));
  }
}
