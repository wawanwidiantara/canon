# Security

Please report a vulnerability privately through GitHub: **Security**, then **Report a vulnerability** on this repository. Do not open a public issue. I aim to reply within a week.

## What this tool does on your machine

- The hooks run `node` scripts from this plugin at session start, before compaction, on `Bash` and subagent tool calls, at the end of a turn and at session end. They act only in repos you mapped in your vault.
- `canon` reads and writes your vault and runs `git` in it and in mapped repos. `canon sync` pushes only when you run it.
- `canon mutate` and `canon check` run tools you have installed (test runners, linters) in your repo. They run what your repo already configures.
- Session digests are written to the vault. Text that looks like a secret (private keys, common API tokens, bearer tokens, passwords in URLs and `key=value` pairs) is replaced before saving. The scrubber is pattern-based and will miss unusual secrets, so keep the vault private.
- A `PreToolUse` hook asks you to confirm `canon approve` and `canon supersede`, so the agent cannot make a doc canon on its own. It matches the command by name, so it does not stop someone editing the files directly.
- A `PreToolUse` hook blocks the plugin's `canon:reviewer` and `canon:researcher` subagents unless `agents.<name>` is true in `canon.config.json`, because they spend extra tokens.
- A `PreToolUse` hook blocks Quicksilver (`qs`) in mapped projects unless you allow it. The block is enforced by the hook, not by the model, but it only matches the `qs` command by name.

## Out of scope

Vulnerabilities in Claude Code, git, Node or the optional third-party tools belong to those projects.

## Phase ownership guard

Inside a worktree claimed with `canon claim`, a PreToolUse hook denies Edit, Write, MultiEdit and NotebookEdit outside the phase's `owns` paths, and denies edits that reach the main checkout from the worktree. It cannot see shell writes (`sed -i`, redirects). `canon check-owns` is the backstop: it lists every changed file outside the owned paths from git, whatever made the change. A person working in the main checkout is never blocked.
