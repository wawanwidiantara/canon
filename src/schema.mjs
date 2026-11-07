export const SCHEMA_VERSION = 1;

export const STATUS = ["draft", "active", "needs-review", "superseded", "completed"];

// sections: [heading, one-line purpose]. The purpose becomes the scaffold hint
// so the model fills each section the same way every time.
export const TYPES = {
  "global-rule": {
    dir: "00_global_standards",
    numbered: false,
    sections: [["Rule", "The rule, stated so it can be checked."]],
  },
  discovery: {
    dir: "00_context/discovery",
    numbered: true,
    sections: [
      ["Question", "What we are trying to learn, in one or two sentences."],
      ["Findings", "What the research found. Facts with sources, not opinions."],
      ["Sources", "Links or files each finding came from."],
    ],
  },
  context: {
    dir: "00_context",
    numbered: false,
    sections: [["Summary", "What this project or area is and the constraints that shape it."]],
  },
  adr: {
    dir: "01_architecture",
    numbered: true,
    sections: [
      ["Context", "The forces and constraints that made a decision necessary."],
      ["Decision", "What we decided, in one paragraph. Start with 'We will'."],
      ["Consequences", "What gets easier, what gets harder, what to revisit."],
    ],
  },
  "data-model": {
    dir: "01_architecture",
    numbered: false,
    sections: [["Summary", "Tables, fields and relations as they exist in production code."]],
  },
  spec: {
    dir: "02_specs",
    numbered: true,
    sections: [
      ["Goal", "What this feature does and why, in two or three sentences."],
      ["Behaviors", "One line per testable behavior: `- [ ] B1: statement (test: path::name)`."],
      ["Implementation Decisions", "Modules, interfaces, schema and API contracts decided. Prose only: no file paths, no code."],
      ["Testing Decisions", "Seams to test at (fewest, highest), what to test, what a good test is here, prior art by name."],
      ["Non-goals", "What this deliberately does not cover."],
    ],
  },
  phase: {
    dir: "03_phases",
    numbered: true,
    sections: [
      ["Objective", "What is true when this phase is done."],
      ["Behaviors", "One line per spec behavior this phase delivers: `- [[spec-id#B1]]`."],
      ["Dependencies", "Phases, ADRs or outside work that must land first. Write 'none' if none."],
    ],
  },
  audit: {
    dir: "04_audits",
    numbered: true,
    sections: [
      ["Scope", "What was examined and as of which commit."],
      ["Findings", "Each finding with file reference and severity."],
    ],
  },
  lesson: {
    dir: "05_lessons",
    numbered: true,
    sections: [
      ["Mistake", "What went wrong, in one or two sentences."],
      ["Evidence", "Session id, file or commit that shows it."],
      ["Prevention", "The lint, test or hook that stops it. Set 'enforced: true' once it exists."],
    ],
  },
};

// Sections of a spec where file paths and code are banned (they rot silently).
// Paths belong in frontmatter `anchors`, which `canon stale` checks.
export const NO_CODE_SECTIONS = ["Goal", "Implementation Decisions", "Testing Decisions", "Non-goals"];

export const TYPE_NAMES = Object.keys(TYPES);
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
