---
name: brain-docs
description: How to create and update docs in the project brain (specs, phases, ADRs, lessons). Use whenever you write, change or close out documentation for a mapped project.
---

Docs live in the central vault, not in the app repo. The session-start message names the project and vault when this repo is mapped.

## Rules

- Create docs only with `brain new <type> <project> <slug>`. It sets the id, filename, frontmatter and section headings. Never hand-write frontmatter or rename files.
- Fill each section under its heading. The comment under each heading says what belongs there. Delete the comment once the section is filled.
- Specs and their sections `Goal`, `Implementation Decisions`, `Testing Decisions`, `Non-goals` are prose. No file paths and no code. Put governed files in anchors: `brain anchor <spec-id> <path...>`.
- Behaviors are one line each: `- [ ] B1: statement`. Mark progress with `brain task <spec-id> B1 doing|done --test path::name`. A behavior is done only when its test passes.
- Phases list spec behaviors as `- [[spec-id#B1]]`. Do not copy behavior text.
- A doc is `draft` until the user approves it, then `active`.

## When code changes

1. Update the spec first if behavior changed, then the code.
2. After the work, run `brain stale`. If a spec is stale, re-read it against the code, fix it, then `brain verify <spec-id>`.
3. Run `brain validate`. Fix every finding.
4. Changes that need no doc (typo, formatting): run `brain skip-docs` in the repo.

## Do not

- Do not archive or delete docs. Mark them `superseded` and set `superseded_by`.
- Do not write a new doc to describe what an existing spec already says. Edit the spec.
