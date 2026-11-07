// canon land: bring a claimed phase's branch into the main checkout, or stop
// with the exact reason. Every step is a script. No agent judges "good enough":
// the work lands only if the owned-path check, the repo's full gate and the
// phase's completion check all pass, and it merges onto the main it was tested on.
import { execFileSync } from "node:child_process";
import { describeProblems, repoFor } from "./anchors.mjs";
import { formatGate, loadGate, runGate, runRegen } from "./gates.mjs";
import { completionProblems, complete, findStale, verifySpec } from "./ops.mjs";
import { loadClaims, owned, release } from "./packets.mjs";
import { canonical, isWithin } from "./platform.mjs";
import { findDoc, loadConfig, lockVault } from "./vault.mjs";

function git(dir, args, { allowFail = false } = {}) {
  try {
    return { ok: true, out: execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    if (!allowFail) throw new Error(`git ${args.join(" ")} failed:\n${String(e.stderr ?? e.message).trim()}`);
    return { ok: false, out: String(e.stdout ?? "").trim(), err: String(e.stderr ?? e.message).trim() };
  }
}

// Returns the list of steps taken. Throws, leaving main untouched, at the first problem.
export function land(vault, phaseId, { merge = true } = {}) {
  const claim0 = loadClaims(vault)[phaseId];
  if (!claim0) throw new Error(`${phaseId} is not claimed; run \`canon claim ${phaseId}\``);
  // One land at a time per project, so two branches never race for the same main.
  return lockVault(vault, `land-${claim0.project}`, () => landLocked(vault, phaseId, merge), { waitMs: 600000, staleMs: 1800000 });
}

function landLocked(vault, phaseId, merge) {
  const c = loadClaims(vault)[phaseId];
  if (!c) throw new Error(`${phaseId} is not claimed`);
  if (!c.worktree) throw new Error(`${phaseId} was claimed without a worktree; there is no branch to land`);
  const log = [];
  const step = (s) => log.push(s);
  const wt = c.worktree;
  if (isWithin(wt, canonical(process.cwd()))) throw new Error(`run \`canon land\` from the main checkout, not from inside ${wt}`);
  const main = canonical(repoFor(loadConfig(vault), c.project, "/"));

  if (git(wt, ["status", "--porcelain"]).out) throw new Error(`the worktree ${wt} has uncommitted changes; commit them first`);
  if (git(main, ["status", "--porcelain"]).out) throw new Error(`the main checkout ${main} has uncommitted changes; land onto a clean main`);
  if (Number(git(wt, ["rev-list", "--count", `${c.base_sha}..HEAD`]).out) === 0) throw new Error(`${c.branch} has no commits since the claim; nothing to land`);

  const outside = git(wt, ["diff", "--name-only", `${c.base_sha}..HEAD`]).out.split("\n").filter(Boolean).filter((n) => !owned(c.owns, n));
  if (outside.length) throw new Error(`changed outside the owned paths (${c.owns.join(", ")}):\n${outside.map((n) => `- ${n}`).join("\n")}`);
  step(`owned paths ok (${c.owns.join(", ")})`);

  const open = completionProblems(vault, phaseId);
  if (open.length) throw new Error(`the phase is not done yet:\n${open.map((p) => `- ${p}`).join("\n")}`);
  step("every behavior of the phase is done");

  const tip = git(main, ["rev-parse", "HEAD"]).out;
  const re = git(wt, ["rebase", tip], { allowFail: true });
  if (!re.ok) {
    const files = git(wt, ["diff", "--name-only", "--diff-filter=U"], { allowFail: true }).out.split("\n").filter(Boolean);
    git(wt, ["rebase", "--abort"], { allowFail: true });
    throw new Error(`rebase onto ${tip.slice(0, 8)} conflicts${files.length ? ` in:\n${files.map((f) => `- ${f}`).join("\n")}` : ""}\nResolve it in ${wt} (git rebase ${tip.slice(0, 8)}), commit, then run \`canon land ${phaseId}\` again.`);
  }
  step(`rebased onto main ${tip.slice(0, 8)}`);

  const gate = loadGate(wt);
  if (gate?.regen.length) {
    runRegen(wt);
    if (git(wt, ["status", "--porcelain"]).out) {
      git(wt, ["add", "-A"]);
      git(wt, ["commit", "-q", "-m", "chore: regenerate generated files"]);
      step(`regenerated files and committed (${gate.regen.map((r) => r.name).join(", ")})`);
    } else step("regen produced no changes");
  }
  if (gate) {
    const results = runGate(wt, "full");
    if (results.some((r) => !r.ok)) throw new Error(`the full gate failed on the rebased branch:\n${formatGate("full", results)}`);
    step("full gate passed");
  } else step("WARNING: no canon.gate.json, so nothing but the owned-path and completion checks stood between this branch and main");

  if (git(main, ["rev-parse", "HEAD"]).out !== tip) throw new Error("main moved while the gate ran; run `canon land` again so the gate tests the code that will merge");
  if (!merge) return [...log, "stopped before merging (--no-merge); the branch is ready"];

  const m = git(main, ["merge", "--no-ff", "-q", "-m", `chore: land phase ${phaseId}`, c.branch], { allowFail: true });
  if (!m.ok) {
    git(main, ["merge", "--abort"], { allowFail: true });
    throw new Error(`merge failed after a clean rebase, main left untouched:\n${m.err}`);
  }
  step(`merged ${c.branch} into main`);

  // Specs this phase delivered now describe code that changed on purpose. Re-hash them when
  // every changed anchor sits inside the phase's owned paths; anything else stays stale.
  const doc = findDoc(vault, phaseId);
  const specIds = new Set([...(doc?.body ?? "").matchAll(/\[\[([^\]#]+)#B\d+\]\]/g)].map((x) => x[1]));
  for (const s of findStale(vault).filter((x) => specIds.has(x.id))) {
    if (s.problems.every((p) => p.kind === "changed" && owned(c.owns, p.anchor.slice(0, p.anchor.lastIndexOf("@"))))) {
      verifySpec(vault, s.id);
      step(`re-verified ${s.id} (its changed anchors are inside the phase)`);
    } else step(`${s.id} is still stale: ${describeProblems(s.problems)}`);
  }

  try {
    complete(vault, phaseId);
    step(`completed ${phaseId}`);
  } catch (e) {
    step(`not completed: ${e.message.split("\n").slice(1).join(" ").trim() || e.message}`);
  }
  release(vault, phaseId, { removeWorktree: true });
  git(main, ["branch", "-d", c.branch], { allowFail: true });
  step("released the claim and removed the worktree and branch");
  return log;
}
