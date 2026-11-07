# Commands

Every command works from anywhere inside a mapped repo or the vault. The vault is found from `$CANON_VAULT`, then the file `vault` in the config folder (`~/.config/canon/` on Linux and macOS, `%APPDATA%\canon\` on Windows), then the nearest `canon.config.json` above the current folder.

## Set up

| Command | What it does |
|---|---|
| `canon init [dir] [--no-git]` | Creates a vault: config, README, `.gitignore`, and a git repo on `main`. |
| `canon setup [vault-dir]` | Remembers where the vault is on this device. |
| `canon map <project> <repo-path> [--remote URL]` | Maps a repo on this device and saves its git remote in the shared config, so other devices find it by themselves. |
| `canon doctor` | Checks Node, git, the vault, mapped repos, the `Bash(canon:*)` permission and optional tools. Prints a fix for each problem. |
| `canon codegraph [project] [--setup [--yes]]` | Shows how codegraph is set up. `--setup` plans only the missing pieces; `--yes` applies them. |

## Write and track docs

| Command | What it does |
|---|---|
| `canon new <type> <project> <slug> [--title T] [--depends id,id] [--stack a,b]` | Creates a doc with the id, filename, frontmatter and section headings in place. Types are listed in [schema.md](schema.md). |
| `canon task <spec-id> <B#> <todo\|doing\|done> [--test path::name]` | Moves a behavior. `done` needs a test, and the test file must exist. |
| `canon anchor <spec-id> <path...>` | Records the code files a spec governs, with a hash of each. |
| `canon approve <id>` | Draft to active, only if the doc validates as active. Asks you to confirm every time. |
| `canon complete <id>` | Active to completed. A spec or phase needs every behavior done and no stale code. |
| `canon supersede <old-id> <new-id>` | Replaces a doc. The old one is kept for history and hidden from search. Asks you to confirm every time. |
| `canon enforce <lesson-id>` | Marks a lesson enforced once a check prevents the mistake. |
| `canon skip-docs` | Says the current code changes need no doc. Tied to the exact changes, so new ones ask again. |

## Check

| Command | What it does |
|---|---|
| `canon validate` | Checks every doc: frontmatter, ids, links, sections, behaviors, anchors. Exit 1 on findings. |
| `canon stale [--mark]` | Lists specs whose code changed. `--mark` sets `needs-review`. |
| `canon verify <spec-id>` | Confirms a spec matches the code, re-hashes the anchors and records the branch and commit. |
| `canon status [project]` | Behavior progress per spec. |
| `canon mutate [--base B] [--run]` | Picks the mutation tool for the repo, scoped to changed files. `--run` runs it and prints survivors only. |
| `canon check [--run] [--fast] [--base B]` | Quality checks on changed files. `--fast` skips slow tools. |

## Find

| Command | What it does |
|---|---|
| `canon query <text> [--project P] [--type T] [--status S] [--limit N]` | Full-text search with ranked, one-line results. |
| `canon query --governs <path>` | Specs that govern a code file. |
| `canon query --deps <id>` / `--dependents <id>` | What a doc builds on, and what builds on it. |
| `canon query --open [--project P]` | Unfinished behaviors. |
| `canon query --active <project> [--type T]` | One line per current doc. |
| `canon show <id> [--section S]` | Prints a doc or a single section. |
| `canon index` | Rebuilds the search index. Queries do this on their own when docs change. |

## Learn and sync

| Command | What it does |
|---|---|
| `canon digest <transcript.jsonl> [--project P]` | Summarizes a session. The session-end hook does this for you. |
| `canon retro [project] [--done]` | Reports on session digests since the last retro. `--done` marks them reviewed. |
| `canon usage [project]` | Tokens per week, costliest sessions, most used tools. |
| `canon sync [--pull-only]` | Commits vault changes, rebases on the remote, pushes. Stops on a conflict and keeps your commit. |
