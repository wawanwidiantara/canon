# Brain schema

The source of truth is `brain/src/schema.mjs`. This page explains it.

## Layout

```
<vault>/
  brain.config.json            shared via git: schema_version, sync settings, projects -> { remote, checks, mutation, quicksilver }
  .brain/local.json            per device, not committed: projects -> { repo: /abs/path }
  00_global_standards/         type global-rule, project "global", bare id
  projects/<slug>/
    00_context/                context; discovery/ for type discovery
    01_architecture/           adr, data-model
    02_specs/                  spec
    03_phases/                 phase
    04_audits/                 audit
    05_lessons/                lesson
```

## Frontmatter

Required on every doc: `id`, `type`, `project`, `stack` (array), `status`, `depends_on` (array of `"[[id]]"`).

- `id` equals the filename. Project docs start with `<project>-`.
- Numbered types (discovery, adr, spec, phase, audit, lesson) get `<project>-<type>-<NNN>-<slug>`. Unnumbered types get `<project>-<slug>`.
- `status`: `draft`, `active`, `needs-review`, `superseded`, `completed`.
  - `needs-review` is set by `brain stale --mark` when anchored code changed. Re-confirm with `brain verify`.
  - `superseded` needs `superseded_by: <id>`.
- spec adds `anchors: ["path/in/repo@<12 hex>"]`.
- lesson adds `enforced: true|false`.

## Required sections (`## Heading`)

| type | sections |
|---|---|
| global-rule | Rule |
| discovery | Question, Findings, Sources |
| context, data-model | Summary |
| adr | Context, Decision, Consequences |
| spec | Goal, Behaviors, Non-goals |
| phase | Objective, Behaviors, Dependencies |
| audit | Scope, Findings |
| lesson | Mistake, Evidence, Prevention |

`brain new` writes each heading with an HTML comment saying what belongs there. Active docs may not leave a section empty.

## Behaviors

In a spec: `- [ ] B1: statement (test: tests/X.php::name)`. States: `[ ]` todo, `[~]` doing, `[x]` done. Done needs a test; `brain task` also checks the file exists when the project's repo is mapped.

In a phase: `- [[spec-id#B1]]`. The target spec and behavior must exist.

## Anchors and staleness

`brain anchor <spec> <path...>` stores a short sha256 of each governed file. `brain stale` compares those hashes to the repo. A mismatch or missing file means the spec may no longer be true. `brain stale --mark` sets `needs-review`; `brain verify <spec>` re-hashes after a human or the agent has confirmed the spec still matches.

This catches code that moved under a spec. It cannot catch prose that was already wrong, so specs still need an occasional read.

## Devices

The vault is its own git repo. `brain.config.json` is shared; repo paths are per device in `.brain/local.json`. A project's repo is identified by its normalized git remote (`github.com/owner/repo`; ssh host aliases are folded), so the same project is found on any device. Anchor hashes fold CRLF to LF, so a Windows and a Linux checkout agree.

## Not built yet

`brain query` and the SQLite index, the session digest and retro, more curated skills.
