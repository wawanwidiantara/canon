# The idea behind Canon

A *canon* is the body of work that counts as authoritative: what a community has agreed is true, kept apart from drafts and commentary. A project has one too. It is the set of decisions you made, the behavior you specified and the mistakes you decided never to repeat. Most of it lives in your head and in old chats. Claude Code forgets all of it between sessions, and a document nobody checks drifts from the code within weeks.

Canon keeps that record, keeps it true, and makes sure only what you accepted is in it.

## Seven rules

**1. One authority.** The vault is the canon. A discovery note, a research doc or a grilling log is input: it explains why, and loses to an ADR or spec that disagrees. Agents read active docs first.

**2. Canon is checked against reality.** An unchecked claim drifts. A spec records hashes of the code it governs, and `canon stale` compares them. When the code moves, the spec is flagged `needs-review` and `canon complete` refuses to close work that depends on it. A person or the agent re-reads it, fixes it and runs `canon verify`. This catches code that moved under a spec. It cannot catch prose that was already wrong, so specs still deserve an occasional read.

**3. Canon changes by amendment, not erasure.** A replaced decision is not deleted. `canon supersede` marks it, links its replacement and hides it from search while keeping it for history. There is no archive folder to forget about.

**4. A person ratifies it.** The agent asks questions, drafts specs and fills sections. A doc becomes canon only through `canon approve`, and that command asks you to confirm every time. A grilling session ends with you confirming the decisions. The gate is a hook, not a promise in a prompt. You can turn it off with `"ratify": "auto"` in `canon.config.json`, and then you own the consequences.

**5. A rule nothing enforces is not canon.** "Always write a test first" is a wish until something fails when you do not. A lesson from a retro is recorded with the check that now prevents the mistake, and `canon enforce` marks it only once that check exists. Prefer enforcement in this order: structure, types, a lint, a test, and a written rule last.

**6. Keep it small.** Context is the expensive part. Agents search with `canon query`, read one section with `canon show`, and see a short brief at session start, not the whole vault. Superseded docs and old notes stay as history and cost nothing to ignore.

**7. Scripts check, people judge.** Validating, hashing, linting, mutation testing, searching and syncing are scripts that print one line when they pass. The model's tokens go to research, design decisions and code, where judgment matters.

## What it is not

It is not a place to store everything the agent said, and it does not replace comments or commit messages. It does not make the agent right. It makes the agent's record of your decisions checkable, reviewable by you, and the same shape every time.

## Where the rules are enforced

| Rule | Mechanism |
|---|---|
| 1 | Doc types and statuses in the schema; `canon query` hides superseded docs |
| 2 | Anchors, `canon stale`, `canon verify`, the `Stop` hook, `canon complete` |
| 3 | `canon supersede`; the validator requires `superseded_by` |
| 4 | `PreToolUse` hook asks you before `canon approve` and `canon supersede` |
| 5 | `canon enforce`; the `correct` and `retro` skills |
| 6 | The search index, `canon show --section`, the session brief |
| 7 | The whole CLI |
