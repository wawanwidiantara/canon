import fs from "node:fs";
import { loadConfig } from "../brain/src/vault.mjs";
import { projectForCwd, resolveVault } from "../brain/src/context.mjs";

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
    const project = projectForCwd(loadConfig(vault), input.cwd ?? process.cwd());
    return project ? { vault, project } : null;
  } catch {
    return null;
  }
}
