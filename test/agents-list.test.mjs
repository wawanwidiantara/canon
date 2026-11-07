import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS } from "../src/gate.mjs";
import { init } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a new vault lists every opt-in agent the plugin ships, each set to false", () => {
  const vault = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "canon-")), "vault");
  init(vault, { git: false });
  const cfg = JSON.parse(fs.readFileSync(path.join(vault, "canon.config.json"), "utf8"));
  assert.deepEqual(Object.keys(cfg.agents).sort(), [...AGENTS].sort());
  for (const name of AGENTS) assert.strictEqual(cfg.agents[name], false, name);
});

test("every agent file has an entry in the opt-in agent list, and every entry has a file", () => {
  const files = fs.readdirSync(path.join(ROOT, "agents")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
  assert.deepEqual([...files].sort(), [...AGENTS].sort());
});
