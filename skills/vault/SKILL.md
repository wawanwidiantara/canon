---
name: vault
description: How to create and update docs in the canon (specs, phases, ADRs, lessons). Use whenever you write, change or close out documentation for a mapped project.
---

Docs live in the central vault, not in the app repo. The session-start message names the project and vault when this repo is mapped.

## Find before you read

- `canon query <words>` searches all docs and returns ranked one-line hits with a snippet. Use it before opening files or searching the vault with grep.
- `canon query --governs <path>` lists specs that govern a code file. Run it before changing that file.
- `canon query --deps <id>` and `--dependents <id>` walk the links between docs.
- `canon query --open` lists unfinished behaviors. `canon query --active <project>` lists current docs.
- `canon show <id> --section <Name>` prints one section. Read a section, not the whole file, when that is enough.

## Rules

- Create docs only with `canon new <type> <project> <slug> --title "..." --stack a,b`. Always pass the title (the default is the slug) and the project's real stack, so frontmatter and prose agree. It sets the id, filename, frontmatter and section headings. Never hand-write frontmatter or rename files.
- Fill each section under its heading. The comment under each heading says what belongs there. Delete the comment once the section is filled.
- Specs and their sections `Goal`, `Implementation Decisions`, `Testing Decisions`, `Non-goals` are prose. No file paths and no code. Put governed files in anchors: `canon anchor <spec-id> <path...>`.
- Behaviors are one line each: `- [ ] B1: statement`. Mark progress with `canon task <spec-id> B1 doing|done --test path::name`. A behavior is done only when its test passes.
- Phases list spec behaviors as `- [[spec-id#B1]]`. Do not copy behavior text.
- A doc is `draft` until the user approves it, then `canon approve <id>` makes it `active` (the user is asked to confirm every time; never try to bypass it). Finish work with `canon complete <id>`. Replace a doc with `canon supersede <old> <new>`.

## When code changes

1. Update the spec first if behavior changed, then the code.
2. After the work, run `canon stale`. If a spec is stale, re-read it against the code, fix it, then `canon verify <spec-id>`.
3. Run `canon validate`. Fix every finding.
4. Changes that need no doc (typo, formatting): run `canon skip-docs` in the repo.

## Do not

- Do not ask the user a question the repo can answer, and do not write "unverified" before searching for it. Search the code first; ask only about reasons and intent.
- Do not archive or delete docs. Mark them `superseded` and set `superseded_by`.
- Do not write a new doc to describe what an existing spec already says. Edit the spec.

## Next

Return to `flow` and finish the step you were on.
