---
name: correct
description: Find the mistakes agents keep repeating in a repo and make each one impossible, using structure first, then types, then a lint, then a test, and docs last. Use after the user corrects you again, or from a retro.
disable-model-invocation: true
---

<!-- Adapted from pstack `correct` (MIT, Lauren Tan). -->

The user keeps correcting agents for the same mistakes. Change the repo so the next agent cannot make them. Assume every contributor sees only the files it opened, copies the nearest example, and takes the shortest path that compiles.

## Find the classes

Read recent commits and reverts, review comments, instruction files, comments that explain workarounds, and `brain retro` output. Group mistakes into classes. A class counts once it has happened twice.

## Fix each class at the highest level that works

1. **Architecture.** One owner per piece of state, one supported way per task. Hide internals so the wrong import fails. Replace hand-synced lists with one source. Delete old paths an agent would copy.
2. **Types and checks.** Make the bad state unwritable. If bad code still compiles, add a lint or CI check whose error names the file or function to use instead. If the pattern is already common, fail only when a change adds more.
3. **Tests.** Fix or delete tests that pass when the behavior breaks, or fail when only internals change.
4. **Docs last,** only for judgement calls nothing can check.

## Prove it

Show each new check failing on a real past mistake, then passing after the fix. Run the same command locally and in CI. An exception goes on the offending line with a reason, an expiry date and the user's approval.

## Record it

One lesson per class: `brain new lesson <project> <slug>`. Fill Mistake, Evidence (commits, sessions) and Prevention (the check, its command). Once the check exists and is proven, `brain enforce <lesson-id>`. A rule with no check behind it that is broken again is a repeat: fix it one level higher in the same change.

**Reply** with each class, its evidence, the level you chose, and why a higher level did not work. Do not apply fixes the user has not approved.
