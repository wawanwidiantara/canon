# Vault and multiple devices

Docs live in a **vault**: a private git repo of their own. It is never inside your app repos, and it must stay private, because it holds your project notes and, if you turn it on, session digests.

## Create it

```bash
brain init ~/brain-vault
cd ~/brain-vault
git remote add origin <your-private-repo>
git add -A && git commit -m "chore: init" && git push -u origin main
brain setup ~/brain-vault
brain map my-app ~/code/my-app
```

`brain map` saves the repo's git remote in the shared `brain.config.json`. The repo path stays in `.brain/local.json`, which is per device and not committed.

## Another device

1. Clone the vault and run `brain setup <path>`.
2. Clone your app repos and open them. A repo is recognized by its normalized git remote (`github.com/owner/repo`; ssh host aliases are folded), so there is no mapping step.
3. Run `brain doctor`.

A repo with no `origin` remote cannot be found this way; map it by hand on each device.

## What syncs

| State | Where | Sync |
|---|---|---|
| Docs, project settings | the vault repo | git |
| Repo paths on a device | `.brain/local.json` | none, per device |
| Search index | `.brain/index.sqlite` | none, rebuilt on each device |
| Session digests | `.brain/digests/` | per device, or in the vault if `sync.digests` is `true` |
| Hook markers | the OS temp folder | none |

## Getting changes

- **At session start** the vault is fast-forward pulled, at most every 10 minutes, with a short network limit. It never touches local edits and works offline. If it skips, the session brief says why.
- **`brain sync`** commits your vault changes, rebases on the remote and pushes. On a conflict it aborts the rebase and keeps your commit. Nothing is pushed automatically.
- Two devices that edit the same line need you to resolve the conflict with git. For an `anchors:` line, take either side and run `brain verify`.

Anchor hashes fold Windows line endings to Unix ones, so a Windows and a Linux checkout of the same file agree.

## Windows

The `Bash` tool in Claude Code needs Git for Windows. From PowerShell or cmd use `brain.cmd`. The device config lives in `%APPDATA%\brain\`.
