---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea, one fixed procedure every time, then record the decisions in the canon. Use before writing a spec, when stress-testing a design, or on any 'grill' trigger phrase.
---

<!-- Adapted from mattpocock/skills `grilling` (MIT, Matt Pocock). -->

Interview the user until you share an understanding. Follow this procedure exactly, every session, so the experience is the same each time.

## 1. Prepare (no questions yet)

- Look up facts yourself: the spec, ADRs, the code (code graph or grep, only the files you need). Never ask the user for something you can find. Grilling never uses sub-agents: the user is the other half of the conversation.
- In a mapped project, open the grill log: `canon new discovery <project> grill-<topic>`. Its Findings section is the decision ledger, so decisions survive compaction and new sessions. If a grill log for this topic exists, read it and continue from it.
- Print the design tree once: a short indented list of the decisions to settle, grouped by dependency. Mark nothing as decided yet.

## 2. Ask in rounds

The **frontier** is every decision whose prerequisites are settled. Each round asks the frontier, at most 4 questions, using the `AskUserQuestion` tool. If it is not available, print the same content as numbered text.

Every question follows these rules:

- Multiple choice with 2 to 4 options. The **recommended option is always first**, its label ends with "(Recommended)", and its description gives the reason in one sentence. Other options say what they trade away.
- `header` is a short topic word. The question ends with a question mark and states the stake: what breaks if this is wrong, and how costly it is to reverse.
- A choice that needs free text (a name, a number) is asked in plain text with your recommended value.
- Never ask a question whose answer depends on one still open in the same round. It waits for the next round.
- Say each choice in terms of what the user sees or does: a command, a result, a file they open. Do not use function, variable or file names unless the user used them first.

## 3. Act on the answer

- **User picks an option:** record it in the ledger as settled. Recompute the frontier.
- **User picks "Other" or types something new:** treat it as new information. Say in one line what changes in the tree, mark affected decisions open again, and challenge the answer once if it contradicts an earlier decision or an ADR.
- **User says to accept all recommendations:** take the recommended option for every open question except the irreversible or expensive-to-reverse ones. Ask those still.
- **User says skip or you do not know:** record "deferred" with an owner and move on. Do not block the tree.

After each round, append the new decisions to the ledger and print the ledger in this exact form, then ask the next round:

```
Decided  D1 <decision> · D2 <decision>
Open     D3 <question> · D4 <question>
```

## 4. Challenge

For each decision ask: what would make it wrong, what is the simplest alternative, what does it cost to reverse. Raise a conflict when an answer contradicts another answer or an existing ADR. Challenge once, then respect the user's call.

## 5. Finish

Done when the frontier is empty and nothing is silently assumed. Print the full ledger and wait for the user to confirm. Record nothing before that.

After confirmation:

1. Small or reversible decisions go in the spec's Implementation Decisions or Testing Decisions, in prose, with no file paths or code.
2. Costly or hard-to-reverse decisions, and any that rejected a serious alternative, get an ADR: `canon new adr <project> <slug>`. Rejected options and the reason go under Consequences.
3. No spec yet: `canon new spec <project> <slug>`; it stays `draft` until the user approves it (`canon approve <id>`).
4. Close the grill log: `canon approve <grill-log-id>`, then `canon complete <grill-log-id>`. New ADRs stay `draft` until the user approves them with `canon approve`.
5. Run `canon validate` and report what was written.

## Next

Write the spec in `flow` (step 4). Record the costly decisions as ADRs first.
