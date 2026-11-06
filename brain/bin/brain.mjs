#!/usr/bin/env node
import { addAnchors, findStale, init, mapProject, markStale, newDoc, setTask, verifySpec } from "../src/ops.mjs";
import { validate } from "../src/validate.mjs";
import { findVault, listDocs, loadConfig } from "../src/vault.mjs";
import { projectForCwd, writeSkip } from "../src/context.mjs";
import { repoFor } from "../src/anchors.mjs";
import { buildDigest, loadDigests, lastRetro, markRetroDone, retroReport, saveDigest } from "../src/digest.mjs";
import { checkFiles, formatResults, planChecks, runChecks } from "../src/check.mjs";
import { changedFiles, detectTools, filterSurvivors, plansFor, runMutation } from "../src/mutation.mjs";
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
  digest <transcript.jsonl> [--project P]  summarize a session (saved to the vault if --project given)
  retro [project] [--done]                 report on session digests since the last retro; --done marks it reviewed
  index                                    rebuild the search index (queries do this automatically when docs change)
  query <text> [--project P] [--type T] [--status S] [--limit N]   full-text search
  query --governs <path>                   specs that govern a code path
  query --deps <id> | --dependents <id>    what a doc builds on / what builds on it
  query --open [--project P]               unfinished behaviors
  query --active <project> [--type T]      one line per active doc
  show <id> [--section S]                  print a doc or a single section
  check [--run] [--fast] [--base B]        quality checks on changed files (lint, types, dead code, duplication, security); --run executes, capped output
  skip-docs                                current code changes need no doc (run inside the repo)
Vault: nearest brain.config.json above cwd, or $BRAIN_VAULT.`;

const NO_TOOL =
  "no mutation tool detected. Built in: Pest, Infection, StrykerJS, dart_mutant, cargo-mutants, mutmut, PIT, Stryker.NET, go-mutesting. Any other stack: set projects.<slug>.mutation = {cmd, args} in brain.config.json ({files} expands to changed files).";

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
      let override = null;
      try {
        const vault = findVault();
        const config = loadConfig(vault);
        override = config.projects?.[projectForCwd(config, repo)]?.mutation ?? null;
      } catch {
        // no vault: built-in detection only
      }
      if (f.run) {
        const r = runMutation(repo, { base, override });
        if (!r.results.length) return console.log(detectTools(repo).length || override ? "nothing mutable changed" : NO_TOOL);
        for (const x of r.results) {
          console.log(`tool: ${x.id}${x.verified ? "" : " (flags unverified)"}; changed: ${r.files.length} file(s)`);
          console.log(x.output);
        }
        return;
      }
      const plans = plansFor(repo, changedFiles(repo, base), { base, override });
      if (!plans.length) return console.log(detectTools(repo).length || override ? "nothing mutable changed" : NO_TOOL);
      for (const p of plans) {
        console.log(`# ${p.label ?? p.id}${p.verified ? "" : " (flags unverified)"}`);
        console.log(p.args.join(" "));
        for (const n of p.notes) console.log(`note: ${n}`);
      }
      return;
    }
    case "index":
    case "query":
    case "show": {
      process.removeAllListeners("warning"); // node:sqlite prints an experimental notice
      const ix = await import("../src/index.mjs");
      const vault = findVault();
      const out = (lines) => console.log(lines.length ? lines.join("\n") : "no results");
      if (cmd === "index") return console.log(`indexed ${ix.buildIndex(vault)} docs`);
      if (cmd === "show") return console.log(ix.show(vault, pos[0], typeof f.section === "string" ? f.section : undefined));
      const project = typeof f.project === "string" ? f.project : undefined;
      if (typeof f.governs === "string") return out(ix.governs(vault, f.governs));
      if (typeof f.deps === "string") return out(ix.dependencies(vault, f.deps));
      if (typeof f.dependents === "string") return out(ix.dependents(vault, f.dependents));
      if (f.open) return out(ix.openBehaviors(vault, project));
      if (typeof f.active === "string") return out(ix.listActive(vault, f.active, typeof f.type === "string" ? f.type : undefined));
      if (!pos.length) throw new Error("query needs text or one of --governs --deps --dependents --open --active");
      return out(ix.search(vault, pos.join(" "), { project, type: typeof f.type === "string" ? f.type : undefined, status: typeof f.status === "string" ? f.status : undefined, limit: Number(f.limit) || 8 }));
    }
    case "digest": {
      const text = (await import("node:fs")).readFileSync(pos[0], "utf8");
      const d = buildDigest(text);
      if (typeof f.project === "string") return console.log(saveDigest(findVault(), f.project, d));
      return console.log(JSON.stringify(d, null, 1));
    }
    case "retro": {
      const vault = findVault();
      const project = pos[0] ?? projectForCwd(loadConfig(vault), process.cwd());
      if (!project) throw new Error("give a project or run inside a mapped repo");
      if (f.done) {
        markRetroDone(vault, project);
        return console.log(`retro marked done for ${project}`);
      }
      return console.log(retroReport(loadDigests(vault, project, lastRetro(vault, project))));
    }
    case "check": {
      const repo = process.cwd();
      const base = typeof f.base === "string" ? f.base : undefined;
      let override = null;
      try {
        const config = loadConfig(findVault());
        override = config.projects?.[projectForCwd(config, repo)]?.checks ?? null;
      } catch {
        // no vault: built-in detection only
      }
      const files = checkFiles(repo, base);
      const plans = planChecks(repo, files, { override, fast: Boolean(f.fast) });
      if (!plans.length) return console.log(files.length ? "no quality tool applies to the changed files (none configured for this stack)" : "no changed files");
      if (!f.run) {
        for (const p of plans) console.log(`# ${p.label}${p.verified ? "" : " (flags unverified)"}\n${p.args.join(" ")}`);
        return;
      }
      const results = runChecks(repo, plans);
      console.log(formatResults(results));
      if (results.some((r) => !r.ok)) process.exit(1);
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
