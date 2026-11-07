# Contributing

## Before you push

```bash
npm test     # Node's built-in test runner, no dependencies to install
claude plugin validate .
```

CI runs the tests on Linux, macOS and Windows with Node 22 and 24. A change that touches paths, spawning processes or line endings needs to pass on all three.

## How the code is organized

- `src/` holds the logic, one concern per file. `bin/canon.mjs` only parses arguments.
- `hooks/` holds thin wrappers around functions in `src/context.mjs`. Hooks must never break a session, so each one runs inside `guard()`.
- `skills/` holds the skills the plugin loads. A skill adapted from someone else's work keeps an "adapted from" comment and the original credit in the README.
- `src/schema.mjs` is the source of truth for doc types and sections. [docs/schema.md](docs/schema.md) explains it.

## Rules

- No runtime dependencies. Use the Node standard library.
- Write the test first. Tests that touch git use a temporary repo, never your own.
- A command that runs an external tool says in its output when its flags are unverified. Do not mark one verified unless you ran it.
- Keep skills short. Their descriptions load in every session, and their bodies cost tokens each time they run.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Write plainly. The `unslop` skill lists what to avoid.
