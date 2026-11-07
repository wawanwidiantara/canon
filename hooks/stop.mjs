#!/usr/bin/env node
import { sessionStartCode, sessionStartMs, shouldBlock, stopReasons } from "../src/context.mjs";
import { guard, readInput, target } from "./lib.mjs";

guard(() => {
  const input = readInput();
  const t = target(input);
  if (!t) return;
  const reasons = stopReasons(t.vault, t.project, { since: sessionStartMs(t.vault, t.project), baseCode: sessionStartCode(t.vault, t.project) });
  if (shouldBlock(input.session_id, reasons)) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: reasons.join("\n\n").slice(0, 3000) }));
  }
});
