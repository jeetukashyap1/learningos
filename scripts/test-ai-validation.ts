/**
 * Unit tests for the AI curriculum validator (spec parts 6/18): every invalid
 * model output must be rejected with a reason, and every valid output must be
 * normalized so it can be persisted as-is. The contract under test is the
 * module/outcome shape: lessons arrive grouped inside ordered modules, the
 * path ends with a domain-appropriate final outcome, and the old flat
 * lessons-only contract is rejected outright.
 *
 * Run: npx tsx scripts/test-ai-validation.ts
 * (tsx resolves the @/* tsconfig paths; no credentials or network needed.)
 */

import { validateCurriculum } from "../lib/ai/validate";
import { CURRICULUM_LIMITS, type OnboardingProfile } from "../lib/ai/curriculum";

let passed = 0;
let failed = 0;

function check(name: string, pass: boolean, detail = "") {
  if (pass) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Shape of the fixture once fully typed, so mutations stay type-checked. */
type DraftLesson = {
  order: number;
  title: string;
  description: string;
  topic: string;
  skill: string;
  level: string;
  estimated_minutes: unknown;
  prerequisites: unknown;
  search_queries: unknown;
  objective: string;
  concepts: unknown;
  practical_outcome: string;
  practice_concept: string;
  goal_relevance: string;
};

type DraftModule = {
  order: number;
  title: string;
  description: string;
  objective: string;
  estimated_minutes: unknown;
  lessons: DraftLesson[];
};

type DraftOutcome = {
  kind: string;
  title: string;
  description: string;
  objective: string;
  requirements: unknown;
  milestones: unknown;
  expected_result: string;
  estimated_minutes: unknown;
};

type Draft = {
  title: string;
  description: string;
  goal: string;
  estimated_days: number;
  domain: string;
  subject: string;
  modules: DraftModule[];
  final_outcome: DraftOutcome;
};

/** A fully valid programming curriculum as the model is instructed to return it. */
function validCurriculum(): Draft {
  return {
    title: "Web Development Foundations",
    description: "A focused route from basics to building real sites.",
    goal: "Become a confident frontend developer",
    estimated_days: 30,
    domain: "programming",
    subject: "Web development",
    modules: [
      {
        order: 1,
        title: "Web Foundations",
        description: "The structure and styling every page needs.",
        objective: "Write a clean, well-structured page and style it with modern CSS.",
        estimated_minutes: 55,
        lessons: [
          {
            order: 1,
            title: "HTML structure",
            description: "Semantic elements and document outline.",
            topic: "Web development",
            skill: "HTML",
            level: "beginner",
            estimated_minutes: 25,
            prerequisites: [],
            search_queries: ["html semantic elements tutorial", "html document structure basics"],
            objective: "Build a semantic page outline from scratch.",
            concepts: ["semantic elements", "document structure"],
            practical_outcome: "A personal profile page structured with semantic HTML.",
            practice_concept: "Rewrite a div-soup page using semantic elements.",
            goal_relevance: "Every real site starts with sound HTML structure.",
          },
          {
            order: 2,
            title: "CSS layout",
            description: "Flexbox and grid for real layouts.",
            topic: "Web development",
            skill: "CSS",
            level: "beginner",
            estimated_minutes: 30,
            prerequisites: ["HTML structure"],
            search_queries: ["css flexbox layout tutorial"],
            objective: "Compose responsive layouts with flexbox and grid.",
            concepts: ["flexbox", "grid", "box model"],
            practical_outcome: "A two-column layout that adapts to small screens.",
            practice_concept: "Rebuild a magazine layout with CSS grid.",
            goal_relevance: "Layout skills separate developers from template users.",
          },
        ],
      },
      {
        order: 2,
        title: "Making Pages Interactive",
        description: "JavaScript and the DOM for real behavior.",
        objective: "Read, select, and update page content with JavaScript.",
        estimated_minutes: 75,
        lessons: [
          {
            order: 3,
            title: "JavaScript basics",
            description: "Variables, functions, and control flow.",
            topic: "Web development",
            skill: "JavaScript",
            level: "beginner",
            estimated_minutes: 40,
            prerequisites: ["HTML structure"],
            search_queries: ["javascript fundamentals for beginners"],
            objective: "Write small programs with variables, functions, and loops.",
            concepts: ["variables", "functions", "control flow"],
            practical_outcome: "A script that processes a list of items end to end.",
            practice_concept: "Refactor a repetitive script into functions.",
            goal_relevance: "JavaScript powers every interaction you will ship.",
          },
          {
            order: 4,
            title: "DOM manipulation",
            description: "Selecting and updating page content.",
            topic: "Web development",
            skill: "JavaScript",
            level: "intermediate",
            estimated_minutes: 35,
            prerequisites: ["JavaScript basics"],
            search_queries: ["javascript dom manipulation tutorial"],
            objective: "Select elements and respond to user events.",
            concepts: ["selectors", "events", "DOM updates"],
            practical_outcome: "An interactive checklist that remembers its state.",
            practice_concept: "Add toggle and filter behavior to a static list.",
            goal_relevance: "DOM skills turn static pages into applications.",
          },
        ],
      },
    ],
    final_outcome: {
      kind: "project",
      title: "Interactive personal website",
      description: "A multi-section personal website built from scratch.",
      objective: "Prove you can structure, style, and script a real site alone.",
      requirements: [
        "Ship three sections built with semantic HTML",
        "Style the layout with flexbox or grid",
        "Add at least one scripted interaction",
      ],
      milestones: [
        "Markup for all sections complete",
        "Responsive layout in place",
        "Interaction wired and tested",
      ],
      expected_result: "A deployed personal site you can show to recruiters.",
      estimated_minutes: 180,
    },
  };
}

/** A fully valid academic curriculum ending in an assessment, not a project. */
function validAcademicCurriculum(): Draft {
  return {
    title: "Class 12 Physics Foundations",
    description: "Mechanics and electromagnetism for the board exam.",
    goal: "Score well in the Class 12 Physics exam",
    estimated_days: 45,
    domain: "academic",
    subject: "Physics",
    modules: [
      {
        order: 1,
        title: "Mechanics",
        description: "Motion, forces, and momentum for Class 12.",
        objective: "Analyze motion and solve Newtonian mechanics problems confidently.",
        estimated_minutes: 65,
        lessons: [
          {
            order: 1,
            title: "Motion in one dimension",
            description: "Displacement, velocity, and acceleration graphs.",
            topic: "Physics",
            skill: "Kinematics",
            level: "beginner",
            estimated_minutes: 30,
            prerequisites: [],
            search_queries: ["physics kinematics motion tutorial", "velocity acceleration graphs explained"],
            objective: "Interpret and draw motion graphs for constant acceleration.",
            concepts: ["displacement", "velocity", "acceleration"],
            practical_outcome: "Solved numericals on uniformly accelerated motion.",
            practice_concept: "Derive and apply the equations of motion.",
            goal_relevance: "Mechanics carries the highest weight in the exam.",
          },
          {
            order: 2,
            title: "Newton's laws of motion",
            description: "Force, momentum, and equilibrium.",
            topic: "Physics",
            skill: "Dynamics",
            level: "beginner",
            estimated_minutes: 35,
            prerequisites: ["Motion in one dimension"],
            search_queries: ["newton laws of motion problems"],
            objective: "Apply Newton's second law to solve problems.",
            concepts: ["force", "momentum", "equilibrium"],
            practical_outcome: "Solved friction and inclined-plane problems.",
            practice_concept: "Draw free-body diagrams for connected bodies.",
            goal_relevance: "Dynamics questions appear in every board paper.",
          },
        ],
      },
      {
        order: 2,
        title: "Electromagnetism",
        description: "Charges, fields, and direct-current circuits.",
        objective: "Work with electric fields and DC circuits confidently.",
        estimated_minutes: 70,
        lessons: [
          {
            order: 3,
            title: "Electric charge and fields",
            description: "Coulomb's law and field patterns.",
            topic: "Physics",
            skill: "Electrostatics",
            level: "intermediate",
            estimated_minutes: 35,
            prerequisites: [],
            search_queries: ["electric field coulomb law physics"],
            objective: "Calculate field strength for simple charge arrangements.",
            concepts: ["charge", "electric field", "Coulomb's law"],
            practical_outcome: "Solved field-strength numericals for point charges.",
            practice_concept: "Add fields from multiple charges by superposition.",
            goal_relevance: "Electrostatics is a guaranteed exam topic.",
          },
          {
            order: 4,
            title: "Current and circuits",
            description: "Ohm's law, resistance, and networks.",
            topic: "Physics",
            skill: "Current electricity",
            level: "intermediate",
            estimated_minutes: 35,
            prerequisites: ["Electric charge and fields"],
            search_queries: ["ohms law circuits physics tutorial"],
            objective: "Analyze series and parallel resistor networks.",
            concepts: ["current", "resistance", "Ohm's law"],
            practical_outcome: "Solved equivalent-resistance problems.",
            practice_concept: "Reduce a mixed network step by step.",
            goal_relevance: "Circuit questions are regularly examined.",
          },
        ],
      },
    ],
    final_outcome: {
      kind: "assessment",
      title: "Class 12 Physics final assessment",
      description: "A full-syllabus assessment across both modules.",
      objective: "Prove exam readiness in mechanics and electromagnetism.",
      requirements: [
        "Attempt all questions in 90 minutes",
        "Show complete derivations",
        "Score at least 70 percent",
      ],
      milestones: [
        "Revise mechanics formulas",
        "Revise electromagnetism formulas",
        "Attempt the full paper",
      ],
      expected_result: "A graded score that pinpoints weak areas before the exam.",
      estimated_minutes: 90,
    },
  };
}

/** Runs the validator against a mutated copy of the valid curriculum. */
function validateMutated(mutate: (draft: Draft) => void) {
  const draft = validCurriculum();
  mutate(draft);
  return validateCurriculum(JSON.stringify(draft));
}

/** Runs the validator against a mutated copy of the academic curriculum. */
function academicMutated(mutate: (draft: Draft) => void) {
  const draft = validAcademicCurriculum();
  mutate(draft);
  return validateCurriculum(JSON.stringify(draft));
}

/** Runs the validator after removing a top-level field outright. */
function validateWithoutTopLevel(key: "title" | "estimated_days" | "domain" | "subject" | "modules" | "final_outcome") {
  const draft: Record<string, unknown> = validCurriculum();
  delete draft[key];
  return validateCurriculum(JSON.stringify(draft));
}

/** Runs the validator after removing a field from the second lesson of the first module. */
function validateWithoutLessonField(key: "topic" | "search_queries" | "objective" | "concepts" | "practical_outcome") {
  const draft = validCurriculum();
  const lessons = draft.modules[0].lessons as Record<string, unknown>[];
  delete lessons[1][key];
  return validateCurriculum(JSON.stringify(draft));
}

/** Runs the validator after removing a field from the second module. */
function validateWithoutModuleField(key: "description" | "objective" | "lessons") {
  const draft = validCurriculum();
  const modules = draft.modules as Record<string, unknown>[];
  delete modules[1][key];
  return validateCurriculum(JSON.stringify(draft));
}

/** Runs the validator after removing a field from the final outcome. */
function validateWithoutOutcomeField(key: "kind" | "title" | "requirements" | "milestones" | "expected_result") {
  const draft = validCurriculum();
  const outcome = draft.final_outcome as Record<string, unknown>;
  delete outcome[key];
  return validateCurriculum(JSON.stringify(draft));
}

const webProfile: OnboardingProfile = {
  topic: "web development",
  currentLevel: "fresh",
  dailyTime: "30",
  goalType: "career",
  videoLanguage: "en",
};

const physicsProfile: OnboardingProfile = {
  topic: "class 12 physics",
  currentLevel: "basics",
  dailyTime: "60",
  goalType: "job",
  videoLanguage: "en",
};

// ---------------------------------------------------------------------------
// Acceptance: the happy path and its recoverable variants.
// ---------------------------------------------------------------------------

const ok = validateCurriculum(JSON.stringify(validCurriculum()));
check("valid curriculum is accepted", ok.ok === true);
if (ok.ok) {
  check("modules are renumbered 1..M", ok.curriculum.modules.every((m, i) => m.order === i + 1));
  const flatLessons = ok.curriculum.modules.flatMap((module) => module.lessons);
  check("lessons are renumbered 1..N across the whole path", flatLessons.every((l, i) => l.order === i + 1));
  check(
    "lessons stay grouped inside their modules",
    ok.curriculum.modules.length === 2 &&
      ok.curriculum.modules[0].lessons.length === 2 &&
      ok.curriculum.modules[1].lessons.length === 2,
  );
  check(
    "search queries survive",
    flatLessons.every((l) => l.search_queries.length >= CURRICULUM_LIMITS.searchQueriesMin),
  );
  check(
    "final outcome is preserved",
    ok.curriculum.final_outcome.kind === "project" &&
      ok.curriculum.final_outcome.requirements.length === 3 &&
      ok.curriculum.final_outcome.milestones.length === 3,
  );
}

check(
  "markdown-fenced JSON is accepted",
  validateCurriculum("```json\n" + JSON.stringify(validCurriculum()) + "\n```").ok === true,
);
check(
  "JSON wrapped in prose is accepted (brace slice)",
  validateCurriculum("Here is your curriculum:\n" + JSON.stringify(validCurriculum()) + "\nGood luck!").ok === true,
);
// Nemotron quirk seen in production: even with thinking disabled the model
// can emit a stray "</think>" mid-answer, preceded by a partial duplicate of
// the JSON. The parser must keep everything after the LAST "</think>".
check(
  "stray </think> artifact with partial JSON duplicate is accepted",
  validateCurriculum(
    '{"title":"Partial duplicate","description":"truncated</think>' + JSON.stringify(validCurriculum()),
  ).ok === true,
);
check(
  "leading <think> block is dropped",
  validateCurriculum("<think>internal reasoning</think>" + JSON.stringify(validCurriculum())).ok === true,
);
// Nemotron quirk seen in production: the model can append junk (a tool-call
// schema with stray IDs) AFTER a complete curriculum object. The parser must
// extract the first balanced object and ignore everything after it.
check(
  "junk appended after complete JSON is ignored",
  validateCurriculum(
    JSON.stringify(validCurriculum()) +
      ' {"set_color": {"name": "set_color", "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}, "color": {"type": "string"}}}}, "user_id": "user_1234"}',
  ).ok === true,
);
// ...but corruption INSIDE the JSON (broken lesson syntax, as observed in
// production) must stay a rejection: generate.ts answers the retry prompt,
// so silently mis-parsing would defeat the retry.
check(
  "JSON corrupted mid-content is still rejected",
  validateCurriculum(
    JSON.stringify(validCurriculum()).replace(
      '"prerequisites":[]',
      '"prerequisites": "HTML structure",""],',
    ),
  ).ok === false,
);

// Out-of-order lessons get sorted, not rejected. (The prerequisites that would
// become forward references after the swap are cleared so only ordering is
// under test here.)
const sorted = validateMutated((draft) => {
  draft.modules[0].lessons[0].order = 2;
  draft.modules[0].lessons[1].order = 1;
  draft.modules[0].lessons[1].prerequisites = [];
  draft.modules[1].lessons[0].order = 4;
  draft.modules[1].lessons[1].order = 3;
  draft.modules[1].lessons[1].prerequisites = [];
});
check(
  "out-of-order lessons are sorted into order",
  sorted.ok === true && (sorted.ok && sorted.curriculum.modules[0].lessons[0].title === "CSS layout"),
);

// Clamping: over-long values are truncated, never rejected.
const clamped = validateMutated((draft) => {
  draft.estimated_days = 100000;
  for (const module of draft.modules) {
    module.lessons = module.lessons.map((lesson) => ({ ...lesson, estimated_minutes: 100000 }));
  }
});
check(
  "over-long estimated_days/minutes are clamped to DB bounds",
  clamped.ok === true && (clamped.ok && clamped.curriculum.estimated_days === CURRICULUM_LIMITS.estimatedDaysMax),
);

// Some models restart lesson numbering at 1 inside each module - recover that
// deterministically instead of burning a retry.
const perModule = validateMutated((draft) => {
  draft.modules[0].lessons[0].order = 1;
  draft.modules[0].lessons[1].order = 2;
  draft.modules[1].lessons[0].order = 1;
  draft.modules[1].lessons[1].order = 2;
});
check("per-module lesson numbering is recovered, not rejected", perModule.ok === true);
if (perModule.ok) {
  check(
    "recovered lessons are renumbered globally inside their modules",
    perModule.curriculum.modules[0].lessons.every((l, i) => l.order === i + 1) &&
      perModule.curriculum.modules[1].lessons.every((l, i) => l.order === i + 3),
  );
}

// Module minutes fall back to the sum of the lessons' minutes when omitted.
const fallback = validateMutated((draft) => {
  const modules = draft.modules as Record<string, unknown>[];
  delete modules[0].estimated_minutes;
});
check(
  "module minutes fall back to the sum of lesson minutes",
  fallback.ok === true && (fallback.ok && fallback.curriculum.modules[0].estimated_minutes === 25 + 30),
);

// Module minutes are clamped to the DB bound when absurdly large.
const clampedModule = validateMutated((draft) => {
  draft.modules[0].estimated_minutes = 999999;
});
check(
  "module minutes are clamped to DB bounds",
  clampedModule.ok === true &&
    (clampedModule.ok && clampedModule.curriculum.modules[0].estimated_minutes === CURRICULUM_LIMITS.moduleEstimatedMinutesMax),
);

// Outcome minutes are clamped to the DB bound when absurdly large.
const clampedOutcome = validateMutated((draft) => {
  draft.final_outcome.estimated_minutes = 999999;
});
check(
  "outcome minutes are clamped to DB bounds",
  clampedOutcome.ok === true &&
    (clampedOutcome.ok && clampedOutcome.curriculum.final_outcome.estimated_minutes === CURRICULUM_LIMITS.outcomeEstimatedMinutesMax),
);

// Declared module order decides the final sequence: modules are renumbered
// 1..M in their declared order and lessons follow across module boundaries.
const renumbered = validateMutated((draft) => {
  draft.modules[0].order = 9;
  draft.modules[1].order = 5;
  draft.modules[0].lessons[0].order = 1;
  draft.modules[0].lessons[1].order = 2;
  draft.modules[1].lessons[0].order = 1;
  draft.modules[1].lessons[1].order = 2;
  // "JavaScript basics" would forward-reference "HTML structure" after the swap.
  draft.modules[1].lessons[0].prerequisites = [];
});
check("declared module order is honored and renumbered", renumbered.ok === true);
if (renumbered.ok) {
  check(
    "modules and lessons renumber after a module order swap",
    renumbered.curriculum.modules[0].order === 1 &&
      renumbered.curriculum.modules[0].title === "Making Pages Interactive" &&
      renumbered.curriculum.modules[0].lessons[0].order === 1 &&
      renumbered.curriculum.modules[1].lessons[0].order === 3,
  );
}

// An academic path ends in an assessment, not a forced project (PART 5).
const academicOk = validateCurriculum(JSON.stringify(validAcademicCurriculum()));
check(
  "academic curriculum with an assessment outcome is accepted",
  academicOk.ok === true && (academicOk.ok && academicOk.curriculum.final_outcome.kind === "assessment"),
);

// Topic relevance: the curriculum must match the learner's stated topic.
check(
  "profile with a related topic is accepted",
  validateCurriculum(JSON.stringify(validCurriculum()), webProfile).ok === true,
);
check(
  "profile matching the academic subject is accepted",
  validateCurriculum(JSON.stringify(validAcademicCurriculum()), physicsProfile).ok === true,
);

// ---------------------------------------------------------------------------
// Rejection: every structurally invalid output must fail with a reason.
// ---------------------------------------------------------------------------

check("non-JSON text is rejected", validateCurriculum("the model refused to answer").ok === false);
check("JSON array is rejected", validateCurriculum("[1,2,3]").ok === false);
check("empty string is rejected", validateCurriculum("").ok === false);
check("truncated JSON is rejected", validateCurriculum('{"title": "Web Dev", "modules": [').ok === false);

check(
  "missing title is rejected",
  validateWithoutTopLevel("title").ok === false,
);
check(
  "too-short title is rejected",
  validateMutated((draft) => {
    draft.title = "ab";
  }).ok === false,
);
check(
  "missing estimated_days is rejected",
  validateWithoutTopLevel("estimated_days").ok === false,
);
check(
  "zero estimated_days is rejected (below min)",
  validateMutated((draft) => {
    draft.estimated_days = 0;
  }).ok === false,
);
check("missing domain is rejected", validateWithoutTopLevel("domain").ok === false);
check(
  "invalid domain is rejected",
  validateMutated((draft) => {
    draft.domain = "sports";
  }).ok === false,
);
check("missing subject is rejected", validateWithoutTopLevel("subject").ok === false);

// The OLD flat contract must be rejected with a reason that teaches the new
// shape (PART 18).
const flatDraft: Record<string, unknown> = validCurriculum();
const flatModules = flatDraft.modules as { lessons: DraftLesson[] }[];
flatDraft.lessons = flatModules.flatMap((module) => module.lessons);
delete flatDraft.modules;
delete flatDraft.final_outcome;
const flat = validateCurriculum(JSON.stringify(flatDraft));
check(
  "flat lessons without modules are rejected (old contract)",
  flat.ok === false && (!flat.ok && flat.reason.includes("module structure")),
);
check(
  "missing modules array is rejected",
  validateWithoutTopLevel("modules").ok === false,
);

check(
  "too few modules is rejected",
  validateMutated((draft) => {
    draft.modules = [
      {
        ...draft.modules[0],
        lessons: [...draft.modules[0].lessons, ...draft.modules[1].lessons],
      },
    ];
  }).ok === false,
);
check(
  "too many modules is rejected",
  validateMutated((draft) => {
    const seed = draft.modules[0].lessons[0];
    draft.modules = Array.from({ length: CURRICULUM_LIMITS.moduleCountMax + 1 }, (_, i) => ({
      order: i + 1,
      title: `Stage ${i + 1}`,
      description: "A real stage of the subject.",
      objective: "Concrete skills for this stage.",
      estimated_minutes: 60,
      lessons: [{ ...seed, order: i + 1, title: `Stage ${i + 1} lesson` }],
    }));
  }).ok === false,
);
check(
  "duplicate module titles are rejected",
  validateMutated((draft) => {
    draft.modules[1].title = draft.modules[0].title;
  }).ok === false,
);
check(
  "duplicate module orders are rejected",
  validateMutated((draft) => {
    draft.modules[1].order = draft.modules[0].order;
  }).ok === false,
);
check(
  "zero module order is rejected",
  validateMutated((draft) => {
    draft.modules[1].order = 0;
  }).ok === false,
);
check("missing module description is rejected", validateWithoutModuleField("description").ok === false);
check("missing module objective is rejected", validateWithoutModuleField("objective").ok === false);
check("missing module lessons array is rejected", validateWithoutModuleField("lessons").ok === false);
check(
  "empty module is rejected",
  validateMutated((draft) => {
    draft.modules[1].lessons = [];
  }).ok === false,
);
check(
  "placeholder text in a module is rejected",
  validateMutated((draft) => {
    draft.modules[0].objective = "TBD";
  }).ok === false,
);

check(
  "too few lessons is rejected",
  validateMutated((draft) => {
    draft.modules[1].lessons = draft.modules[1].lessons.slice(0, 1);
  }).ok === false,
);
check(
  "too many lessons is rejected",
  validateMutated((draft) => {
    const all = Array.from({ length: CURRICULUM_LIMITS.lessonCountMax + 1 }, (_, i) => ({
      ...draft.modules[0].lessons[0],
      order: i + 1,
      title: `Lesson number ${i + 1}`,
    }));
    draft.modules[0].lessons = all.slice(0, 7);
    draft.modules[1].lessons = all.slice(7);
  }).ok === false,
);

check(
  "invalid level is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].level = "expert";
  }).ok === false,
);
check(
  "missing topic is rejected",
  validateWithoutLessonField("topic").ok === false,
);
check(
  "missing skill is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].skill = "";
  }).ok === false,
);
check(
  "missing lesson objective is rejected",
  validateWithoutLessonField("objective").ok === false,
);
check(
  "missing lesson concepts are rejected",
  validateWithoutLessonField("concepts").ok === false,
);
check(
  "missing practical_outcome is rejected",
  validateWithoutLessonField("practical_outcome").ok === false,
);
check(
  "duplicate lesson titles are rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].title = draft.modules[0].lessons[0].title;
  }).ok === false,
);
check(
  "duplicate lesson orders are rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].order = draft.modules[0].lessons[0].order;
  }).ok === false,
);
check(
  "zero lesson order is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].order = 0;
  }).ok === false,
);
check(
  "missing search_queries is rejected",
  validateWithoutLessonField("search_queries").ok === false,
);
check(
  "empty search_queries is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].search_queries = [];
  }).ok === false,
);
check(
  "URL inside search_queries is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].search_queries = ["https://youtube.com/watch?v=abc"];
  }).ok === false,
);
check(
  "non-array prerequisites is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].prerequisites = "HTML structure";
  }).ok === false,
);
check(
  "invalid estimated_minutes is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[1].estimated_minutes = "fast";
  }).ok === false,
);
check(
  "forward-reference prerequisites are rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[0].prerequisites = ["DOM manipulation"];
  }).ok === false,
);

// Module blocks must partition the lesson sequence into consecutive runs.
check(
  "interleaved module blocks are rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[0].order = 1;
    draft.modules[0].lessons[1].order = 3;
    draft.modules[1].lessons[0].order = 2;
    draft.modules[1].lessons[1].order = 4;
  }).ok === false,
);
check(
  "duplicate order inside one module is rejected",
  validateMutated((draft) => {
    draft.modules[0].lessons[0].order = 1;
    draft.modules[0].lessons[1].order = 1;
    draft.modules[1].lessons[0].order = 1;
    draft.modules[1].lessons[1].order = 2;
  }).ok === false,
);
check(
  "module order contradicting the lesson sequence is rejected",
  validateMutated((draft) => {
    draft.modules[0].order = 9;
    draft.modules[1].order = 5;
  }).ok === false,
);

check("missing final_outcome is rejected", validateWithoutTopLevel("final_outcome").ok === false);
check("invalid outcome kind is rejected", validateWithoutOutcomeField("kind").ok === false);
check("missing outcome title is rejected", validateWithoutOutcomeField("title").ok === false);
check(
  "empty outcome requirements are rejected",
  validateMutated((draft) => {
    draft.final_outcome.requirements = [];
  }).ok === false,
);
check("missing outcome milestones are rejected", validateWithoutOutcomeField("milestones").ok === false);
check(
  "missing outcome expected_result is rejected",
  validateMutated((draft) => {
    draft.final_outcome.expected_result = "";
  }).ok === false,
);
check(
  "placeholder text in the outcome is rejected",
  validateMutated((draft) => {
    draft.final_outcome.expected_result = "Coming soon";
  }).ok === false,
);

// Domain purity (PART 18): programming terminology never leaks into a
// non-programming curriculum - not in modules, lessons, or the outcome.
check(
  "programming terminology in a non-programming module is rejected",
  academicMutated((draft) => {
    draft.modules[0].title = "Build a React app";
  }).ok === false,
);
check(
  "programming terminology in a non-programming lesson is rejected",
  academicMutated((draft) => {
    draft.modules[0].lessons[0].skill = "JavaScript";
  }).ok === false,
);
check(
  "programming terminology in a non-programming outcome is rejected",
  academicMutated((draft) => {
    draft.final_outcome.title = "Full-Stack Web Project";
  }).ok === false,
);

check(
  "curriculum unrelated to the learner's topic is rejected",
  validateCurriculum(
    JSON.stringify(validCurriculum()),
    { ...webProfile, topic: "organic chemistry" },
  ).ok === false,
);

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

console.log(`\n${passed}/${passed + failed} checks passed.`);
if (failed > 0) {
  process.exit(1);
}
