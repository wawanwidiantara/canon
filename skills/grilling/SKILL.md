---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea, then record the decisions in the project brain. Use before writing a spec, when stress-testing a design, or on any 'grill' trigger phrase.
---

Interview the user until you reach a shared understanding. Map the plan as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled. Ask the frontier in one round, at most 5 questions. If more are ready, keep the rest for the next round. Number each question and give your recommended answer. Word each question so "yes" accepts your recommendation.

```
❓ **Q1** - **<title>**: <question, with options if useful>

➡️ <your recommended answer and the one-line reason>
```

Each answer reshapes the tree. Recompute the frontier and ask the next round. A question that depends on one still open belongs to a later round.

## Facts are your job

Never ask the user for something you can look up. Search the code yourself (use the code graph or grep, read only the files you need). There are no sub-agents here: one agent, small budget. If a fact is slow to get, ask the questions that do not depend on it first.

## Challenge, do not just collect

For each decision, ask what would make it wrong, what the simplest alternative is, and what it costs to reverse. Say so when the user's answer contradicts an earlier one or an existing ADR.

## Finish

The session is done when the frontier is empty and nothing is silently assumed. Summarize the decisions in one list and wait for the user to confirm.

After confirmation, record them. Do not record before.

1. Small or easily reversed decisions go in the spec's Implementation Decisions or Testing Decisions, in prose. No file paths, no code.
2. A decision that is costly to reverse, or that rejected a serious alternative, gets its own ADR: `brain new adr <project> <slug>`. Put the rejected options and why under Consequences.
3. If no spec exists yet, create it with `brain new spec <project> <slug>` and set it `draft` until the user approves it.
4. Run `brain validate` before reporting done.
