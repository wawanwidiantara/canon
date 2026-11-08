---
name: untangle
description: Audit one area of a codebase for pieces that should change together but do not, and pieces tied together that should not be, then record the problems and their fixes as an audit doc. Read-only. Use before a refactor, or when changes keep landing in several places.
disable-model-invocation: true
argument-hint: "<area or concern, for example checkout or the dialogs>"
---

<!-- Adapted from caldoai/skills `untangle-codebase` (MIT, Caldo). This version only audits: it lists problems and fixes, and changes no code. -->

Find the structural problems in one area, then group them under the few fixes that remove them. Change nothing. Each fix later goes through the `flow` skill, so specs, tests and mutation testing still guard it.

Work on the area the user named. If none was named, ask for one. Do not audit the whole repo in one session.

## 1. Orient

- `canon query --governs <path>` and `canon query <area>` for the specs and ADRs that already cover this area. A decision recorded there is not a problem.
- Use the code graph (`codegraph_explore`) and `git log --stat` to see what imports what and what changes together. Frequent co-change in git is evidence of a hidden link.
- Read only the files you need. If the session brief says Quicksilver is allowed in this project and the input is large (more than about 50 files or 2,000 log lines), triage it with `canon qs` instead of reading it all: `canon qs filter "Does this file handle <area>?" <dir>`. Read the files it keeps.

## 2. List every problem

Ask one question of each piece: should these change together? There are three ways to get it wrong.

**Hidden links.** Pieces that must change together, where nothing shows it.

- Copies of logic or values. Change one and the others must change, but nothing says so.
- A module that reads a global or file set by another module.
- One feature split across folders by layer, so one change needs all of them.
- A call order or convention that callers have to know.

**Needless links.** Pieces tied together that change for different reasons.

- Callers that depend on internals.
- Stable code that imports something more volatile.
- A general function with a parameter that only one workflow understands.
- A shallow module, whose interface changes whenever its internals do.

**Surplus.** Pieces with no reason of their own to change.

- Wrappers that only pass calls through.
- Extension points and config for things that never vary.
- Dead code. Confirm it is unused, including dynamic use and framework conventions, before listing it.

Also list every **special case**: code that exists for one situation and does not follow from how the system works. Examples are an `if` for one value, a parameter for one caller, a swallowed exception, a retry or sleep, and a disabled test. Each one is a requirement the design missed.

Write each problem as one line with `path:line` and what is wrong. Before it goes in the audit, check it against the code that reads or writes the thing: confirm the count of copies, and confirm the convention is not just how the parser or the framework works. Drop what does not hold. Do not change anything yet.

## 3. Group under fixes

Work out the fixes as if the system had known today's requirements from the start. Look for the one fix behind several problems, which often looks nothing like them. Do not fix special cases one at a time.

Judge every fix by the same rule: pieces that change together end up together, pieces that do not are not tied, and everything depends on what changes less.

Write each fix with the problems it solves listed under it:

```md
- Make every user action a command with a name, a handler and an undo, so the toolbar, menu and palette run from one list.
  - `ui/Toolbar.tsx:40` and `ui/Menu.tsx:22` each check separately when an action is disabled.
  - `ui/CommandPalette.tsx:55` keeps its own list of actions and is missing the newer ones.
```

## 4. Record it

`canon new audit <project> untangle-<area>`. Put the area, the evidence you used and what you left out under Scope. Put the fixes with their problems under Findings, most valuable first. Then `canon validate`.

**Reply** with the fixes in order, each with the number of problems it removes and the specs it would make stale (`canon query --governs <path>`). Suggest which fix to take first through `flow`. Do not start any fix the user has not chosen.

## Next

Take the chosen fix through `flow`. Do not fix it outside the flow.
