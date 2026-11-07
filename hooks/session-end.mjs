#!/usr/bin/env node
import fs from "node:fs";
import { buildDigest, saveDigest } from "../src/digest.mjs";
import { guard, readInput, target } from "./lib.mjs";

guard(() => {
  const input = readInput();
  const t = target(input);
  if (!t || !input.transcript_path || !fs.existsSync(input.transcript_path)) return;
  const digest = buildDigest(fs.readFileSync(input.transcript_path, "utf8"));
  digest.session_id ??= input.session_id ?? null;
  if (digest.human_turns > 0) saveDigest(t.vault, t.project, digest);
});
