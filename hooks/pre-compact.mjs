#!/usr/bin/env node
import { compactNotes } from "../brain/src/context.mjs";
import { readInput, target } from "./lib.mjs";

const t = target(readInput());
if (t) process.stdout.write(compactNotes(t.vault, t.project));
