---
name: mutation-testing
description: Check that tests really catch bugs by mutating changed code and reading the survivors. Use at the end of a phase or feature, or when tests pass but you doubt them.
---

Passing tests and high coverage do not prove the tests check anything. A mutation tool changes the code in small ways and reruns the tests. A mutant that survives means no test noticed the change.

Run it once per phase on the changed files, not after every edit. It costs machine time but few tokens, because you only read the survivors.

## Run

```
canon mutate            # prints the command for this repo's tool, scoped to changed files
canon mutate --run      # runs it and prints only surviving mutants and the score
canon mutate --base develop --run    # compare against another base branch
```

It detects the tool from the repo: Pest or Infection (PHP), StrykerJS (TypeScript, JavaScript, Vue: NestJS, Next, React, Node), dart_mutant (Dart, Flutter), cargo-mutants (Rust), mutmut (Python), PIT (Java, Kotlin), Stryker.NET (C#), go-mutesting (Go). A repo with several (for example Laravel plus Vue) gets one run per tool. Test files are never mutated.

Other stack, or a tool you prefer: add an override to the vault's `canon.config.json`, then `canon mutate` uses it:

```json
"projects": { "my-app": { "repo": "...", "mutation": { "cmd": "mytool", "args": ["run", "{files}"] } } }
```

`{files}` becomes one argument per changed source file; `{files,}` is one comma-joined argument.

Tools marked "flags unverified" were written from partial docs. If a run errors, read the last lines, run the tool's `--help`, and fix the command or add an override. Pest and Infection need a coverage driver (Xdebug 3 or PCOV); on WSL install PCOV. If the tool is not installed, say so and stop. Do not install tools without asking.

## Read the survivors

For each survivor, decide:

1. **A real gap.** The behavior matters and no test would fail. Add a test through the agreed seam, not a test of the mutated line. Rerun.
2. **Equivalent mutant.** The change does not alter behavior (for example reordering independent statements). Ignore it with the tool's ignore comment, such as `@pest-mutate-ignore`.
3. **Not worth a test.** Logging text, trivial getters, defensive code. Skip it and say why in one line.

## Rules

- Do not chase 100%. The score is a review aid, not a gate. Weak spots in important code matter more than the number.
- Never edit the code just to kill a mutant. Fix the test.
- If a survivor shows the code is wrong, fix the code and add a test first (see the `tdd` skill).
- Report: tool, files covered, score, survivors added to tests, survivors ignored and why.
