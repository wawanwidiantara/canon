---
name: domain-model
description: Build and sharpen a project's domain language and record hard-to-reverse decisions. Use when terms are fuzzy or overloaded, when the user's words conflict with the code, or when deciding whether something deserves an ADR.
---

<!-- Adapted from mattpocock/skills `domain-modeling` (MIT, Matt Pocock). -->

Keep the project's words precise, and write them down the moment they are settled.

## Glossary

The glossary is one `context` doc per project: find it with `canon query glossary --project <p>`, or create it with `canon new context <project> glossary` when the first term is settled. One line per term in its Summary section:

`- **Term**: what it means in one sentence. _Avoid_: synonyms we do not use.`

It holds language only: no implementation details, decisions or specs.

## During a session

- **Challenge conflicts.** If the user's term disagrees with the glossary, say so: "The glossary says X, you seem to mean Y."
- **Sharpen vague words.** "Account" could be the customer or the user. Propose one canonical term.
- **Test with scenarios.** Invent edge cases that force the boundary between two concepts to be exact.
- **Check the code.** If the user states how something works, verify it. Surface contradictions: "The code cancels whole orders, you just described partial cancellation."
- **Update inline.** Edit the glossary when a term resolves, not in a batch later.

## ADRs, sparingly

Offer an ADR only when all three hold: it is hard to reverse, a future reader will wonder why, and there was a real trade-off. Otherwise a sentence in the spec's Implementation Decisions is enough. Create it with `canon new adr <project> <slug>` and list the rejected options under Consequences.
