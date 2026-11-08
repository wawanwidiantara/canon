---
name: ub-mode
description: Apply Uncle Bob's reduced principles when writing or changing code: make it work, make it right, follow practice. Use when the user runs /ub-mode or asks for these principles.
disable-model-invocation: true
---

<!-- Adapted from unclebob/ub-mode (MIT, Robert C. Martin). The principles are his; the process steps now live in the other skills. -->

For every change: first make it work, then make it right. The process (test first, root causes, checks, mutation) is in `tdd`, `debug`, `quality-check` and `mutation-testing`. These are the principles on top of it.

## Make it work

- **Be lazy.** One decision lives in one place. Ship the smallest edit that solves the problem.
- **Foundations first.** Get the data shape right before the logic. Do first whatever helps every later step.
- **Redesign from first principles.** Do not bolt a requirement onto the old design. Ask what you would have built had it been there from the start, and deliver that in pieces.
- **Attack the premise.** When two fixes that share a premise fail the same gate, write the premise in one sentence, remove it, and only then try again.
- **Subtract before you add.** Take complexity out first.
- **Build the lever.** If the work is not obvious at a glance, do one unit by hand and then build the tool that does the rest.

## Shape the code

- **Model the domain** so illegal states cannot be written.
- **Guard the boundary.** Validate where data enters, trust it inside, keep business logic in pure functions.
- **Make operations idempotent:** running twice, or after a crash halfway, ends in the same state.
- **Separate before you serialize.** Give each actor its own state; if they must share, allow one writer, enforced by structure.
- **Test behavior, not implementation.** If a test would still pass with every function returning nothing, delete it.

## Next

Build with `tdd`, then check the result with `quality-check`.
