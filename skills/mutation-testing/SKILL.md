---
name: mutation-testing
description: Check that tests really catch bugs by mutating changed code and reading the survivors. Use at the end of a phase or feature, or when tests pass but you doubt them.
---

Passing tests and high coverage do not prove the tests check anything. A mutation tool changes the code in small ways and reruns the tests. A mutant that survives means no test noticed the change.

Run it once per phase on the changed files, not after every edit. It costs machine time but few tokens, because you only read the survivors.

## Run

```
brain mutate            # prints the command for this repo's tool, scoped to changed files
brain mutate --run      # runs it and prints only surviving mutants and the score
brain mutate --base develop --run    # compare against another base branch
```

It detects Pest, Infection, Stryker or go-mutesting. Pest and Infection need a coverage driver (Xdebug 3 or PCOV); on WSL install PCOV. If the run errors, read the last lines, fix the setup, or run the tool's `--help`. Stryker and go-mutesting flags are unverified in this tool.

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
