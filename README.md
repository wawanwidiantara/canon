# Software Factory: a project brain and workflow for Claude Code

[![tests](https://img.shields.io/github/actions/workflow/status/wawanwidiantara/software-factory/test.yml?branch=main&label=tests&style=flat-square)](https://github.com/wawanwidiantara/software-factory/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933?style=flat-square)](#requirements)
[![Linux macOS Windows](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey?style=flat-square)](#requirements)

**Give Claude Code a memory of your projects that stays true to the code, learns from its own mistakes, and spends few tokens.**

Software Factory is a Claude Code plugin and a small `brain` command. Specs, decisions and lessons live in one private git repo, the *vault*, never inside your app repos. Hooks keep the docs in step with the code. Scripts do the checking, so the model only reads what failed. A retro turns the mistakes you keep correcting into checks that stop them.

```text
/plugin install software-factory --marketplace wawanwidiantara/software-factory
```

```bash
brain new spec my-app login            # a spec with every section in place, filled by the agent
brain task my-app-spec-001-login B1 done --test tests/LoginTest.php::logs_in
brain stale                            # which specs no longer match the code
brain query "passwordless login"       # find what you already decided
```

## Small on purpose

Most setups end in one of two places: instruction files that grow until nobody reads them, or a multi-agent framework that costs more tokens than the work. Software Factory is the middle option. There is one agent. Everything that does not need judgment, such as validating docs, hashing code, running mutation tests, linting, searching and syncing, is a script that costs no tokens when it passes. The model spends its tokens on research, design decisions and code.

| Piece | What it does |
|---|---|
| Vault | One private git repo for specs, phases, ADRs, lessons and glossaries. A schema and a validator keep every doc the same shape. |
| Spec first | A spec lists behaviors as testable lines. Each behavior links to the test that proves it. Specs hold no file paths or code, because those go stale. |
| Anchors and stale check | A spec records hashes of the code it governs. When that code changes, `brain stale` says so, and `brain complete` refuses to close work on a stale spec. |
| Hooks | At session start the agent gets a short brief: open work, stale specs, sync state. At the end of a turn it is stopped once if code changed and no doc did. The hooks do nothing in repos you did not map. |
| Test-first flow | Skills for grilling, spec, tdd, mutation testing, quality checks, debugging and retro, tied together by a `flow` skill. |
| Mutation testing | Runs the right tool for the stack on the changed files and shows only the surviving mutants. |
| Quality checks | Lint, types, dead code, duplication and security rules on changed files, without Sonar. Uses the repo's own scripts first. |
| Search | Full-text search and a link graph over the vault, built into Node with no database to run. |
| Learning | Session digests (no LLM) feed a retro that turns repeated corrections into lint rules, tests and lessons. |
| Many devices | The vault syncs through its own git remote. A repo is found on any device by its git remote. |
| Privacy gate | Blocks tools that send your code to a third party, such as Quicksilver, unless you allow it per project. |

The pieces are described in [docs/integrations.md](docs/integrations.md), the commands in [docs/commands.md](docs/commands.md), the vault format in [docs/schema.md](docs/schema.md) and sync in [docs/devices.md](docs/devices.md).

### Is it for you?

**Use it** when you work alone or in a small group with Claude Code, on several repos, on a limited plan, and you want specs and decisions that survive new sessions, compaction and other machines.

**Skip it** when you want several agents working in parallel, docs that live in each repo and get reviewed in its pull requests, or a shared vault with per-person permissions.

## Quick start

Needs Node 22.13 or newer. Claude Code itself does not need Node, so install it if `node -v` fails.

```bash
# 1. Install the plugin (inside Claude Code)
/plugin install software-factory --marketplace wawanwidiantara/software-factory

# 2. Create your vault: a private repo for your docs
brain init ~/brain-vault
cd ~/brain-vault && git remote add origin <your-private-repo> && git add -A && git commit -m "chore: init" && git push -u origin main

# 3. Tell this device where it is, and map a repo
brain setup ~/brain-vault
brain map my-app ~/code/my-app
```

Add `Bash(brain:*)` to `permissions.allow` in your Claude Code settings so the agent can run the CLI without a prompt each time. Plugins cannot ship permission rules.

Run `brain doctor` at any point. It checks Node, git, the vault, your mapped repos, the permission and the optional tools, and prints the fix for each problem.

For a repo that already has code, run the `onboard` skill once. Then start work with the `flow` skill: research, grill, spec, phase, tdd, mutation, check, close.

## How a change flows

1. **Orient.** `brain query` finds what you already decided.
2. **Grill.** The agent asks you the open questions, a few at a time, each with its recommendation. Your decisions are written into the spec and into ADRs.
3. **Spec and phase.** Behaviors, decisions and test seams. You approve it.
4. **Build.** One behavior at a time: failing test, passing code, `brain task ... done`.
5. **Close.** Mutation tests, quality checks, a stale check, then `brain complete`. It refuses if a behavior is open or a spec is stale.
6. **Learn.** `retro` reads the session digests and proposes checks for what you had to correct.

## Requirements

- Node 22.13 or newer, and git.
- Linux, macOS or Windows. On Windows the `Bash` tool needs Git for Windows, or use `brain.cmd` from PowerShell or cmd.
- Optional: [codegraph](https://github.com/colbymchenry/codegraph), a mutation testing tool for your stack, and [Quicksilver](https://github.com/UditAkhourii/quicksilver).

## Status

Version 0.1. Honest limits:

- It runs on any stack, but mutation and quality tools differ in how well they are tested here. The git, codegraph and `jscpd` handling was run against the real tools. The Pest, Infection and cargo-mutants commands follow their documentation but have not been run here. Several others, such as the Stryker, Dart, mutmut, PIT, knip and OpenGrep commands, were written from partial docs and are marked "flags unverified" in their output.
- The hooks were verified in headless Claude Code sessions on Linux. The tests run on Linux, macOS and Windows in CI. Everything else about Windows and macOS is from reading the platform rules.
- Search is keyword search. It will not find a doc that says "works offline" when you ask about "no internet".
- Two devices that edit the same line of a doc need you to resolve the conflict with git.

## Credits

This project stands on other people's work. Several skills are adapted from, and many ideas come directly from:

- **Matt Pocock**, [mattpocock/skills](https://github.com/mattpocock/skills) (MIT): grilling, spec and ticket flow, TDD, retro, and the rule that specs avoid file paths and code snippets.
- **Robert C. Martin (Uncle Bob)**, [unclebob/ub-mode](https://github.com/unclebob/ub-mode) (MIT): the reduced-principles coding mode.
- **Lauren Tan (poteto)**, [pstack](https://github.com/cursor/plugins/tree/main/pstack) in cursor/plugins (MIT): `correct`, `unslop`, and the approach of turning repeated mistakes into structural checks.

Where a skill here is adapted from one of these, its file says so, and the original license applies to the copied parts. Thank you.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE). Made by [Clowd](https://github.com/wawanwidiantara).
