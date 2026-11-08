---
name: debug
description: Diagnosis loop for hard bugs and performance regressions. Use when something is broken, throwing, failing or slow, or the user says "debug" or "diagnose".
---

<!-- Adapted from mattpocock/skills `diagnosing-bugs` (MIT, Matt Pocock). -->

A bug is found by a fast pass/fail signal, not by reading code. Do the phases in order.

**Redact secrets** in every command and output you show: write `<REDACTED>`. Read credentials from the environment, never paste them.

## 1. Build the loop

Get one command that goes red on *this* bug. Try, roughly in order: a failing test at the seam that reaches the bug, an HTTP or CLI call with a fixture, a headless browser script, a replay of a captured request or log, a throwaway harness around one function, a fuzz loop for "sometimes wrong", `git bisect run` for "it used to work", an old-versus-new diff.

Done when the command (a) is one you already ran and showed, (b) asserts the user's exact symptom, (c) gives the same verdict each run, (d) takes seconds, (e) runs without a human. For flaky bugs, raise the reproduction rate until it is debuggable. If the session brief says Quicksilver is allowed in this project and the input is large (more than about 50 files or 2,000 log lines), triage it with `canon qs` instead of reading it all: `canon qs filter "Does this line indicate a failure?" app.log --lines`. Scrub secrets and personal data from the log first.

If you start building theories from reading code before this exists, stop. If you truly cannot build a loop, say what you tried and ask the user for access, a redacted artifact (log, HAR, dump) or permission to add temporary instrumentation. Do not guess.

## 2. Reproduce and shrink

Run it, see it fail the way the user described, not a nearby failure. Then cut inputs, config, data and steps one at a time, rerunning each time, until every remaining piece is needed for the failure.

## 3. Hypothesize

Write 3 to 5 ranked, falsifiable hypotheses: "If X is the cause, changing Y makes it vanish." Show the list to the user before testing; they often know one is ruled out. Do not block if they are away.

## 4. Instrument

One probe per prediction, one variable at a time. Prefer a debugger or REPL to logs; never "log everything and grep". Tag every debug line with a unique prefix such as `[DEBUG-a4f2]` so cleanup is one search. For slowness, measure a baseline first (timer, profiler, query plan), then bisect.

## 5. Fix and lock it in

Use the `tdd` skill: turn the shrunk repro into a failing test at a seam that really exercises the bug, watch it fail, fix, watch it pass, then rerun the original loop. If the only available seam is too shallow to catch the bug, say so: the architecture is blocking a regression test, and that is a finding for the user. If the behavior was missing from the spec, add it (`canon query` finds the spec).

## 6. Clean up

- The original loop no longer fails, and the regression test passes (or the missing seam is noted).
- All debug lines are removed (search for the prefix) and throwaway scripts are deleted.
- Say which hypothesis was right, in the commit message or summary, so the next person learns from it.
- If the same kind of bug has happened before, mention that `correct` could turn it into a check.

## Next

Add the regression test with `tdd`. If this kind of bug has happened before, run `correct`.
