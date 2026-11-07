---
name: flow
description: The working flow for features, changes and fixes in a project mapped to canon: research, grill, spec, phase, tdd, mutation, check, close. Use when starting or resuming any non-trivial work in a mapped project.
---

Follow the steps in order. Scale to the size of the change, and stop at each marked gate for the user. The session-start message names the project; if it does not, this repo is not mapped and none of this applies.

## Size the work first

- **Trivial** (typo, config, formatting): edit, run `canon check --run`, then `canon skip-docs` if no doc needs to change. Stop.
- **Bug**: write the failing test first (`tdd`), fix, add the missing behavior to the existing spec with `canon query` to find it. Skip steps 1 to 4.
- **Feature or change**: all steps.

## Steps

1. **Orient.** `canon query <words>` and `canon query --governs <path>` before reading files. Reuse a spec or ADR that already covers this; edit it instead of writing a new one.
2. **Research** (only if the answer is not known). Use the `research` skill in its own session and keep the result as a discovery doc: `canon new discovery <project> <slug>`.
3. **Grill.** Run the `grilling` skill. **Gate:** the user confirms the decisions.
4. **Spec.** `canon new spec`, fill every section from the grill, `canon anchor` the code it governs. **Gate:** the user reads it, then run `canon approve <spec-id>`. Claude Code will ask the user to confirm; say what you are asking them to approve and do not try to work around the prompt.
5. **Phase.** For anything larger than one sitting, `canon new phase` listing the behaviors as `- [[spec-id#B1]]`, then `canon approve <phase-id>`. Keep phases small enough to finish in one or two sessions.
6. **Build.** For each behavior run the `tdd` skill: `canon task <spec> B1 doing`, red, green, `canon task <spec> B1 done --test path::name`. Keep the spec in step with the code as you go.
7. **Close the phase.**
   - `mutation-testing` on the changed files, then add the tests that matter.
   - `quality-check`, fix real findings.
   - `canon stale`; for each stale spec re-read it against the code, fix it, `canon verify <spec-id>`.
   - `canon complete <phase-id>` (it refuses if a behavior is open or a spec is stale), then `canon validate`.
8. **Learn.** If the user corrected you or a check caught something twice, tell them it is worth a `retro`. Do not run it unasked.

## Budget rules

- One step per session when it is long. Finish the step, write what you decided into the docs, and suggest `/clear`. The next session resumes from the session-start brief, not from this conversation.
- Read sections, not files: `canon show <id> --section <Name>`.
- Never re-derive a decision that is already in a spec or ADR. Quote its id.
- A change of direction replaces a doc: `canon supersede <old> <new>`. Never delete docs.
- If a gate is skipped by the user, note it in the spec and continue.
