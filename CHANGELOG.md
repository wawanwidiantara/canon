# Changelog

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
