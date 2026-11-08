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

1. **Context.** `canon new context <project> project-brief --title "Project brief" --stack <stacks>`, where the stacks are the real ones (for example `laravel,vue`). Use the same `--stack` on every doc you create here, so the frontmatter agrees with the prose. Fill Summary from what the code and README show: what it is, who uses it, the stack, how to run and test it. State only what you verified; mark guesses as "unverified".
2. **Glossary.** Use the `domain-model` skill. List the 10 to 20 domain terms the code uses, one line each. Ask the user about any term whose meaning you cannot tell from the code.
3. **Data model.** `canon new data-model <project> schema`. Summarize tables, key fields and relations as they exist in migrations or models. No code, no file paths.
4. **Decisions that already exist.** Offer ADRs only for decisions that are hard to reverse and visible in the code (framework, database, auth scheme, queue). Ask the user for the reason; never invent one. Use `canon new adr <project> <slug> --title "<Proper title>"`, and anchor the files its claims rest on with `canon anchor <adr-id> <path...>` so `canon stale` notices when they change. State once, in the project brief, that the docs were recorded after the fact; do not repeat it in each ADR.
5. **First specs, for the riskiest areas only.** Ask which two or three areas change most or break most. For each: `canon new spec`, behaviors as short testable sentences describing what the system does today, then `canon anchor <spec-id> <files>` for the code that implements them. Mark a behavior done only if a real test proves it (`canon task ... done --test`); otherwise leave it todo, which becomes the test backlog.

## Rules

- **Search before you ask or write "unverified".** If the answer is in the repo (code, migrations, config, seeders, tests, routes, the git log), find it: use the code graph, grep, and follow a name from where it is read to where it is defined. Ask the user only for what the code cannot show: the reason for a decision, intent, business rules, or something outside the repo. Mark a claim "unverified" only after a real search failed, and say what you searched. When you resolve an item, delete its "unverified" line; never leave both.
- Describe what the code does, not what it should do. Disagreements between code and the user's memory go to the user as questions.
- Always pass `--title`; the default is the slug, which loses acronyms and capitals ("Ai openrouter driver"). Fill `depends_on` with the ids of docs it builds on (`--depends`), for example a data model depends on the glossary.
- Record facts, not where you read them. Do not mention the earlier reference docs you consulted, and keep plans, proposals and roadmap items out of ADRs; they belong in a phase or backlog doc.
- Keep each doc short. A thin accurate doc beats a long guess.
- After each step: `canon validate`, then `canon approve` only when the user agrees.
- Do not run mutation testing or quality checks here; that is for after the specs have tests.
- If the repo is large, stop after step 3 and say what is left. Do the specs the next time that area is touched, through the normal `flow`.

## Next

Pick the first change and start it in `flow`. Use `domain-model` if terms are still fuzzy.
