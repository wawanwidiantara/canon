import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doctor, frontendCheck } from "../src/doctor.mjs";
import { suggestGate } from "../src/gates.mjs";
import { init, mapProject } from "../src/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "canon-fe-"));

function repoWith({ scripts = {}, config = null, dep = false, installed = false } = {}) {
  const repo = tmp();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts, ...(dep ? { devDependencies: { "@playwright/test": "^1.65.0" } } : {}) }));
  if (config) fs.writeFileSync(path.join(repo, config), "export default {};\n");
  if (installed) fs.mkdirSync(path.join(repo, "node_modules", "@playwright", "test"), { recursive: true });
  return repo;
}
const names = (gate) => gate.full.map((c) => c.name);

test("the proposed gate adds browser tests only when they are not already covered", () => {
  const gate = (r) => suggestGate(r, { e2e: true }); // browser tests are opt-in: see optional-browser-tests.test.mjs
  // A Playwright config and a plain test script: the runner is added.
  const a = gate(repoWith({ scripts: { test: "vitest run" }, config: "playwright.config.ts" }));
  assert.deepEqual(names(a), ["test", "e2e"]);
  assert.deepEqual(a.full.find((c) => c.name === "e2e"), { name: "e2e", cmd: "npx", args: ["--no-install", "playwright", "test"] });
  // The dependency alone is enough.
  assert.ok(names(gate(repoWith({ scripts: { test: "vitest run" }, dep: true }))).includes("e2e"));
  // The repo's own end-to-end script wins, run through the package manager.
  const b = gate(repoWith({ scripts: { test: "vitest run", "test:e2e": "playwright test --project=chromium" }, config: "playwright.config.ts" }));
  assert.deepEqual(b.full.find((c) => c.name === "e2e"), { name: "e2e", cmd: "npm", args: ["run", "--silent", "test:e2e"] });
  // The test script already runs Playwright: nothing is added.
  assert.deepEqual(names(gate(repoWith({ scripts: { test: "vitest run && playwright test" }, config: "playwright.config.ts" }))), ["test"]);
  // The test script runs the repo's e2e script: nothing is added.
  assert.deepEqual(names(gate(repoWith({ scripts: { test: "vitest run && npm run test:e2e", "test:e2e": "run-e2e" }, config: "playwright.config.ts" }))), ["test"]);
  // No Playwright: unchanged.
  assert.deepEqual(names(gate(repoWith({ scripts: { test: "vitest run" } }))), ["test"]);
});

test("doctor is silent for a repo without Playwright", () => {
  const repo = repoWith({ scripts: { test: "vitest run" } });
  assert.deepEqual(frontendCheck(repo, { platform: "linux", home: tmp(), env: {} }), []);
  assert.deepEqual(frontendCheck(path.join(repo, "missing"), { platform: "linux", home: tmp(), env: {} }), []);
});

test("doctor warns about a missing package or browser, and finds browsers in the default place for each system", () => {
  const home = tmp();
  const run = () => "";
  // Declared, not installed.
  const noPkg = repoWith({ dep: true });
  const r1 = frontendCheck(noPkg, { platform: "linux", home, env: {}, run });
  assert.equal(r1[0].level, "warn");
  assert.match(r1[0].detail, /not installed/);
  assert.match(r1[0].fix, /npm install/);
  // Installed, no browser downloaded.
  const repo = repoWith({ dep: true, installed: true });
  const r2 = frontendCheck(repo, { platform: "linux", home, env: {}, run });
  const missing = r2.find((r) => /browser/.test(r.name));
  assert.equal(missing.level, "warn");
  assert.match(missing.fix, /npx playwright install chromium/);
  // A browser in the default folder of each system is found.
  const defaults = {
    linux: (h) => path.join(h, ".cache", "ms-playwright"),
    darwin: (h) => path.join(h, "Library", "Caches", "ms-playwright"),
    win32: (h) => path.join(h, "AppData", "Local", "ms-playwright"),
  };
  for (const [platform, dir] of Object.entries(defaults)) {
    const h = tmp();
    fs.mkdirSync(path.join(dir(h), "chromium_headless_shell-1234"), { recursive: true });
    const env = platform === "win32" ? { LOCALAPPDATA: path.join(h, "AppData", "Local") } : {};
    const r = frontendCheck(repo, { platform, home: h, env, run });
    assert.equal(r.find((x) => /browser/.test(x.name)).level, "ok", platform);
  }
  // PLAYWRIGHT_BROWSERS_PATH=0 means inside the repo.
  const inRepo = repoWith({ dep: true, installed: true });
  fs.mkdirSync(path.join(inRepo, "node_modules", "playwright-core", ".local-browsers", "chromium-1"), { recursive: true });
  assert.equal(frontendCheck(inRepo, { platform: "linux", home: tmp(), env: { PLAYWRIGHT_BROWSERS_PATH: "0" }, run }).find((x) => /browser/.test(x.name)).level, "ok");
  // Windows: LOCALAPPDATA, not the home folder, decides.
  const local = tmp();
  fs.mkdirSync(path.join(local, "ms-playwright", "chromium-1"), { recursive: true });
  assert.equal(frontendCheck(repo, { platform: "win32", home: tmp(), env: { LOCALAPPDATA: local }, run }).find((x) => /browser/.test(x.name)).level, "ok");
  // The plain `playwright` package counts as installed.
  const plain = repoWith({ config: "playwright.config.ts" });
  fs.mkdirSync(path.join(plain, "node_modules", "playwright"), { recursive: true });
  assert.equal(frontendCheck(plain, { platform: "linux", home, env: {}, run })[0].level, "ok");
  // The browsers-path variable wins over the default.
  const custom = tmp();
  fs.mkdirSync(path.join(custom, "chromium-1234"));
  assert.equal(frontendCheck(repo, { platform: "linux", home, env: { PLAYWRIGHT_BROWSERS_PATH: custom }, run }).find((x) => /browser/.test(x.name)).level, "ok");
});

test("doctor names missing system libraries on Linux and skips the check elsewhere", () => {
  const home = tmp();
  const repo = repoWith({ dep: true, installed: true });
  const dir = path.join(home, ".cache", "ms-playwright", "chromium_headless_shell-1234", "chrome-linux");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "headless_shell"), "");
  const libs = (sample) => (bin) => {
    assert.ok(bin.endsWith("headless_shell"), "the browser binary is the one inspected");
    return sample;
  };
  const bad = frontendCheck(repo, { platform: "linux", home, env: {}, run: libs("\tlibnss3.so => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x1)\n\tlibatk-1.0.so.0 => not found\n") });
  const lib = bad.find((r) => /libraries/.test(r.name));
  assert.equal(lib.level, "warn");
  assert.match(lib.detail, /libnss3\.so/);
  assert.match(lib.detail, /libatk-1\.0\.so\.0/);
  assert.doesNotMatch(lib.detail, /libc\.so/);
  assert.match(lib.fix, /sudo npx playwright install-deps chromium/);
  assert.match(lib.fix, /terminal/);
  const good = frontendCheck(repo, { platform: "linux", home, env: {}, run: libs("\tlibc.so.6 => /lib/libc.so.6 (0x1)\n") });
  assert.equal(good.find((r) => /libraries/.test(r.name)).level, "ok");
  // The listing cannot run: skipped, no warning.
  const none = frontendCheck(repo, { platform: "linux", home, env: {}, run: () => null });
  assert.equal(none.find((r) => /libraries/.test(r.name)), undefined);
  // Other systems: skipped.
  for (const platform of ["darwin", "win32"]) {
    const h = tmp();
    const d = platform === "darwin" ? path.join(h, "Library", "Caches", "ms-playwright") : path.join(h, "AppData", "Local", "ms-playwright");
    fs.mkdirSync(path.join(d, "chromium-1234", "chrome-x"), { recursive: true });
    fs.writeFileSync(path.join(d, "chromium-1234", "chrome-x", "chrome"), "");
    const env = platform === "win32" ? { LOCALAPPDATA: path.join(h, "AppData", "Local") } : {};
    const r = frontendCheck(repo, { platform, home: h, env, run: () => assert.fail("must not run on " + platform) });
    assert.equal(r.find((x) => /libraries/.test(x.name)), undefined);
  }
});

test("the doctor command reports browser checks per mapped project", () => {
  const vault = tmp();
  const web = repoWith({ dep: true });
  const api = repoWith({ scripts: { test: "vitest run" } });
  const home = tmp();
  init(vault, { git: false });
  mapProject(vault, "web", web);
  mapProject(vault, "api", api);
  const prev = process.env.CANON_VAULT;
  process.env.CANON_VAULT = vault;
  try {
    const out = doctor({ cwd: api, env: { ...process.env, CANON_VAULT: vault }, home });
    const mine = out.filter((r) => /^playwright/.test(r.name));
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((r) => r.name.endsWith(" web")), mine.map((r) => r.name).join(", "));
    assert.ok(!out.some((r) => /^playwright/.test(r.name) && r.name.endsWith(" api")));
  } finally {
    if (prev === undefined) delete process.env.CANON_VAULT;
    else process.env.CANON_VAULT = prev;
  }
});

test("the flow skill requires states and widths for screen behaviors", () => {
  const flow = fs.readFileSync(path.join(ROOT, "skills/flow/SKILL.md"), "utf8");
  const step4 = /^4\. \*\*Spec\.\*\*[\s\S]*?(?=^5\. )/m.exec(flow);
  assert.ok(step4, "flow has a Spec step");
  assert.match(step4[0], /screen/i);
  assert.match(step4[0], /states?/i);
  assert.match(step4[0], /widths?/i);
  assert.match(step4[0], /empty, loading, error/i);
});
