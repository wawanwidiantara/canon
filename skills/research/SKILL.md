---
name: research
description: Investigate a question against primary sources and record the findings as a discovery doc. Use when a topic, API or best practice needs researching before a decision.
---

<!-- Adapted from mattpocock/skills `research` (MIT, Matt Pocock). -->

Research is the most expensive kind of session, so keep it in its own session and keep it narrow. Work in this session by default. If the session brief lists `canon:researcher`, you may hand the reading to it: give it the question and the decision it feeds, then record its answer in step 6. It returns a short sourced list, so the pages it read never enter this context.

1. **Check what exists.** `canon query <topic>`. Do not research what a spec, ADR or discovery doc already answers.
2. **State the question** in one or two sentences, and what decision it feeds.
3. **Use primary sources:** official docs, source code, specs, first-party APIs. Follow each claim back to the owner of the claim, not a blog that summarizes it. Fetch pages with a specific prompt, and read only the part that answers.
4. **Label confidence.** Mark each claim as verified in a primary source, from a secondary source, or from memory. Say so plainly when you cannot find something.
5. **Stop** when the question is answered well enough to decide. Do not survey for completeness.
6. **Record it:** `canon new discovery <project> <slug>`. Question, Findings (one claim per line with its confidence), Sources (URLs). Add no recommendations the findings do not support.
7. Tell the user the doc id and the decision it informs, and suggest the `grilling` skill next.
