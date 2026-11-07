---
name: onboard
description: Bring an existing codebase into the canon: draft its context, glossary, data model and first anchored specs from the code. Use once per project that already has code but no docs in the vault.
disable-model-invocation: true
---

An existing repo has behavior but no specs, so the stale check and the flow have nothing to hold on to. This skill creates the first layer of docs from the code, in small steps, with the user confirming each one. Do not try to document everything.

## Before you start

- The repo must be mapped: `canon map <project> <repo-path>` (the session-start message names the project). Run `canon doctor` if unsure.
- `canon query --active <project>` to see what already exists. Fill gaps only.
- Prefer the code graph (`codegraph_explore`) over reading files. Read only what you need, a section at a time.

## Steps (one per sitting; stop and let the user review after each)

1. **Context.** `canon new context <project> project-brief`. Fill Summary from what the code and README show: what it is, who uses it, the stack, how to run and test it. State only what you verified; mark guesses as "unverified".
2. **Glossary.** Use the `domain-model` skill. List the 10 to 20 domain terms the code uses, one line each. Ask the user about any term whose meaning you cannot tell from the code.
3. **Data model.** `canon new data-model <project> schema`. Summarize tables, key fields and relations as they exist in migrations or models. No code, no file paths.
4. **Decisions that already exist.** Offer ADRs only for decisions that are hard to reverse and visible in the code (framework, database, auth scheme, queue). Ask the user for the reason; never invent one. Use `canon new adr` and say in Context that it was recorded after the fact.
5. **First specs, for the riskiest areas only.** Ask which two or three areas change most or break most. For each: `canon new spec`, behaviors as short testable sentences describing what the system does today, then `canon anchor <spec-id> <files>` for the code that implements them. Mark a behavior done only if a real test proves it (`canon task ... done --test`); otherwise leave it todo, which becomes the test backlog.

## Rules

- Describe what the code does, not what it should do. Disagreements between code and the user's memory go to the user as questions.
- Keep each doc short. A thin accurate doc beats a long guess.
- After each step: `canon validate`, then `canon approve` only when the user agrees.
- Do not run mutation testing or quality checks here; that is for after the specs have tests.
- If the repo is large, stop after step 3 and say what is left. Do the specs the next time that area is touched, through the normal `flow`.
