---
name: quality-check
description: Run the repo's lint, type, dead-code, duplication and security checks on the changed files and fix what they find. Use before closing a phase or committing, or when code feels inconsistent or sloppy.
---

Machines do the checking; you only read what failed. This is the free replacement for a Sonar-style gate.

## Run

If the repo has a `canon.gate.json`, run `canon gate fast` after each step and `canon gate full` before closing. That gate is the repo's own definition of done, so it comes before the checks below. No gate yet? `canon gate init` writes one from scripts the repo already has; read it before committing it.

```
canon check            # lists what would run for the changed files
canon check --run      # runs it; a pass is one line, a failure is the last 25 lines
canon check --run --fast   # skip slow tools (duplication, security, project-wide dead code)
```

It uses what the repo already defines first (package.json and composer.json scripts such as `lint`, `typecheck`, `analyse`). Then, if installed, it adds PHPStan/Larastan, Pint, Rector, tsc, ESLint, knip, `dart`/`flutter analyze`, `go vet`, `cargo clippy`, ruff, jscpd and OpenGrep, each scoped to the changed files. Tools marked "flags unverified" were written from memory: on error, run the tool's `--help` and adjust.

If nothing is configured for this stack, say so and suggest the one or two tools that fit. Do not install anything without asking. To add a tool for any stack, add `checks.commands` to the project in the vault's `canon.config.json`:

```json
"checks": { "onStop": false, "disable": ["knip"],
  "commands": [{ "name": "credo", "cmd": "mix", "args": ["credo", "{files}"] }] }
```

Set `"onStop": true` to run the fast checks automatically when a turn ends and block on failures.

## Fuzzy sweep (only when allowed)

Some questions a tool cannot express: "which of these files carry AI-style filler comments", "which look like copies of each other but differ in names". If the session brief says Quicksilver (`qs`) is allowed for this project, ask it one narrow yes/no question over the changed files, then read only the files it flags. If it is not allowed, a hook will block `qs`; do not try to work around it. Never use it to decide anything: it only shortlists.

## Fix

1. Fix real findings in the code. Do not silence a rule or add an ignore comment to make a check pass, unless the finding is wrong, and then say why.
2. For duplication, extract only when the copies will change together. Otherwise leave them.
3. For dead code, confirm it is unused (search for dynamic use, framework conventions, tests) before deleting.
4. Rerun until it passes, then run the `unslop` style pass only if the diff contains prose, comments or docs.

## Report

One line per tool: pass or fail, and what you changed. If the same kind of finding keeps recurring across sessions, tell the user so `retro` can turn it into a stricter rule.
