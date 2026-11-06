# software-factory

Personal agentic software-development setup for Claude Code on a small budget.

- `brain/` — CLI that creates, validates and tracks the central docs vault. Zero dependencies, Node 22.5+.
- `skills/` — curated skills the plugin loads (`grilling`, `brain-docs`).
- `brain query` / `brain show` — full-text search (SQLite FTS5, built into Node), a link graph and "which spec governs this file" over the vault, rebuilt automatically when docs change.
- `brain check` — quality gate on changed files without Sonar: uses the repo's own lint/type scripts first, then PHPStan/Larastan, Pint, Rector, tsc, ESLint, knip, dart/flutter analyze, go vet, clippy, ruff, jscpd and OpenGrep when installed; per-project overrides for any other stack. Output is capped; optional fast run when a turn ends.
- `brain codegraph` — shows how [codegraph](https://github.com/colbymchenry/codegraph) is set up for each mapped repo and plans only what is missing (index, per-project MCP registration, local git exclude). It never edits files git tracks, and it skips registration when the server is already wired in the repo's `.mcp.json` or your user config.
- Quicksilver privacy gate — a `PreToolUse` hook blocks `qs` (which sends file content to a third-party API) in mapped projects unless `projects.<slug>.quicksilver` is `true` in `brain.config.json`.
- `hooks/` — Claude Code hooks: `SessionStart` brief, `PreCompact` notes, `Stop` gate (validate, stale, docs-with-code). Silent in repos not mapped in the vault.
- `docs/schema.md` — the vault schema.

```
npm test
node brain/bin/brain.mjs          # usage
```

Works with any stack: docs, hooks and the CLI are language-neutral. Mutation testing has built-in support for PHP (Pest, Infection), TypeScript/JavaScript/Vue (StrykerJS), Dart/Flutter, Rust, Python, Java/Kotlin, C# and Go, and a per-project override for anything else.

Status: brain core and hooks work and are unit-tested (22 tests). Hooks were verified end to end in a headless Claude Code run (session start brief, stop gate with one block then release, session digest). Index/query, retro digest and more curated skills are next.

Works on Linux, macOS and Windows (Node 22.13+). Windows notes: the `Bash` tool needs Git for Windows, or use `brain.cmd` from PowerShell/cmd; the vault path file lives in `%APPDATA%\brain\vault`. CI runs the tests on all three systems; I could only run them on Linux myself.

## Vault and multiple devices

Docs live in a **vault**: a private git repo of their own, never inside your app repos and never in this public repo.

```
brain init ~/brain-vault        # config, README, .gitignore, git repo
cd ~/brain-vault && git remote add origin <private-repo-url> && git add -A && git commit -m init && git push -u origin main
brain setup ~/brain-vault       # remember the vault on this device
brain map my-app ~/code/my-app  # saves the repo's git remote in the shared config
```

On another device: clone the vault, run `brain setup <path>`, clone your app repos. A repo is recognized by its git remote, so no mapping is needed. At session start the vault is fast-forward pulled (at most every 10 minutes, never touching local edits, offline is fine). `brain sync` commits vault changes, rebases on the remote and pushes; it stops and keeps your commit if there is a conflict. Push is never automatic. Session digests stay per device unless `sync.digests` is `true` in `brain.config.json`.

Setup:
1. `claude --plugin-dir .` (or install the plugin) and put the vault path in `BRAIN_VAULT` or the file `vault` in `~/.config/brain/` (`%APPDATA%\brain\` on Windows).
2. Map each repo: `brain map <project> <repo-path>` inside the vault.
3. Allow the CLI so the agent can run it without prompts: add `Bash(brain:*)` to `permissions.allow` in your Claude Code settings. Plugins cannot ship permission rules.

The plugin puts `brain` on the Bash PATH. Hooks only act in repos mapped in the vault.

Try it: `claude --plugin-dir .`, and set `BRAIN_VAULT` (or write the vault path to `~/.config/brain/vault`).

## Credits

This project stands on other people's work. Several skills are adapted from, and many ideas come directly from:

- **Matt Pocock**, [mattpocock/skills](https://github.com/mattpocock/skills) (MIT): grilling, spec and ticket flow, TDD, retro, and the rule that specs avoid file paths and code snippets.
- **Robert C. Martin (Uncle Bob)**, [unclebob/ub-mode](https://github.com/unclebob/ub-mode) (MIT): the reduced-principles coding mode.
- **Lauren Tan (poteto)**, [pstack](https://github.com/cursor/plugins/tree/main/pstack) in cursor/plugins (MIT): `correct`, `unslop`, and the approach of turning repeated mistakes into structural checks.

Where a skill here is adapted from one of these, its file says so, and the original license applies to the copied parts. Thank you.

## License

MIT, see `LICENSE`.
