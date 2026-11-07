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
