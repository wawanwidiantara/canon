#!/usr/bin/env node
import { approve, complete, enforce, supersede } from "../src/ops.mjs";
import { addAnchors, findStale, init, mapProject, markStale, newDoc, setTask, verifySpec } from "../src/ops.mjs";
import { validate } from "../src/validate.mjs";
import { findVault, listDocs, loadConfig } from "../src/vault.mjs";
import { resolveProject, writeSkip } from "../src/context.mjs";
import { setupDevice, syncVault } from "../src/sync.mjs";
import { repoFor } from "../src/anchors.mjs";
import { buildDigest, loadDigests, lastRetro, markRetroDone, retroReport, saveDigest, usageReport } from "../src/digest.mjs";
import { doctor, formatDoctor } from "../src/doctor.mjs";
import { apply as cgApply, describe as cgDescribe, inspect as cgInspect, plan as cgPlan } from "../src/codegraph.mjs";
import { checkFiles, formatResults, planChecks, runChecks } from "../src/check.mjs";
import { changedFiles, detectTools, filterSurvivors, plansFor, runMutation } from "../src/mutation.mjs";
import { parseBehaviors } from "../src/markdown.mjs";

const USAGE = `canon <command>
  init [dir] [--no-git]                    create a vault: config, README, .gitignore and a git repo
  setup [vault-dir]                        remember the vault location on this device
  sync [--pull-only]                       commit vault changes, rebase on the remote, push
  map <project> <repo-path> [--remote U]   map a repo on this device; its git remote is saved so other devices find it by themselves
  new <type> <project> <slug> [--title T] [--depends id,id] [--stack a,b]
  validate                                 check every doc; exit 1 on findings
  task <spec-id> <B#> <todo|doing|done> [--test path::name]
  anchor <doc-id> <path...>                record code files a spec, adr or data-model claims about
  stale [--mark]                           list specs whose code changed; --mark sets needs-review
  verify <doc-id>                          confirm the doc matches code, re-hash anchors
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
  gate init | fast | full                  the repo's own gate (canon.gate.json): init writes it from existing scripts; fast/full run it, stop at the first failure
  codegraph [project] [--setup [--yes]]    show how codegraph is set up for mapped repos; --setup plans (and with --yes applies) only the missing pieces
  approve <id>                             draft -> active, only if the doc validates as active
  complete <id>                            active -> completed; a phase or spec needs every behavior done and no stale code
  supersede <old-id> <new-id>              replace a doc (kept for history, hidden from search)
  enforce <lesson-id>                      mark a lesson enforced once a check prevents the mistake
  doctor                                   check this device: Node, vault, git, mapped repos, permissions, optional tools; prints the fix for each problem
  usage [project]                          token usage per week from session digests, costliest sessions, most used tools
  skip-docs                                current code changes need no doc (run inside the repo)
Vault: nearest canon.config.json above cwd, or $CANON_VAULT.`;

const NO_TOOL =
  "no mutation tool detected. Built in: Pest, Infection, StrykerJS, dart_mutant, cargo-mutants, mutmut, PIT, Stryker.NET, go-mutesting. Any other stack: set projects.<slug>.mutation = {cmd, args} in canon.config.json ({files} expands to changed files).";

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
    case "init": {
      const dir = pos[0] ?? process.cwd();
      init(dir, { git: !f["no-git"] });
      return console.log(`initialized vault in ${dir}${f["no-git"] ? "" : " (git repo)"}. Next: add a private remote, then \`canon setup ${dir}\``);
    }
    case "setup": {
      const r = setupDevice(pos[0] ?? process.cwd());
      return console.log(`this device now uses the vault at ${r.vault}\n(saved in ${r.file})`);
    }
    case "sync": {
      for (const line of syncVault(findVault(), { push: !f["pull-only"] })) console.log(line);
      return;
    }
    case "map": {
      const remote = mapProject(findVault(), pos[0], pos[1], { remote: typeof f.remote === "string" ? f.remote : undefined });
      return console.log(`mapped ${pos[0]}${remote ? ` (remote ${remote})` : " (no git remote found; other devices need `canon map` too)"}`);
    }
    case "new": {
      const [type, project, slug] = pos;
      const r = newDoc(findVault(), { type, project, slug, title: f.title, depends: list(f.depends), stack: list(f.stack) });
      console.log(r.file);
      if (!f.title) console.log(`note: the heading defaults to the slug ("${r.heading}"); pass --title "..." to set it`);
      return;
    }
    case "validate": {
      const findings = validate(findVault());
      if (findings.length) {
        console.error(`canon validate: ${findings.length} finding(s)`);
        for (const x of findings) console.error(` - ${x}`);
        process.exit(1);
      }
      return console.log("canon validate: OK");
    }
    case "task":
      setTask(findVault(), pos[0], pos[1], pos[2], typeof f.test === "string" ? f.test : undefined);
      return console.log(`${pos[1]} -> ${pos[2]}`);
    case "anchor":
      addAnchors(findVault(), pos[0], pos.slice(1));
      return console.log("anchored");
    case "stale": {
      const stale = f.mark ? markStale(findVault()) : findStale(findVault());
      if (!stale.length) return console.log("no stale docs");
      for (const s of stale) {
        for (const p of s.problems) console.log(`${s.id}: ${p.kind} ${p.anchor}`);
        if (s.verified_at && s.now && s.verified_at.split("@")[0] !== s.now.split("@")[0]) console.log(`  note: verified on ${s.verified_at}, repo is now on ${s.now}; a branch switch can cause this`);
      }
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
        override = config.projects?.[resolveProject(vault, repo)]?.mutation ?? null;
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
    case "gate": {
      const g = await import("../src/gates.mjs");
      const repo = (() => {
        const vault = findVault();
        const project = resolveProject(vault, process.cwd());
        return (project && repoFor(loadConfig(vault), project)) || process.cwd();
      })();
      const level = pos[0];
      if (level === "init") {
        const { file, gate } = g.initGate(repo);
        return console.log(`wrote ${file} (${gate.fast.length} fast, ${gate.full.length} full). Review it: only commands the repo already defines were added.`);
      }
      if (!["fast", "full"].includes(level)) throw new Error("usage: canon gate init | fast | full");
      const results = g.runGate(repo, level);
      console.log(g.formatGate(level, results));
      if (results.some((r) => !r.ok)) process.exit(1);
      return;
    }
    case "doctor": {
      const results = doctor();
      console.log(formatDoctor(results));
      if (results.some((r) => r.level === "FAIL")) process.exit(1);
      return;
    }
    case "usage": {
      const vault = findVault();
      const config = loadConfig(vault);
      const projects = pos[0] ? [pos[0]] : Object.keys(config.projects ?? {});
      const digests = projects.flatMap((p) => loadDigests(vault, p));
      return console.log(usageReport(digests));
    }
    case "digest": {
      const text = (await import("node:fs")).readFileSync(pos[0], "utf8");
      const d = buildDigest(text);
      if (typeof f.project === "string") return console.log(saveDigest(findVault(), f.project, d));
      return console.log(JSON.stringify(d, null, 1));
    }
    case "retro": {
      const vault = findVault();
      const project = pos[0] ?? resolveProject(vault, process.cwd());
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
        const vault = findVault();
        const config = loadConfig(vault);
        override = config.projects?.[resolveProject(vault, repo)]?.checks ?? null;
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
    case "codegraph": {
      const vault = findVault();
      const config = loadConfig(vault);
      const slugs = pos[0] ? [pos[0]] : Object.keys(config.projects ?? {});
      if (!slugs.length) throw new Error("no mapped projects");
      for (const slug of slugs) {
        const repo = repoFor(config, slug);
        if (!repo) throw new Error(`project '${slug}' has no repo mapped`);
        const s = cgInspect(repo);
        console.log(`# ${slug}\n${cgDescribe(s)}`);
        if (!f.setup) continue;
        const actions = cgPlan(s);
        if (!actions.length) {
          console.log("  nothing to do");
          continue;
        }
        for (const a of actions) console.log(`  ${f.yes ? "doing" : "would"}: ${a.what}${a.cmd ? ` -> ${a.cmd.join(" ")}` : ""}${a.manual ? ` -> ${a.manual}` : ""}`);
        if (f.yes) for (const line of cgApply(s, actions)) console.log(`  ${line}`);
      }
      return;
    }
    case "survivors": {
      const input = (await import("node:fs")).readFileSync(0, "utf8");
      return console.log(filterSurvivors(input));
    }
    case "approve":
      approve(findVault(), pos[0]);
      return console.log(`${pos[0]} is now active`);
    case "complete":
      complete(findVault(), pos[0]);
      return console.log(`${pos[0]} is now completed`);
    case "supersede":
      supersede(findVault(), pos[0], pos[1]);
      return console.log(`${pos[0]} superseded by ${pos[1]}`);
    case "enforce":
      enforce(findVault(), pos[0]);
      return console.log(`${pos[0]} marked enforced`);
    case "skip-docs": {
      const vault = findVault();
      const config = loadConfig(vault);
      const project = resolveProject(vault, process.cwd());
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
  console.error(`canon: ${e.message}`);
  process.exit(1);
}
