# Mutation testing, quality checks and optional tools

All of these look at the repo's changed files, print little when things pass, and can be overridden per project in the vault's `canon.config.json`.

## Mutation testing: `canon mutate`

A mutation tool changes your code in small ways and reruns the tests. A mutant that survives means no test noticed. `canon mutate --run` finds the tool for the repo and prints only the survivors and the score.

| Stack | Tool | Status |
|---|---|---|
| PHP | Pest, or Infection | Commands follow the tools' docs |
| TypeScript, JavaScript, Vue (NestJS, Next, React) | StrykerJS | Flags partly unverified |
| Dart, Flutter | dart_mutant | Unverified |
| Rust | cargo-mutants | Follows its docs |
| Python | mutmut | Unverified |
| Java, Kotlin | PIT | Unverified |
| C# | Stryker.NET | Unverified |
| Go | go-mutesting | Unverified |

A repo with several of these gets one run per tool. Test files are never mutated. For any other stack:

```json
"projects": { "my-app": { "mutation": { "cmd": "mytool", "args": ["run", "{files}"] } } }
```

`{files}` becomes one argument per changed source file, `{files,}` one comma-joined argument.

## Quality checks: `canon check`

The repo's own scripts come first (`lint`, `typecheck`, `analyse`, `check` in `package.json` or `composer.json`). Then, when installed: PHPStan/Larastan, Pint, Rector, tsc, ESLint, knip, `dart`/`flutter analyze`, `go vet`, `cargo clippy`, ruff, `jscpd` and OpenGrep. A pass is one line, a failure its last 25 lines.

```json
"checks": {
  "onStop": false,
  "disable": ["knip"],
  "commands": [{ "name": "credo", "cmd": "mix", "args": ["credo", "{files}"] }]
}
```

With `onStop: true` the fast checks run when a turn ends and the agent is stopped on failures.

## codegraph

[codegraph](https://github.com/colbymchenry/codegraph) indexes a repo so the agent reads fewer files. `canon codegraph` reports how it is set up for each mapped repo. `--setup` plans only the missing pieces: the index, a per-project MCP registration, and a local git exclude. It never edits files git tracks and skips registration when the server is already wired.

## Quicksilver and the privacy gate

[Quicksilver](https://github.com/UditAkhourii/quicksilver) sends file content to a third-party API to triage many files cheaply. It is off in every mapped project by default. A `PreToolUse` hook blocks `qs filter|classify|rank|find|ask` unless the project sets:

```json
"projects": { "my-app": { "quicksilver": true } }
```

Install Quicksilver yourself and keep it away from code you may not share.

## Opt-in subagents

Canon works with one agent. Two subagents ship with the plugin for when a fresh context is worth the extra tokens. Both are off by default; a `PreToolUse` hook blocks them until you enable them in `canon.config.json`:

```json
"agents": { "reviewer": true, "researcher": true }
```

| Agent | Use | Returns |
|---|---|---|
| `canon:reviewer` | Read-only check of one spec against its code and tests, by an agent that did not write the code. The `flow` skill offers it when closing a phase. | One line per behavior (`ok`, `gap`, `missing`, `drift`) with `path:line`, and a verdict. |
| `canon:researcher` | Reads docs and sources in its own context. The `research` skill offers it. | A short list of claims, each labelled `verified`, `secondary` or `memory`, with a source. |

Neither agent edits files or approves anything. The session brief lists the enabled ones, and skills use them only then. Each spawn starts cold, so expect a review to cost roughly as much as reading the spec and its code once more.

## Parallel work

Several agents can work at once when their phases own different paths. Canon does not start or supervise them; it makes the shared state safe and the hand-offs scripted.

1. A person approves phases that carry `owns: [...]` (see [schema](schema.md)). `canon ready` lists those that can start.
2. `canon claim <phase-id>` creates the worktree `<repo>-wt/<phase-id>` on branch `canon/<phase-id>`. Start an agent there, for example `claude` in that folder.
3. Inside it, a PreToolUse hook denies Edit and Write outside the owned paths. `canon check-owns` is the backstop for shell writes.
4. `canon gate fast` after each step; the Stop hook enforces it.
5. `canon land <phase-id>` from the main checkout merges it, or stops with the reason and leaves main untouched.

Doc writes are safe across sessions: every read-modify-write of a doc or of the config holds a lock. Claims are device-local (`.canon/claims.json`), so two devices do not coordinate; claim on one.
