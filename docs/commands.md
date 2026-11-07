# Commands

Every command works from anywhere inside a mapped repo or the vault. The vault is found from `$BRAIN_VAULT`, then the file `vault` in the config folder (`~/.config/brain/` on Linux and macOS, `%APPDATA%\brain\` on Windows), then the nearest `brain.config.json` above the current folder.

## Set up

| Command | What it does |
|---|---|
| `brain init [dir] [--no-git]` | Creates a vault: config, README, `.gitignore`, and a git repo on `main`. |
| `brain setup [vault-dir]` | Remembers where the vault is on this device. |
| `brain map <project> <repo-path> [--remote URL]` | Maps a repo on this device and saves its git remote in the shared config, so other devices find it by themselves. |
| `brain doctor` | Checks Node, git, the vault, mapped repos, the `Bash(brain:*)` permission and optional tools. Prints a fix for each problem. |
| `brain codegraph [project] [--setup [--yes]]` | Shows how codegraph is set up. `--setup` plans only the missing pieces; `--yes` applies them. |

## Write and track docs

| Command | What it does |
|---|---|
| `brain new <type> <project> <slug> [--title T] [--depends id,id] [--stack a,b]` | Creates a doc with the id, filename, frontmatter and section headings in place. Types are listed in [schema.md](schema.md). |
| `brain task <spec-id> <B#> <todo\|doing\|done> [--test path::name]` | Moves a behavior. `done` needs a test, and the test file must exist. |
| `brain anchor <spec-id> <path...>` | Records the code files a spec governs, with a hash of each. |
| `brain approve <id>` | Draft to active, only if the doc validates as active. |
| `brain complete <id>` | Active to completed. A spec or phase needs every behavior done and no stale code. |
| `brain supersede <old-id> <new-id>` | Replaces a doc. The old one is kept for history and hidden from search. |
| `brain enforce <lesson-id>` | Marks a lesson enforced once a check prevents the mistake. |
| `brain skip-docs` | Says the current code changes need no doc. Tied to the exact changes, so new ones ask again. |

## Check

| Command | What it does |
|---|---|
| `brain validate` | Checks every doc: frontmatter, ids, links, sections, behaviors, anchors. Exit 1 on findings. |
| `brain stale [--mark]` | Lists specs whose code changed. `--mark` sets `needs-review`. |
| `brain verify <spec-id>` | Confirms a spec matches the code, re-hashes the anchors and records the branch and commit. |
| `brain status [project]` | Behavior progress per spec. |
| `brain mutate [--base B] [--run]` | Picks the mutation tool for the repo, scoped to changed files. `--run` runs it and prints survivors only. |
| `brain check [--run] [--fast] [--base B]` | Quality checks on changed files. `--fast` skips slow tools. |

## Find

| Command | What it does |
|---|---|
| `brain query <text> [--project P] [--type T] [--status S] [--limit N]` | Full-text search with ranked, one-line results. |
| `brain query --governs <path>` | Specs that govern a code file. |
| `brain query --deps <id>` / `--dependents <id>` | What a doc builds on, and what builds on it. |
| `brain query --open [--project P]` | Unfinished behaviors. |
| `brain query --active <project> [--type T]` | One line per current doc. |
| `brain show <id> [--section S]` | Prints a doc or a single section. |
| `brain index` | Rebuilds the search index. Queries do this on their own when docs change. |

## Learn and sync

| Command | What it does |
|---|---|
| `brain digest <transcript.jsonl> [--project P]` | Summarizes a session. The session-end hook does this for you. |
| `brain retro [project] [--done]` | Reports on session digests since the last retro. `--done` marks them reviewed. |
| `brain usage [project]` | Tokens per week, costliest sessions, most used tools. |
| `brain sync [--pull-only]` | Commits vault changes, rebases on the remote, pushes. Stops on a conflict and keeps your commit. |
