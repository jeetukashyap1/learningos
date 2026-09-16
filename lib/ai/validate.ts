/**
 * Strict validation of the model's curriculum output (spec part 6 + PART 10/18).
 *
 * Everything the route persists goes through here first:
 * - JSON syntax (fence-stripping and one recovery slice, nothing clever)
 * - required fields and their types (including domain/subject and the
 *   richer lesson structure: objective, concepts, practical outcome,
 *   practice concept, goal relevance)
 * - module structure: 2-10 ordered modules with unique titles and real
 *   objectives; every module contains at least one lesson; a curriculum
 *   with lessons but no module structure is rejected outright
 * - lesson count (4-12 across the whole path) and unique order values
 *   (global 1..N numbering preferred; per-module numbering recovered
 *   deterministically instead of burning a retry)
 * - modules must partition the lesson sequence into consecutive blocks
 * - allowed levels, domains and outcome kinds only
 * - non-empty titles, descriptions, topics, skills
 * - at least one usable search query per lesson, no URLs inside queries
 * - no duplicate lesson/module titles or duplicate queries
 * - no placeholder text ("lorem ipsum", "TBD", ...)
 * - no forward references in prerequisites (a prerequisite must be an
 *   earlier lesson, never a later one)
 * - final outcome: kind from the closed list plus title, description,
 *   objective, requirements, milestones, expected result and effort
 * - domain discipline: programming terminology is rejected outright in
 *   non-programming domains (a Class 12 Physics path must not contain
 *   JavaScript/REST/full-stack lessons, modules, or outcome text)
 * - topic relevance: the curriculum must share at least one meaningful
 *   token with the learner's stated topic (when the profile is provided)
 *
 * Valid values are trimmed and clamped to the DB check constraints, so a
 * validated curriculum can always be persisted as-is. Invalid output returns
 * a machine-usable reason that generate.ts feeds back to the model on retry.
 */

import {
  AI_OUTCOME_KINDS,
  CURRICULUM_LIMITS,
  LEARNING_DOMAINS,
  type AiCurriculum,
  type AiCurriculumLesson,
  type AiCurriculumModule,
  type AiFinalOutcome,
  type AiOutcomeKind,
  type LearningDomain,
  type OnboardingProfile,
} from "./curriculum";
import type { LearningLevel } from "@/lib/types";

export type CurriculumValidation =
  | { ok: true; curriculum: AiCurriculum }
  | { ok: false; reason: string };

const LEVELS: readonly LearningLevel[] = ["beginner", "intermediate", "advanced"];

/**
 * Unambiguous programming/web-development markers. When the detected domain
 * is NOT "programming", any of these in a lesson's or module's identity
 * fields (title, topic, skill, concepts, search queries, module objective,
 * outcome text) means the model injected the wrong domain and the
 * curriculum is rejected. Word boundaries keep innocent substrings
 * ("rapid", "expressing") out; ambiguous words (node, express) are listed
 * only in their unambiguous compound forms.
 */
const PROGRAMMING_MARKERS: readonly RegExp[] = [
  /\bjavascript\b/i,
  /\btypescript\b/i,
  /\breact\b/i,
  /\bangular\b/i,
  /\bvue\b/i,
  /\bnode\.?js\b/i,
  /\bexpress\.?js\b/i,
  /\bmongodb\b/i,
  /\bhtml\b/i,
  /\bcss\b/i,
  /\bfull[- ]?stack\b/i,
  /\bfront[- ]?end\b/i,
  /\bback[- ]?end\b/i,
  /\bweb\s+dev(elopment)?\b/i,
  /\brest\s+api\b/i,
  /\bapi\b/i,
  /\bapis\b/i,
  /\bgraphql\b/i,
  /\bdocker\b/i,
  /\bkubernetes\b/i,
  /\bgit\b/i,
  /\bgithub\b/i,
  /\bpython\b/i,
  /\bjava\b/i,
  /\bc\+\+\b/i,
  /\bsql\b/i,
  /\bdatabase\b/i,
  /\bsoftware\s+dev(eloper|elopment)?\b/i,
  /\bcoding\b/i,
];

/** Placeholder strings that must never survive validation. */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\blorem\s+ipsum\b/i,
  /\btbd\b/i,
  /\btodo\b/i,
  /\bplaceholder\b/i,
  /\bcoming\s+soon\b/i,
  /\bexample\s+(lesson|title|topic)\b/i,
  /\bxxx\b/i,
];

/** Tokens ignored by the topic-relevance check. */
const TOPIC_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "want", "wants",
  "learn", "learning", "become", "becoming", "about", "into", "your",
  "you", "are", "can", "will", "how", "get", "help", "need",
]);

/** Intermediate module shape while validating (before orders are renumbered). */
interface ModuleDraft {
  order: number;
  title: string;
  description: string;
  objective: string;
  rawMinutes: unknown;
  rawLessons: unknown[];
  lessons: AiCurriculumLesson[];
}

/** Intermediate lesson shape carrying the module it belongs to. */
interface LessonDraft {
  moduleOrder: number;
  order: number;
  lesson: AiCurriculumLesson;
}

export function validateCurriculum(raw: string, profile?: OnboardingProfile): CurriculumValidation {
  const parsed = extractJson(raw);
  if (parsed === undefined) {
    return fail("the response is not valid JSON");
  }
  if (!isRecord(parsed)) {
    return fail("the response is not a JSON object");
  }

  const title = cleanText(parsed.title);
  if (!title || title.length < CURRICULUM_LIMITS.pathTitleMin) {
    return fail("the path title is missing or too short");
  }

  const description = clampText(parsed.description, CURRICULUM_LIMITS.pathDescriptionMax);
  const goal = clampText(parsed.goal, CURRICULUM_LIMITS.pathGoalMax);

  const estimatedDays = clampInteger(
    parsed.estimated_days,
    CURRICULUM_LIMITS.estimatedDaysMin,
    CURRICULUM_LIMITS.estimatedDaysMax,
  );
  if (estimatedDays === null) {
    return fail("estimated_days is missing or not a positive number");
  }

  const domain = parsed.domain;
  if (typeof domain !== "string" || !LEARNING_DOMAINS.includes(domain as LearningDomain)) {
    return fail('domain must be exactly one of "academic", "programming", "language", "exam-prep", "creative", "practical", "other"');
  }

  const subject = cleanText(parsed.subject);
  if (!subject) {
    return fail("subject is missing - name what the learner is actually studying");
  }

  // ---- Module structure (PART 18) ---------------------------------------
  // Lessons must arrive grouped into ordered modules (stages) of the
  // subject. A flat lessons array is the OLD contract and is rejected
  // explicitly so the retry loop teaches the model the new shape.
  if (!Array.isArray(parsed.modules)) {
    if (Array.isArray(parsed.lessons)) {
      return fail("the curriculum has lessons but no module structure - group the lessons into ordered modules (stages) of this subject, each module with its own lessons, and add the final_outcome object");
    }
    return fail("modules is missing or not an array");
  }
  const moduleCount = parsed.modules.length;
  if (moduleCount < CURRICULUM_LIMITS.moduleCountMin || moduleCount > CURRICULUM_LIMITS.moduleCountMax) {
    return fail(`the path must contain between ${CURRICULUM_LIMITS.moduleCountMin} and ${CURRICULUM_LIMITS.moduleCountMax} modules`);
  }

  const seenModuleOrders = new Set<number>();
  const seenModuleTitles = new Set<string>();
  const moduleDrafts: ModuleDraft[] = [];

  for (let mIndex = 0; mIndex < moduleCount; mIndex += 1) {
    const entry = parsed.modules[mIndex];
    if (!isRecord(entry)) {
      return fail(`module ${mIndex + 1} is not an object`);
    }

    const order = toInteger(entry.order);
    if (order === null || order < 1) {
      return fail(`module ${mIndex + 1} has an invalid order`);
    }
    if (seenModuleOrders.has(order)) {
      return fail(`two modules share the same order ${order}`);
    }
    seenModuleOrders.add(order);

    const moduleTitle = cleanText(entry.title);
    if (!moduleTitle || moduleTitle.length < CURRICULUM_LIMITS.moduleTitleMin) {
      return fail(`module ${mIndex + 1} has a missing or too-short title`);
    }
    const moduleTitleKey = moduleTitle.toLowerCase();
    if (seenModuleTitles.has(moduleTitleKey)) {
      return fail(`two modules share the same title "${moduleTitle}"`);
    }
    seenModuleTitles.add(moduleTitleKey);

    const moduleDescription = clampText(entry.description, CURRICULUM_LIMITS.moduleDescriptionMax);
    if (!moduleDescription) {
      return fail(`module ${mIndex + 1} is missing its description`);
    }

    const moduleObjective = clampText(entry.objective, CURRICULUM_LIMITS.moduleObjectiveMax);
    if (!moduleObjective) {
      return fail(`module ${mIndex + 1} is missing its objective - what the learner can do once this stage is complete`);
    }

    if (!Array.isArray(entry.lessons)) {
      return fail(`module ${mIndex + 1} is missing its lessons array`);
    }
    if (entry.lessons.length === 0) {
      return fail(`module ${mIndex + 1} ("${moduleTitle}") contains no lessons - every module must be a real, non-empty stage of the subject`);
    }

    // Placeholder discipline (PART 10/18): no template text anywhere.
    const moduleIdentity = `${moduleTitle} ${moduleObjective}`;
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(moduleIdentity)) {
        return fail(`module ${mIndex + 1} contains placeholder text - write real content for this learner`);
      }
    }

    // Domain discipline (PART 9/10/18): programming terminology is only
    // allowed when the detected domain IS programming.
    if (domain !== "programming") {
      for (const marker of PROGRAMMING_MARKERS) {
        if (marker.test(moduleIdentity)) {
          return fail(`module ${mIndex + 1} contains programming terminology ("${marker.source.replace(/\\b/g, "")}") but the learner's domain is ${domain} - teach the subject they actually asked for, with no programming content`);
        }
      }
    }

    moduleDrafts.push({
      order,
      title: moduleTitle,
      description: moduleDescription,
      objective: moduleObjective,
      rawMinutes: entry.estimated_minutes,
      rawLessons: entry.lessons,
      lessons: [],
    });
  }

  const lessonCount = moduleDrafts.reduce((total, draft) => total + draft.rawLessons.length, 0);
  if (lessonCount < CURRICULUM_LIMITS.lessonCountMin || lessonCount > CURRICULUM_LIMITS.lessonCountMax) {
    return fail(`the path must contain between ${CURRICULUM_LIMITS.lessonCountMin} and ${CURRICULUM_LIMITS.lessonCountMax} lessons`);
  }

  // ---- Lessons inside modules -------------------------------------------
  const seenTitles = new Set<string>();
  const lessonDrafts: LessonDraft[] = [];

  for (const draft of moduleDrafts) {
    for (let index = 0; index < draft.rawLessons.length; index += 1) {
      const entry = draft.rawLessons[index];
      if (!isRecord(entry)) {
        return fail(`module "${draft.title}" lesson ${index + 1} is not an object`);
      }
      const where = `module "${draft.title}" lesson ${index + 1}`;

      const order = toInteger(entry.order);
      if (order === null || order < 1) {
        return fail(`${where} has an invalid order`);
      }

      const lessonTitle = cleanText(entry.title);
      if (!lessonTitle || lessonTitle.length < CURRICULUM_LIMITS.lessonTitleMin) {
        return fail(`${where} has a missing or too-short title`);
      }
      const titleKey = lessonTitle.toLowerCase();
      if (seenTitles.has(titleKey)) {
        return fail(`two lessons share the same title "${lessonTitle}"`);
      }
      seenTitles.add(titleKey);

      const topic = cleanText(entry.topic);
      if (!topic) {
        return fail(`${where} is missing its topic`);
      }
      const skill = cleanText(entry.skill);
      if (!skill) {
        return fail(`${where} is missing its skill`);
      }

      const level = entry.level;
      if (typeof level !== "string" || !LEVELS.includes(level as LearningLevel)) {
        return fail(`${where} has an invalid level`);
      }

      const estimatedMinutes = clampInteger(
        entry.estimated_minutes,
        CURRICULUM_LIMITS.estimatedMinutesMin,
        CURRICULUM_LIMITS.estimatedMinutesMax,
      );
      if (estimatedMinutes === null) {
        return fail(`${where} has invalid estimated_minutes`);
      }

      const prerequisites = cleanStringArray(entry.prerequisites, CURRICULUM_LIMITS.prerequisitesMax, CURRICULUM_LIMITS.prerequisiteLengthMax);
      if (prerequisites === null) {
        return fail(`${where} has invalid prerequisites`);
      }

      const searchQueries = cleanQueries(entry.search_queries);
      if (searchQueries === null) {
        return fail(`${where} has invalid search queries (each needs ${CURRICULUM_LIMITS.searchQueryLengthMin}-${CURRICULUM_LIMITS.searchQueryLengthMax} characters, no URLs)`);
      }

      const objective = clampText(entry.objective, CURRICULUM_LIMITS.objectiveMax);
      if (!objective) {
        return fail(`${where} is missing its objective - what will the learner be able to do after it`);
      }

      const concepts = cleanStringArray(entry.concepts, CURRICULUM_LIMITS.conceptsMax, CURRICULUM_LIMITS.conceptLengthMax);
      if (concepts === null || concepts.length < CURRICULUM_LIMITS.conceptsMin) {
        return fail(`${where} needs between ${CURRICULUM_LIMITS.conceptsMin} and ${CURRICULUM_LIMITS.conceptsMax} key concepts`);
      }

      const practicalOutcome = clampText(entry.practical_outcome, CURRICULUM_LIMITS.practicalOutcomeMax);
      if (!practicalOutcome) {
        return fail(`${where} is missing its practical_outcome`);
      }

      const practiceConcept = clampText(entry.practice_concept, CURRICULUM_LIMITS.practiceConceptMax);
      if (!practiceConcept) {
        return fail(`${where} is missing its practice_concept`);
      }

      const goalRelevance = clampText(entry.goal_relevance, CURRICULUM_LIMITS.goalRelevanceMax);
      if (!goalRelevance) {
        return fail(`${where} is missing its goal_relevance`);
      }

      // Placeholder discipline (PART 10): no template text anywhere.
      const identityText = [lessonTitle, topic, skill, objective, practicalOutcome].join(" ");
      for (const pattern of PLACEHOLDER_PATTERNS) {
        if (pattern.test(identityText)) {
          return fail(`${where} contains placeholder text - write real content for this learner`);
        }
      }

      // Domain discipline (PART 9/10): programming terminology is only
      // allowed when the detected domain IS programming.
      if (domain !== "programming") {
        const markerText = [lessonTitle, topic, skill, ...concepts, ...searchQueries].join(" ");
        for (const marker of PROGRAMMING_MARKERS) {
          if (marker.test(markerText)) {
            return fail(`${where} contains programming terminology ("${marker.source.replace(/\\b/g, "")}") but the learner's domain is ${domain} - teach the subject they actually asked for, with no programming content`);
          }
        }
      }

      lessonDrafts.push({
        moduleOrder: draft.order,
        order,
        lesson: {
          order,
          title: lessonTitle,
          description: clampText(entry.description, CURRICULUM_LIMITS.lessonDescriptionMax),
          topic: topic.slice(0, CURRICULUM_LIMITS.lessonTopicMax),
          skill: skill.slice(0, CURRICULUM_LIMITS.lessonSkillMax),
          level: level as LearningLevel,
          estimated_minutes: estimatedMinutes,
          prerequisites,
          search_queries: searchQueries,
          objective,
          concepts,
          practical_outcome: practicalOutcome,
          practice_concept: practiceConcept,
          goal_relevance: goalRelevance,
        },
      });
    }
  }

  // ---- Ordering (PART 18) ------------------------------------------------
  // The contract numbers lessons 1..N across the whole path. Some models
  // instead restart at 1 inside each module - recover that deterministically
  // instead of burning a retry, but reject any real ambiguity (duplicate
  // orders inside one module) and any interleaving of module blocks.
  const globallyUnique = lessonDrafts.length === new Set(lessonDrafts.map((item) => item.order)).size;
  if (globallyUnique) {
    lessonDrafts.sort((a, b) => a.order - b.order);
    for (let index = 1; index < lessonDrafts.length; index += 1) {
      if (lessonDrafts[index].moduleOrder < lessonDrafts[index - 1].moduleOrder) {
        return fail("modules must partition the lessons into consecutive blocks - every lesson of a module comes before the next module's lessons");
      }
    }
  } else {
    for (const draft of moduleDrafts) {
      const orders = lessonDrafts
        .filter((item) => item.moduleOrder === draft.order)
        .map((item) => item.order);
      if (orders.length !== new Set(orders).size) {
        return fail("two lessons share the same order - lessons must be numbered 1..N across the whole path (or 1..k inside each module)");
      }
    }
    lessonDrafts.sort((a, b) => a.moduleOrder - b.moduleOrder || a.order - b.order);
  }

  // Renumber 1..N so persistence and display are stable.
  const lessons = lessonDrafts.map((item) => item.lesson);
  lessons.forEach((lesson, index) => {
    lesson.order = index + 1;
  });

  // Hand each validated lesson back to its module, in sorted order.
  for (const item of lessonDrafts) {
    const owner = moduleDrafts.find((draft) => draft.order === item.moduleOrder);
    if (owner) {
      owner.lessons.push(item.lesson);
    }
  }

  // Renumber modules 1..M in their declared order and finalize metadata.
  // Module effort falls back to the sum of its lessons' minutes when the
  // model omits or garbles it.
  moduleDrafts.sort((a, b) => a.order - b.order);
  const modules: AiCurriculumModule[] = moduleDrafts.map((draft, index) => {
    const provided = clampInteger(draft.rawMinutes, 1, CURRICULUM_LIMITS.moduleEstimatedMinutesMax);
    const summed = draft.lessons.reduce((total, lesson) => total + lesson.estimated_minutes, 0);
    const minutes = provided ?? Math.max(summed, 1);
    return {
      order: index + 1,
      title: draft.title.slice(0, CURRICULUM_LIMITS.moduleTitleMax),
      description: draft.description,
      objective: draft.objective,
      estimated_minutes: Math.min(minutes, CURRICULUM_LIMITS.moduleEstimatedMinutesMax),
      lessons: draft.lessons,
    };
  });

  // ---- Final outcome (PART 5/18) ----------------------------------------
  if (!isRecord(parsed.final_outcome)) {
    return fail("final_outcome is missing - define the domain-appropriate culmination of this path");
  }
  const outcomeEntry = parsed.final_outcome;

  const kind = outcomeEntry.kind;
  if (typeof kind !== "string" || !AI_OUTCOME_KINDS.includes(kind as AiOutcomeKind)) {
    return fail('final_outcome.kind must be exactly one of "project", "assessment", "mock-exam", "mock-interview", "case-study", "presentation", "portfolio", "other"');
  }

  const outcomeTitle = cleanText(outcomeEntry.title);
  if (!outcomeTitle || outcomeTitle.length < CURRICULUM_LIMITS.outcomeTitleMin) {
    return fail("final_outcome has a missing or too-short title");
  }

  const outcomeDescription = clampText(outcomeEntry.description, CURRICULUM_LIMITS.outcomeDescriptionMax);
  if (!outcomeDescription) {
    return fail("final_outcome is missing its description");
  }

  const outcomeObjective = clampText(outcomeEntry.objective, CURRICULUM_LIMITS.outcomeObjectiveMax);
  if (!outcomeObjective) {
    return fail("final_outcome is missing its objective - what completing it proves");
  }

  const requirements = cleanStringArray(
    outcomeEntry.requirements,
    CURRICULUM_LIMITS.outcomeRequirementsMax,
    CURRICULUM_LIMITS.outcomeRequirementLengthMax,
  );
  if (requirements === null || requirements.length < CURRICULUM_LIMITS.outcomeRequirementsMin) {
    return fail(`final_outcome needs between ${CURRICULUM_LIMITS.outcomeRequirementsMin} and ${CURRICULUM_LIMITS.outcomeRequirementsMax} requirements`);
  }

  const milestones = cleanStringArray(
    outcomeEntry.milestones,
    CURRICULUM_LIMITS.outcomeMilestonesMax,
    CURRICULUM_LIMITS.outcomeMilestoneLengthMax,
  );
  if (milestones === null || milestones.length < CURRICULUM_LIMITS.outcomeMilestonesMin) {
    return fail(`final_outcome needs between ${CURRICULUM_LIMITS.outcomeMilestonesMin} and ${CURRICULUM_LIMITS.outcomeMilestonesMax} milestones`);
  }

  const expectedResult = clampText(outcomeEntry.expected_result, CURRICULUM_LIMITS.outcomeExpectedResultMax);
  if (!expectedResult) {
    return fail("final_outcome is missing its expected_result");
  }

  const outcomeMinutes = clampInteger(
    outcomeEntry.estimated_minutes,
    1,
    CURRICULUM_LIMITS.outcomeEstimatedMinutesMax,
  );
  if (outcomeMinutes === null) {
    return fail("final_outcome has invalid estimated_minutes");
  }

  // Placeholder discipline (PART 10/18): no template text in the outcome.
  const outcomeIdentity = [outcomeTitle, outcomeObjective, expectedResult, ...requirements, ...milestones].join(" ");
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(outcomeIdentity)) {
      return fail("final_outcome contains placeholder text - write the real culmination for this learner");
    }
  }

  // Domain discipline (PART 18): the culmination must belong to the
  // learner's domain - no programming artifacts for a physics path.
  if (domain !== "programming") {
    for (const marker of PROGRAMMING_MARKERS) {
      if (marker.test(outcomeIdentity)) {
        return fail(`final_outcome contains programming terminology ("${marker.source.replace(/\\b/g, "")}") but the learner's domain is ${domain} - the outcome must be the natural culmination of the subject they asked for`);
      }
    }
  }

  const finalOutcome: AiFinalOutcome = {
    kind: kind as AiOutcomeKind,
    title: outcomeTitle.slice(0, CURRICULUM_LIMITS.outcomeTitleMax),
    description: outcomeDescription,
    objective: outcomeObjective,
    requirements,
    milestones,
    expected_result: expectedResult,
    estimated_minutes: outcomeMinutes,
  };

  // Coherence (PART 10): a prerequisite must never reference a LATER
  // lesson - that would make the path impossible to follow in order.
  for (let index = 0; index < lessons.length; index += 1) {
    const laterTitles = new Set(
      lessons.slice(index + 1).map((lesson) => lesson.title.toLowerCase()),
    );
    for (const prerequisite of lessons[index].prerequisites) {
      if (laterTitles.has(prerequisite.toLowerCase())) {
        return fail(`lesson ${index + 1} lists "${prerequisite}" as a prerequisite, but that lesson comes later - prerequisites must be earlier lessons only`);
      }
    }
  }

  // Topic relevance (PART 10): the curriculum must be about what the
  // learner asked for. One shared meaningful token between their topic and
  // the curriculum's identity fields is the (deliberately lenient) bar.
  if (profile) {
    const topicTokens = tokenize(profile.topic);
    if (topicTokens.length > 0) {
      const haystack = new Set<string>();
      addTokens(haystack, subject);
      addTokens(haystack, title);
      for (const curriculumModule of modules) {
        addTokens(haystack, curriculumModule.title);
      }
      for (const lesson of lessons) {
        addTokens(haystack, lesson.title);
        addTokens(haystack, lesson.topic);
        addTokens(haystack, lesson.skill);
      }
      const related = topicTokens.some((token) => haystack.has(token));
      if (!related) {
        return fail(`the curriculum is unrelated to the learner's topic "${profile.topic}" - build the path around what they actually want to learn`);
      }
    }
  }

  return {
    ok: true,
    curriculum: {
      title: title.slice(0, CURRICULUM_LIMITS.pathTitleMax),
      description,
      goal,
      estimated_days: estimatedDays,
      domain: domain as LearningDomain,
      subject: subject.slice(0, CURRICULUM_LIMITS.subjectMax),
      modules,
      final_outcome: finalOutcome,
    },
  };
}

/**
 * Parses the model output: direct JSON.parse, with recoveries that stay
 * deterministic - dropping a stray "</think>" artifact, stripping a markdown
 * code fence, and extracting the first complete JSON object when the model
 * wrapped it in prose or appended junk after it.
 */
function extractJson(raw: string): unknown {
  let text = raw.trim();
  // Nemotron quirk: even with thinking disabled the model can emit a stray
  // "</think>" mid-answer, with a partial duplicate of the JSON before it.
  // Everything after the LAST "</think>" is the real answer.
  const thinkEnd = text.lastIndexOf("</think>");
  if (thinkEnd >= 0) {
    text = text.slice(thinkEnd + "</think>".length).trim();
  }
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    text = fence[1].trim();
  }
  try {
    return JSON.parse(text);
  } catch {
    // fall through to the object extraction
  }
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  // Nemotron quirk: the model sometimes appends junk (tool-call schemas,
  // stray IDs...) after a complete curriculum object. Slicing to the LAST "}"
  // swallows that junk and breaks the parse, so scan for the FIRST balanced
  // object instead: string-aware brace counting from the first "{" until the
  // depth returns to zero.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  // Last resort (prose wrapper, unbalanced content): first "{" to last "}".
  const end = text.lastIndexOf("}");
  if (end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trims and collapses whitespace; returns "" for non-strings. */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function clampText(value: unknown, maxLength: number): string {
  return cleanText(value).slice(0, maxLength);
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.round(Number(value));
  }
  return null;
}

function clampInteger(value: unknown, min: number, max: number): number | null {
  const integer = toInteger(value);
  if (integer === null || integer < min) {
    return null;
  }
  return Math.min(integer, max);
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry).slice(0, maxLength);
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

function cleanQueries(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    let text = cleanText(entry).replace(/^["']|["']$/g, "").trim();
    if (!text) continue;
    if (/https?:\/\/|www\./i.test(text)) {
      return null; // queries must be search phrases, never URLs
    }
    text = text.slice(0, CURRICULUM_LIMITS.searchQueryLengthMax);
    if (text.length < CURRICULUM_LIMITS.searchQueryLengthMin) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= CURRICULUM_LIMITS.searchQueriesMax) break;
  }
  return items.length >= CURRICULUM_LIMITS.searchQueriesMin ? items : null;
}

/** Lowercase word tokens of length >= 3, minus stopwords. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token));
}

function addTokens(target: Set<string>, text: string): void {
  for (const token of tokenize(text)) {
    target.add(token);
  }
}

function fail(reason: string): CurriculumValidation {
  return { ok: false, reason };
}
