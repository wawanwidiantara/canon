# Changelog

## Unreleased

- Edit-time hint. When the agent edits a file that active specs, ADRs or data models anchor, the PreToolUse hook adds one line naming them (up to 5, then "and N more"), so their text is updated in the same change instead of the Stop hook reporting them stale afterwards. It adds context only: it never blocks or asks, stays silent on files nothing anchors, and an ownership denial still wins.

## 0.1.15

- Two skills for UI. `frontend` builds a screen from a reference (never a blank page) and the project's design-system doc, which is a context doc anchored to the token file so `canon stale` catches drift. It requires empty, loading, error and success states, checks at 375, 768 and 1280, real content, copy rules and an accessibility floor, and lists the generic-design tells to avoid. It keeps browser tests optional and says to turn off any design detector's telemetry. `ui-review` stress-tests a finished screen with one plausible worst-case dataset, audits it against the design system, and reports Broken, Ugly or Fragile findings before fixing anything. Adapted, with credit, from Anthropic's `frontend-design` and Emil Kowalski's `break-ui`. `flow` routes UI work to both.
- Frontend gate, step 1. `canon gate init --e2e` adds a browser-test command to the full gate when the repo uses Playwright (the repo's own e2e script if it has one); without the option nothing changes, because browser tests are your choice per repo. `canon doctor` checks, for each mapped repo that uses Playwright, that the package and a Chromium browser are installed, and on Linux that the browser's system libraries are present. Each gap gets the exact fix; the library fix needs `sudo` in a terminal and says so. Set `browserTests: false` on a project in the vault config to skip these checks for it. It works from any OS (browser folders per system, `PLAYWRIGHT_BROWSERS_PATH`) and installs nothing. The `flow` skill now requires every UI behavior to name its states and widths and a reference, and says each one is closed by a browser test or by `canon confirm`, as the person chooses.

## 0.1.14

- `canon confirm <spec> <B#>`: a person confirms by hand a behavior that has no automated test, for example how a screen looks. It writes `(manual: date)` in place of the test link, counts as done for `complete` and `land`, and shows in the session brief as "by hand". The hook asks before it runs even when `ratify` is `auto`, so an agent cannot confirm for itself. Reopening a behavior removes the mark.
- `canon verify` now looks at the test links of a spec's done behaviors. It refuses when a linked test file is gone and warns when a test name no longer appears in its file. It is a text check and does not run the tests. `canon land` no longer aborts after the merge if a re-verify is refused; it reports the spec as still stale, finishes, and releases the claim.

- Fix: the Quicksilver guard blocked any command that named `canon qs` inside quotes or after a slash, for example in an `echo` or a `bash -c` string. The wrapper is now allowed wherever it appears; direct `qs` calls are still blocked.
- Fix: `canon task <spec> B# todo` silently reset a done behavior. It now needs `--reopen`.
- Fix: the gate that `canon gate init` proposes, and `canon check`, no longer run scripts that rewrite files (`lint:fix`, `--fix`, `--write`) or never end (`--watch`).
- `canon --version` and `canon -v` print the version.

- Usage signals: the session digest now records how many times each skill and subagent type ran, and `canon retro` lists them, so keep-or-cut decisions rest on use. The session brief says a retro is due once the digests since the last retro hold three corrections; it only suggests, and a finished retro clears it. Digests written earlier still load.
- The `ub-mode` skill is removed. Five of its habits (redesign from first principles, subtract before you add, attack the premise, idempotent operations, one writer per piece of state) are now in the Build step of `flow`, where every change passes through. If you ran `/canon:ub-mode`, there is nothing to run now.
- Skill trim: the `correct` skill is merged into `retro`, which now takes evidence from session digests and from the repo's own history and holds the fix ladder once. `ub-mode` keeps only its own principles and points to the process skills. `vault` points to `flow` for the close-out steps. `grilling` points to `domain-model` for the ADR test. If you ran `/canon:correct`, run `/canon:retro` instead.
- Skill routing: the `flow` skill has a "Which skill when" table that names every other skill, and each other skill ends with a "Next" section naming what normally follows. The session brief points to `flow`. A test fails when a skill is added without a table row or a Next section, or when a routing line names a skill that does not exist.

## 0.1.13

- `canon stale --diff`: for each stale doc, shows the changed lines of its anchored files since the commit it was last confirmed on, cut to 60 lines per file. A deleted file, a missing recorded commit or an unknown commit gets a note instead.
- `canon anchor` is refused inside a linked worktree, where the hashes would describe the branch and make the spec look stale from the main checkout. Anchor from the main checkout after the land.
- Fix: `canon codegraph --setup` could not register the MCP server, because the server name came after the `-e` option and `claude` read it as an environment variable.
- `flow` skill: once a plan is agreed, carry out the whole chain without asking to start each step. `grilling` skill: describe a choice by what the user sees. `untangle` skill: re-check each finding against the code before recording it.

## 0.1.12

- Internal cleanups with no change in behavior: one stale check and one way to print its problems, a named main-checkout rule in place of a slash argument, the opt-in agent names defined once (a new vault's config is built from them, and a test fails if `agents/` and the list disagree), and the groups of doc statuses named in the schema.
- More tests: the land and stale behaviors that had no test now have one, and each cleanup has its own.

## 0.1.11

- Opt-in subagent `canon:spec-reviewer`: a cold read of a newly written draft spec before it is approved. It reads only the spec and its `depends_on` docs, returns one line per finding and a verdict, and stays off until `agents.spec-reviewer` is true. The `flow` skill offers it at the spec step.

## 0.1.10

- `canon qs`: the one way to run Quicksilver in a mapped project. It checks the project setting, the API host (`quicksilverHosts`) and the input paths (no secrets files, nothing outside the repo, no `--no-secrets-guard`) in code. The hook now denies every direct call in a mapped project, even an allowed one, instead of trying to recognize each spelling. The `research`, `untangle` and `debug` skills use it for large inputs where it is allowed. `canon doctor` reports the key and base URL.
- Fix: the Quicksilver privacy gate now also blocks the form the skill really runs, `node ".../scripts/qs.mjs" filter ...`. Before, only a bare `qs` was matched, so the skill's own calls passed. `canon doctor` now finds the skill install too.

## 0.1.9

- `canon stale --mark` refuses to run inside a worktree, where it would flip shared doc status for a branch.
- `ratify` can be set per doc type, so lessons and discoveries can skip the confirmation while specs, ADRs and `supersede` still ask. Mixed commands, unknown docs and typos still ask.
- README and integrations docs describe the gate and parallel work.

## 0.1.8

- Fix: the vault lock now retries on the `EPERM` Windows reports while a lock directory is being deleted; under eight parallel writers one used to fail.
- `canon land`: one scripted path from a finished branch to main. Gate files may list `regen` commands that rebuild generated files after the rebase.

## 0.1.7

First public version, named Canon.

- `canon` CLI: vault, specs with behaviors and anchors, stale check, lifecycle commands, search, mutation and quality helpers, retro digests, multi-device sync, `doctor` and `usage`.
- A ratification gate: `canon approve` and `canon supersede` ask the user to confirm every time (`"ratify": "auto"` turns it off).
- Opt-in subagents `canon:reviewer` and `canon:researcher`, blocked by a hook until `agents.<name>` is true in `canon.config.json`.
- ADRs and data models can carry anchors, so `canon stale` covers the code claims they make. `canon new` notes when the heading falls back to the slug.
- Every read-modify-write of a doc or of the config now holds a lock, and config writes are atomic. Before, eight simultaneous `canon task done` calls kept only five updates, silently.
- Git worktrees work: a linked worktree of a mapped repo resolves to its project, and anchors, `canon stale` and the Stop gate check that worktree instead of the main checkout. `canon map` run inside a worktree maps the main checkout.
- `canon gate`: the repo's own definition of done in `canon.gate.json` (`fast` and `full` command lists, run as argv without a shell, stop at the first failure). `canon gate init` writes it from scripts the repo already defines. The Stop hook runs `fast` when code changed in the session.
- Packets for parallel work: a phase can declare `owns` paths. `canon claim` takes an approved phase (refusing unfinished dependencies and overlapping paths) and creates its worktree; `canon ready`, `board`, `release` and `check-owns` complete the loop. A PreToolUse hook denies edits outside the owned paths in a claimed worktree.
- Hooks for session start, compaction, the end of a turn, Bash calls and session end.
- Skills: `flow`, `grilling`, `tdd`, `mutation-testing`, `quality-check`, `debug`, `retro`, `correct`, `research`, `domain-model`, `onboard`, `vault`, `handoff`, `ub-mode`, `unslop`, `untangle`.
