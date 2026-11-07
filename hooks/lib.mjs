import fs from "node:fs";
import { resolveProject, resolveVault } from "../brain/src/context.mjs";

export function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

// Resolve { vault, project } or null. Null means: this repo is not under the
// brain, so every hook stays silent and touches nothing.
export function target(input) {
  try {
    const vault = resolveVault();
    if (!vault || !fs.existsSync(vault)) return null;
    const project = resolveProject(vault, input.cwd ?? process.cwd());
    return project ? { vault, project } : null;
  } catch {
    return null;
  }
}

// Hooks must never break a session: any crash exits quietly with code 0.
export function guard(fn) {
  try {
    fn();
  } catch (e) {
    process.stderr.write(`brain hook: ${e?.message ?? e}\n`);
    process.exit(0);
  }
}
