# Changelog

## 0.1.4 (unreleased)

First public version, named Canon.

- `canon` CLI: vault, specs with behaviors and anchors, stale check, lifecycle commands, search, mutation and quality helpers, retro digests, multi-device sync, `doctor` and `usage`.
- A ratification gate: `canon approve` and `canon supersede` ask the user to confirm every time (`"ratify": "auto"` turns it off).
- Opt-in subagents `canon:reviewer` and `canon:researcher`, blocked by a hook until `agents.<name>` is true in `canon.config.json`.
- Hooks for session start, compaction, the end of a turn, Bash calls and session end.
- Skills: `flow`, `grilling`, `tdd`, `mutation-testing`, `quality-check`, `debug`, `retro`, `correct`, `research`, `domain-model`, `onboard`, `vault`, `handoff`, `ub-mode`, `unslop`, `untangle`.
