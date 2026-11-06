---
name: flow
description: The working flow for features, changes and fixes in a project mapped to the brain: research, grill, spec, phase, tdd, mutation, check, close. Use when starting or resuming any non-trivial work in a mapped project.
---

Follow the steps in order. Scale to the size of the change, and stop at each marked gate for the user. The session-start message names the project; if it does not, this repo is not mapped and none of this applies.

## Size the work first

- **Trivial** (typo, config, formatting): edit, run `brain check --run`, then `brain skip-docs` if no doc needs to change. Stop.
- **Bug**: write the failing test first (`tdd`), fix, add the missing behavior to the existing spec with `brain query` to find it. Skip steps 1 to 4.
- **Feature or change**: all steps.

## Steps

1. **Orient.** `brain query <words>` and `brain query --governs <path>` before reading files. Reuse a spec or ADR that already covers this; edit it instead of writing a new one.
2. **Research** (only if the answer is not known). Use the `research` skill in its own session and keep the result as a discovery doc: `brain new discovery <project> <slug>`.
3. **Grill.** Run the `grilling` skill. **Gate:** the user confirms the decisions.
4. **Spec.** `brain new spec`, fill every section from the grill, `brain anchor` the code it governs. **Gate:** the user reads it, then `brain approve <spec-id>`.
5. **Phase.** For anything larger than one sitting, `brain new phase` listing the behaviors as `- [[spec-id#B1]]`, then `brain approve <phase-id>`. Keep phases small enough to finish in one or two sessions.
6. **Build.** For each behavior run the `tdd` skill: `brain task <spec> B1 doing`, red, green, `brain task <spec> B1 done --test path::name`. Keep the spec in step with the code as you go.
7. **Close the phase.**
   - `mutation-testing` on the changed files, then add the tests that matter.
   - `quality-check`, fix real findings.
   - `brain stale`; for each stale spec re-read it against the code, fix it, `brain verify <spec-id>`.
   - `brain complete <phase-id>` (it refuses if a behavior is open or a spec is stale), then `brain validate`.
8. **Learn.** If the user corrected you or a check caught something twice, tell them it is worth a `retro`. Do not run it unasked.

## Budget rules

- One step per session when it is long. Finish the step, write what you decided into the docs, and suggest `/clear`. The next session resumes from the session-start brief, not from this conversation.
- Read sections, not files: `brain show <id> --section <Name>`.
- Never re-derive a decision that is already in a spec or ADR. Quote its id.
- A change of direction replaces a doc: `brain supersede <old> <new>`. Never delete docs.
- If a gate is skipped by the user, note it in the spec and continue.
