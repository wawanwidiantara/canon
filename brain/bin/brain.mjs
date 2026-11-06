#!/usr/bin/env node
import { addAnchors, findStale, init, mapProject, markStale, newDoc, setTask, verifySpec } from "../src/ops.mjs";
import { validate } from "../src/validate.mjs";
import { findVault, listDocs, loadConfig } from "../src/vault.mjs";
import { projectForCwd, writeSkip } from "../src/context.mjs";
import { repoFor } from "../src/anchors.mjs";
import { changedFiles, commandFor, detectStack, filterSurvivors, runMutation } from "../src/mutation.mjs";
import { parseBehaviors } from "../src/markdown.mjs";

const USAGE = `brain <command>
  init [dir]                               create a vault (brain.config.json)
  map <project> <repo-path>                tell the vault where a project's code lives
  new <type> <project> <slug> [--title T] [--depends id,id] [--stack a,b]
  validate                                 check every doc; exit 1 on findings
  task <spec-id> <B#> <todo|doing|done> [--test path::name]
  anchor <spec-id> <path...>               record code files a spec governs
  stale [--mark]                           list specs whose code changed; --mark sets needs-review
  verify <spec-id>                         confirm spec matches code, re-hash anchors
  status [project]                         behavior progress per spec
  mutate [--base B] [--run]                mutation tool for this repo scoped to changed files; --run executes, prints survivors only
  skip-docs                                current code changes need no doc (run inside the repo)
Vault: nearest brain.config.json above cwd, or $BRAIN_VAULT.`;

function flags(args) {
  const pos = [];
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const k = args[i].slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) f[k] = true;
      else {
        f[k] = next;
        i++;
      }
    } else pos.push(args[i]);
  }
  return { pos, f };
}

const list = (s) => (s ? String(s).split(",").filter(Boolean) : []);

async function main(argv) {
  const [cmd, ...rest] = argv;
  const { pos, f } = flags(rest);
  switch (cmd) {
    case "init":
      init(pos[0] ?? process.cwd());
      return console.log("initialized");
    case "map":
      mapProject(findVault(), pos[0], pos[1]);
      return console.log(`mapped ${pos[0]}`);
    case "new": {
      const [type, project, slug] = pos;
      const r = newDoc(findVault(), { type, project, slug, title: f.title, depends: list(f.depends), stack: list(f.stack) });
      return console.log(r.file);
    }
    case "validate": {
      const findings = validate(findVault());
      if (findings.length) {
        console.error(`brain validate: ${findings.length} finding(s)`);
        for (const x of findings) console.error(` - ${x}`);
        process.exit(1);
      }
      return console.log("brain validate: OK");
    }
    case "task":
      setTask(findVault(), pos[0], pos[1], pos[2], typeof f.test === "string" ? f.test : undefined);
      return console.log(`${pos[1]} -> ${pos[2]}`);
    case "anchor":
      addAnchors(findVault(), pos[0], pos.slice(1));
      return console.log("anchored");
    case "stale": {
      const stale = f.mark ? markStale(findVault()) : findStale(findVault());
      if (!stale.length) return console.log("no stale specs");
      for (const s of stale) for (const p of s.problems) console.log(`${s.id}: ${p.kind} ${p.anchor}`);
      process.exit(1);
      return;
    }
    case "verify":
      verifySpec(findVault(), pos[0]);
      return console.log(`verified ${pos[0]}`);
    case "mutate": {
      const repo = process.cwd();
      const base = typeof f.base === "string" ? f.base : undefined;
      if (f.run) {
        const r = runMutation(repo, { base });
        console.log(`tool: ${r.stack}; changed: ${r.files.length} file(s)`);
        return console.log(r.plan ? r.output : "nothing mutable changed");
      }
      const stack = detectStack(repo);
      const plan = stack && commandFor(stack, changedFiles(repo, base), { base: base ?? "main" });
      if (!plan) return console.log(stack ? `tool: ${stack}; nothing mutable changed` : "no mutation tool detected");
      console.log([plan.cmd, ...plan.args].join(" "));
      for (const n of plan.notes) console.log(`note: ${n}`);
      return;
    }
    case "survivors": {
      const input = (await import("node:fs")).readFileSync(0, "utf8");
      return console.log(filterSurvivors(input));
    }
    case "skip-docs": {
      const vault = findVault();
      const config = loadConfig(vault);
      const project = projectForCwd(config, process.cwd());
      if (!project) throw new Error("cwd is not inside a mapped repo");
      writeSkip(repoFor(config, project));
      return console.log(`ok: no doc needed for the current changes in ${project}`);
    }
    case "status": {
      for (const d of listDocs(findVault())) {
        if (d.data?.type !== "spec" || (pos[0] && d.data.project !== pos[0])) continue;
        const { items } = parseBehaviors(d.body);
        const done = items.filter((b) => b.state === "done").length;
        console.log(`${d.data.id} [${d.data.status}] ${done}/${items.length}`);
      }
      return;
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  console.error(`brain: ${e.message}`);
  process.exit(1);
}
