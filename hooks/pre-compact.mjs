#!/usr/bin/env node
import { compactNotes } from "../src/context.mjs";
import { guard, readInput, target } from "./lib.mjs";

guard(() => {
  const t = target(readInput());
  if (t) process.stdout.write(compactNotes(t.vault, t.project));
});
