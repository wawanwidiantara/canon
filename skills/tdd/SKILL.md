---
name: tdd
description: Test-driven development tied to the canon. Use when building a feature or fixing a bug test-first, on "red-green-refactor", or when a spec behavior needs a test.
---

<!-- Adapted from mattpocock/skills `tdd` (MIT, Matt Pocock). -->

The loop is red, then green, one behavior at a time. The spec's behaviors are the list of tests to write.

## Before the first test

1. Read the spec's Testing Decisions. They name the seams. If there is no spec or no seams, propose them and get the user's OK first. A seam is a public boundary you can observe behavior through. Fewer and higher is better.
2. Pick one behavior, `B1`. Mark it: `canon task <spec-id> B1 doing`.

## The loop

1. **Red.** Write one test for that behavior at an agreed seam. Name it after the behavior. Run it and see it fail for the right reason.
2. **Green.** Write the least code that passes. Nothing speculative.
3. **Done.** Run the whole suite. Then `canon task <spec-id> B1 done --test path::test name`.
4. Next behavior. Do not write all tests first: each test should respond to what the last cycle taught you.

Refactor after the behaviors are green, not inside the loop.

## A good test

- Checks behavior through the public interface, so it survives a refactor.
- Gets its expected value from outside the code: a literal, a worked example, the spec. Never recompute the value the way the code does.
- Mocks only system boundaries: external APIs, time, randomness, sometimes the DB or filesystem. Never your own classes. See `mocking.md`.
- Reads like the spec line it proves. See `tests.md`.

## Bugs

Write the failing test that reproduces the bug first, at the seam where it shows. Then fix. Add the behavior to the spec if it was missing.

## When all behaviors in a phase are done

Run the `mutation-testing` skill on the changed files, then `canon stale` and `canon validate`.

## Next

When every behavior is done, run `mutation-testing`.
