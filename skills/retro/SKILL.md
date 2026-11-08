---
name: retro
description: Review recent coding sessions and the repo's own history, and propose fixes so the same mistakes stop. Use at the end of a phase, after the user corrects you again, or when the user asks for a retrospective.
disable-model-invocation: true
---

<!-- Adapted from mattpocock/skills `retro` (MIT, Matt Pocock) and pstack correct (MIT, Lauren Tan). -->

The user keeps correcting agents for the same mistakes. Change the environment (code structure, checks, docs, skills, hooks) so the next agent cannot make them. Assume every contributor sees only the files it opened, copies the nearest example, and takes the shortest path that compiles.

## Get the evidence

Use both sources. Either alone is enough when it is all you have.

- **Session digests.** Run `canon retro`. It reports every session digest since the last retro: tokens, your corrections, tool errors, files re-read, and oversized tool results. Do not read raw transcripts (`~/.claude/projects/*.jsonl`): they are huge and cost many tokens. Open one only to understand a single flagged item. Digests are written by the session-end hook for repos mapped in the vault.
- **The repo's history.** Recent commits, reverts, review comments, instruction files, and comments that explain a workaround. This finds mistakes that reached the code, which a digest can miss.

If both are empty, say so and stop.

## Find the classes

Sort each item into one category, and group repeats into classes. A class counts once it has happened twice.

- **Automated check.** The agent made a mistake a lint, type check, test or hook could catch. Read the repo's own check command and CI first; the finding may be a check that exists but is not wired in. A repo with no guardrail at all is itself a finding.
- **Navigation.** Many reads of the same file, or a long search for something. Add a pointer to the right doc or spec.
- **Coding standard.** A judgement call (consistency, matching surrounding style) that no tool can check.
- **Steering file size.** An instruction file that is large, or holds rules a check could enforce.
- **Tool economy.** Oversized tool results, repeated expensive calls, or a heavy skill or MCP that rarely pays off.
- **Information access.** The agent lacked a fact it needed (logs, a third-party doc).
- **Process.** A skill or step that caused the problem or was skipped.

A correction by the user is the strongest signal: it is a mistake that got past every check.

## Route each fix, highest level first

1. **Structure.** Make the mistake impossible by design: one owner per piece of state, one supported way per task, internals hidden so the wrong import fails, hand-synced lists replaced by one source, old paths an agent would copy deleted.
2. **A deterministic check.** A type that makes the bad state unwritable, or a lint, test or hook whose error names the file or function to use instead. If the pattern is already common, fail only when a change adds more. Mechanical mistakes always get this, never a written rule. Fix or delete tests that pass when the behavior breaks.
3. **A `lesson` doc** for judgement calls: `canon new lesson <project> <slug>`. Fill Mistake, Evidence (session id or commit), Prevention. Set `enforced` with `canon enforce <lesson-id>` only once a check exists and is proven.
4. **A skill edit** when a skill caused or allowed it.
5. **A short note in docs** only as the last resort, for judgement calls nothing can check.

A rule with no check behind it that is broken again is a repeat: fix it one level higher in the same change.

## Prove it

Show each new check failing on a real past mistake, then passing after the fix. Run the same command locally and in CI. An exception goes on the offending line with a reason, an expiry date and the user's approval.

## Present, then act

Show the candidates in order of severity, each with: evidence, proposed fix, the level you chose and why a higher level did not work, where it goes, and its token cost or saving if known. Apply nothing until the user approves each item. After applying, run `canon validate`, then `canon retro --done`.

Keep the list short. Apply the few fixes that will hold, not every idea.

## Next

Ship each approved fix through `flow`. A code-shaped fix is a normal change to the repo and needs its own test.
