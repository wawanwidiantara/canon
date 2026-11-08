---
name: handoff
description: Write a short handoff note so a fresh session can continue the work. Use when switching sessions or before clearing a long conversation.
disable-model-invocation: true
---

<!-- Adapted from mattpocock/skills `handoff` (MIT, Matt Pocock). -->

The canon already holds specs, phases, decisions and progress, and the session-start message reloads them. The handoff holds only what those do not: the state of this conversation.

1. First put anything durable where it belongs: decisions into the spec or an ADR, behavior progress via `canon task`. Run `canon validate`.
2. Write the note to the OS temp directory (`$TMPDIR`, else `/tmp`; `%TEMP%` on Windows), not the workspace. Keep it under 30 lines.
3. Include: the goal of the next session; where you stopped (file, behavior id, failing test); what you tried that did not work; open questions for the user; the first command to run; the skills to call (for example `tdd`, `debug`).
4. Reference docs by id (`demo-spec-001-login`), never copy their content. Do not repeat what commits and diffs already show.
5. Redact secrets and personal data.
6. If the user passed arguments, treat them as the focus of the next session.

End by giving the user the path and suggesting `/clear`.

## Next

The next session resumes in `flow` from the session brief and this note.
