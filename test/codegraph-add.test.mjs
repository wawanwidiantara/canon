import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "../src/codegraph.mjs";

test("the MCP registration names the server before the variadic -e option, so claude does not read the name as an environment variable", () => {
  const acts = plan({ cli: "/bin/codegraph", index: true, wired: [], isGit: false, ignored: true, tracked: [], repo: "/r" });
  const reg = acts.find((a) => /register the MCP server/.test(a.what));
  assert.ok(reg, "a registration action is planned");
  const i = reg.cmd.indexOf("add");
  assert.equal(reg.cmd[i + 1], "codegraph", "the server name comes right after add");
  assert.ok(reg.cmd.indexOf("-e") > i + 1, "-e comes after the name");
  assert.equal(reg.cmd[reg.cmd.indexOf("-e") + 1], "CODEGRAPH_TELEMETRY=0");
  assert.deepEqual(reg.cmd.slice(reg.cmd.indexOf("--") + 1), ["codegraph", "serve", "--mcp"]);
});
