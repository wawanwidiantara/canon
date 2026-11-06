---
name: ub-mode
description: Apply Uncle Bob's reduced principles when writing or changing code: make it work, make it right, follow practice. Use when the user runs /ub-mode or asks for these principles.
disable-model-invocation: true
---

<!-- Adapted from unclebob/ub-mode (MIT, Robert C. Martin). The structure and principles are his; the tool references and the commit rule are changed for this setup. -->

For every change: first make it work, then make it right, then follow practice.

## First, make it work

- **Be lazy.** One decision lives in one place. Ship the smallest edit that solves the problem.
- **Think foundations first.** Get the data shape right before the logic. Do first whatever helps every later step. Do not share state a concurrent writer could corrupt.
- **Test first** (`tdd` skill). See the test fail for the reason you expect. If an honest test is impractical, write none rather than a bad one.
- **Redesign from first principles.** Do not bolt a requirement onto the old design. Ask what you would have built had it been there from the start, and deliver that in pieces.
- **Attack the premise.** When two fixes that share a premise fail the same gate, write the premise in one sentence, remove it, and only then try again.
- **Subtract before you add.** Take complexity out first.
- **Aim at a checkable end state.** A planned, reversible break in the middle is allowed.
- **Build the lever.** If the work is not obvious at a glance, do one unit by hand and then build the tool that does the rest.

### Architecture

- **Model the domain** so illegal states cannot be written. Keep a glossary (`domain-model` skill). If the code is already clear and local, leave it.
- **Guard the boundary.** Validate where data enters, trust it inside, keep business logic in pure functions.
- **Use the type system.** Parse outside data once. Never silence the compiler.
- **Make operations idempotent:** running twice, or after a crash halfway, ends in the same state.
- **Separate before you serialize.** Give each actor its own state; if they must share, allow one writer, enforced by structure.

## Then, make it right

- **Fix root causes** (`debug` skill). A guard that only hides the crash is not a fix.
- **Work in verifiable units:** finish and check one before starting the next.
- **Test behavior, not implementation.** If a test would still pass with every function returning nothing, delete it.
- **Complexity, duplication, dead code:** run `quality-check`. Split or test functions with high complexity, remove duplicates that will change together, delete unused code.
- **Mutation:** run `mutation-testing`. Cover the uncovered, kill the survivors that matter.
- **Refactor** by pinning behavior with tests, changing structure, and proving behavior did not change.

## Practice

- Keep a short log of each action and why; report it when done.
- Keep the main thread small: send bulk reading to tools such as `brain query` and the code graph, and keep only the summary.
- Clean up what you created: temp files, debug lines, throwaway scripts. Uncommitted work waits for the user's decision.
- Commit in small ordered steps when the user asks you to commit, each message saying why, what and how it was proven. Never push unless the user asks.
