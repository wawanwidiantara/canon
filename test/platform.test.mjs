import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInvocation, canonical, configDir, findOnPath, isReservedName, isWithin, resolveCommand, toPosix, winQuote } from "../src/platform.mjs";
import { parse } from "../src/frontmatter.mjs";
import { validate } from "../src/validate.mjs";
import { addAnchors, init, mapProject, newDoc } from "../src/ops.mjs";
import { projectForCwd } from "../src/context.mjs";

const WIN = { platform: "win32" };
const present = (...files) => (f) => files.includes(f);

test("resolveCommand on Windows prefers .exe/.cmd/.bat shims and never extensionless unix scripts", () => {
  const env = { PATHEXT: ".COM;.EXE;.BAT;.CMD", Path: "C:\\tools;C:\\npm" };
  const exists = present("C:\\npm\\npx.cmd", "C:\\repo\\vendor\\bin\\pest", "C:\\repo\\vendor\\bin\\pest.bat", "C:\\tools\\git.exe");
  assert.equal(resolveCommand("npx", { ...WIN, env, cwd: "C:\\repo", exists }), "C:\\npm\\npx.cmd");
  assert.equal(resolveCommand("git", { ...WIN, env, cwd: "C:\\repo", exists }), "C:\\tools\\git.exe");
  assert.equal(resolveCommand("./vendor/bin/pest", { ...WIN, env, cwd: "C:\\repo", exists }), "C:\\repo\\vendor\\bin\\pest.bat");
  assert.equal(resolveCommand("missing", { ...WIN, env, cwd: "C:\\repo", exists }), "missing");
  assert.equal(resolveCommand("npx", { platform: "linux" }), "npx");
});

test("buildInvocation runs .cmd/.bat through cmd.exe with quoting, .exe directly, anything on Unix directly", () => {
  const env = { PATHEXT: ".EXE;.CMD", Path: "C:\\npm;C:\\bin", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
  const exists = present("C:\\npm\\npx.cmd", "C:\\bin\\git.exe");
  const cmd = buildInvocation("npx", ["eslint", "src/a b.ts", 'say "hi"'], { ...WIN, env, cwd: "C:\\repo", exists });
  assert.equal(cmd.file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(cmd.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(cmd.args[3], '"C:\\npm\\npx.cmd eslint "src/a b.ts" "say ""hi""""');
  assert.equal(cmd.verbatim, true);
  const exe = buildInvocation("git", ["status"], { ...WIN, env, cwd: "C:\\repo", exists });
  assert.deepEqual([exe.file, exe.args, exe.verbatim], ["C:\\bin\\git.exe", ["status"], false]);
  assert.deepEqual(buildInvocation("npx", ["a"], { platform: "darwin" }), { file: "npx", args: ["a"], verbatim: false });
  assert.equal(winQuote("plain-1.ts"), "plain-1.ts");
  assert.equal(winQuote("a&b"), '"a&b"');
});

test("findOnPath works with a real PATH on this OS", () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const name = process.platform === "win32" ? "faketool.cmd" : "faketool";
  fs.writeFileSync(path.join(bin, name), "x", { mode: 0o755 });
  const env = { PATH: bin, Path: bin, PATHEXT: ".CMD;.EXE" };
  assert.equal(findOnPath("faketool", { env }), path.join(bin, name));
  assert.equal(findOnPath("nothere", { env }), null);
});

test("isWithin: case-insensitive on Windows and macOS, exact on Linux, no prefix tricks", () => {
  assert.equal(isWithin("C:\\Code\\Repo", "c:\\code\\repo\\src", "win32"), true);
  assert.equal(isWithin("C:\\Code\\Repo", "C:\\Code\\Repo2", "win32"), false);
  assert.equal(isWithin("/Users/me/Repo", "/users/me/repo/src", "darwin"), true);
  assert.equal(isWithin("/home/me/Repo", "/home/me/repo/src", "linux"), false);
  assert.equal(isWithin("/home/me/repo", "/home/me/repo/", "linux"), true);
  assert.equal(isWithin("/home/me/repo", "/home/me/repo-two", "linux"), false);
});

test("posix anchors, reserved names, config directory", () => {
  assert.equal(toPosix("src\\Auth\\Login.php"), "src/Auth/Login.php");
  for (const n of ["con", "NUL", "com1", "lpt9", "aux"]) assert.equal(isReservedName(n), true, n);
  for (const n of ["console", "auxiliary", "no-con"]) assert.equal(isReservedName(n), false, n);
  assert.equal(configDir({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32", "C:\\Users\\me"), path.join("C:\\Users\\me\\AppData\\Roaming", "canon"));
  assert.equal(configDir({ XDG_CONFIG_HOME: "/x" }, "linux", "/home/me"), path.join("/x", "canon"));
  assert.equal(configDir({}, "darwin", "/Users/me"), path.join("/Users/me", ".config", "canon"));
});

test("CRLF documents parse, validate and keep working (Windows editors, autocrlf)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const vault = path.join(root, "vault");
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "a.php"), "x");
  init(vault);
  mapProject(vault, "demo", repo);
  const s = newDoc(vault, { type: "spec", project: "demo", slug: "login" });
  let t = fs.readFileSync(s.file, "utf8");
  t = t.replace(/## Goal\n\n<!--.*?-->/s, "## Goal\n\ng").replace(/## Behaviors\n\n<!--.*?-->/s, "## Behaviors\n\n- [ ] B1: works")
    .replace(/## Implementation Decisions\n\n<!--.*?-->/s, "## Implementation Decisions\n\nd").replace(/## Testing Decisions\n\n<!--.*?-->/s, "## Testing Decisions\n\nt")
    .replace(/## Non-goals\n\n<!--.*?-->/s, "## Non-goals\n\nn").replace("status: draft", "status: active");
  fs.writeFileSync(s.file, t.replace(/\n/g, "\r\n"));
  assert.equal(parse(fs.readFileSync(s.file, "utf8")).data.status, "active");
  assert.deepEqual(validate(vault), []);
  addAnchors(vault, s.id, [".\\src\\a.php"]);
  assert.match(fs.readFileSync(s.file, "utf8"), /anchors: \["src\/a\.php@[0-9a-f]{12}"\]/);
  assert.deepEqual(validate(vault), []);
});

test("projectForCwd tolerates case and trailing-separator differences on case-insensitive systems", () => {
  const cfg = { projects: { a: { repo: path.resolve("/x/Repo") } } };
  assert.equal(projectForCwd(cfg, path.resolve("/x/Repo/sub")), "a");
  assert.equal(projectForCwd(cfg, path.resolve("/x/Repo2")), null);
});

test("canonical resolves symlinks, so a repo mapped by one path is found from another", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
  const real = path.join(root, "real");
  const link = path.join(root, "link");
  fs.mkdirSync(path.join(real, "src"), { recursive: true });
  try {
    fs.symlinkSync(real, link, "junction");
  } catch {
    return t.skip("cannot create symlinks here");
  }
  assert.equal(canonical(link), fs.realpathSync.native(real));
  assert.equal(isWithin(canonical(link), canonical(path.join(real, "src"))), true);
  assert.equal(canonical(path.join(root, "missing")), path.join(root, "missing"));
});
