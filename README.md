# software-factory

Personal agentic software-development setup for Claude Code on a small budget.

- `brain/` — CLI that creates, validates and tracks the central docs vault. Zero dependencies, Node 22.5+.
- `skills/` — curated skills the plugin loads (`grilling`, `brain-docs`).
- `hooks/` — Claude Code hooks: `SessionStart` brief, `PreCompact` notes, `Stop` gate (validate, stale, docs-with-code). Silent in repos not mapped in the vault.
- `docs/schema.md` — the vault schema.

```
npm test
node brain/bin/brain.mjs          # usage
```

Status: brain core and hooks work and are unit-tested (22 tests). The hooks have not been run inside a live Claude Code session yet. Index/query, retro digest and more curated skills are next.

Try it: `claude --plugin-dir .`, and set `BRAIN_VAULT` (or write the vault path to `~/.config/brain/vault`).

## Credits

This project stands on other people's work. Several skills are adapted from, and many ideas come directly from:

- **Matt Pocock**, [mattpocock/skills](https://github.com/mattpocock/skills) (MIT): grilling, spec and ticket flow, TDD, retro, and the rule that specs avoid file paths and code snippets.
- **Robert C. Martin (Uncle Bob)**, [unclebob/ub-mode](https://github.com/unclebob/ub-mode) (MIT): the reduced-principles coding mode.
- **Lauren Tan (poteto)**, [pstack](https://github.com/cursor/plugins/tree/main/pstack) in cursor/plugins (MIT): `correct`, `unslop`, and the approach of turning repeated mistakes into structural checks.

Where a skill here is adapted from one of these, its file says so, and the original license applies to the copied parts. Thank you.

## License

MIT, see `LICENSE`.
