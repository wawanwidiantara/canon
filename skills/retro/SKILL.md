---
name: retro
description: Review recent coding sessions and propose fixes to the agent's environment so the same mistakes stop. Use at the end of a phase or when the user asks for a retrospective.
disable-model-invocation: true
---

<!-- Adapted from mattpocock/skills `retro` (MIT, Matt Pocock). -->

You are improving the agent's **environment** (checks, docs, skills, hooks), not the code. The aim is that no mistake happens twice.

## Get the evidence

Run `canon retro`. It reports every session digest since the last retro: tokens, your corrections, tool errors, files re-read, and oversized tool results. Do not read raw transcripts (`~/.claude/projects/*.jsonl`): they are huge and cost many tokens. Open one only to understand a single flagged item.

If there are no digests, say so and stop. Digests are written by the session-end hook for repos mapped in the vault.

## Find candidates

Go through the report and sort each item into one category:

- **Automated check.** The agent made a mistake a lint, type check, test or hook could catch. Read the repo's own check command and CI first; the finding may be a check that exists but is not wired in. A repo with no guardrail at all is itself a finding.
- **Navigation.** Many reads of the same file, or a long search for something. Add a pointer to the right doc or spec.
- **Coding standard.** A judgement call (consistency, matching surrounding style) that no tool can check.
- **Steering file size.** An instruction file that is large, or holds rules a check could enforce.
- **Tool economy.** Oversized tool results, repeated expensive calls, or a heavy skill or MCP that rarely pays off.
- **Information access.** The agent lacked a fact it needed (logs, a third-party doc).
- **Process.** A skill or step that caused the problem or was skipped.

A correction by the user is the strongest signal: it is a mistake that got past every check.

## Route each fix, cheapest and most reliable first

1. **Structure.** Make the mistake impossible by design.
2. **A deterministic check.** Type, lint rule whose message names the fix, test, or hook. Mechanical mistakes always get this, never a written rule.
3. **A `lesson` doc** for judgement calls: `canon new lesson <project> <slug>`. Fill Mistake, Evidence (session id), Prevention. Set `enforced: true` once a check exists.
4. **A skill edit** when a skill caused or allowed it.
5. **A short note in docs** only as the last resort.

## Present, then act

Show the candidates in order of severity, each with: evidence, proposed fix, where it goes, and its token cost or saving if known. Apply nothing until the user approves each item. After applying, run `canon validate`, then `canon retro --done`.

Keep the list short. Apply the few fixes that will hold, not every idea.

## Next

Hand any code-shaped finding to `correct`. Everything else lands in skills, hooks or docs; ship it through `flow`.
