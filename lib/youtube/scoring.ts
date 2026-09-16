/**
 * Deterministic educational relevance scoring.
 *
 * relevanceScore = topicMatch (0-25) + titleMatch (0-20) + descriptionMatch (0-10)
 *               + educationalSignals (0-15) + durationFit (0-10) + levelFit (0-5)
 *               + languageMatch (0-15)
 *
 * Topic relevance always outweighs language preference (spec part 13):
 * the topic/title/description block carries 55 points, language 15.
 * languageMatch verifies the learner's preferred video language from the
 * video's own metadata (title/description text - Devanagari script,
 * "hindi"/"english" mentions), because that is what the database cache
 * persists; when no preference is expressed the component is neutral
 * (full points) so the scale stays comparable.
 *
 * The score is a transparent heuristic, not an objective measure of quality:
 * every component is a fixed, documented rule over the video's own metadata,
 * so the same video + options always produce the same score (also true for
 * results replayed from the database cache, because scoring only uses fields
 * that are persisted).
 */

import type { LearningLevel, RelevanceScoreBreakdown } from "@/lib/types";
import { tokenize } from "./text";

/** Fields needed to score a video. Shared by fresh API results and cached DB rows. */
export interface ScorableResource {
  title: string;
  description: string;
  channelName: string;
  durationSeconds: number | null;
}

export interface ScoringContext {
  /** Tokens of the user's search query. */
  queryTokens: string[];
  /** Tokens of the topic (or skill, or query as fallback) used for topic matching. */
  topicTokens: string[];
  level: LearningLevel;
  /**
   * Preferred video language (spec part 6): "en", "hi", "hinglish", or
   * null when the learner has no preference. Other BCP-47 codes from the
   * public search API cannot be verified from persisted metadata and are
   * treated as neutral.
   */
  language: string | null;
}

export interface ResourceScore {
  breakdown: RelevanceScoreBreakdown;
  total: number;
}

/** Phrases that indicate teaching intent in title/description/channel. */
const EDUCATIONAL_SIGNALS = [
  "tutorial", "guide", "explained", "crash course", "course", "lesson", "learn",
  "introduction", "basics", "fundamentals", "walkthrough", "step by step", "how to",
  "beginner", "beginners", "deep dive", "masterclass", "bootcamp", "training",
  "lecture", "workshop", "example", "examples", "demystified", "in minutes",
];

/** Phrases that hint the content targets beginners. */
const BEGINNER_SIGNALS = [
  "beginner", "beginners", "introduction", "intro", "basics", "crash course",
  "getting started", "step by step", "fundamentals", "101",
];

/** Phrases that hint the content targets advanced learners. */
const ADVANCED_SIGNALS = [
  "advanced", "deep dive", "internals", "under the hood", "architecture",
  "expert", "optimization", "performance", "scaling",
];

/** Comfortable duration windows (seconds) per learning level. */
const DURATION_RANGES: Record<LearningLevel, [minSeconds: number, maxSeconds: number]> = {
  beginner: [180, 1500],
  intermediate: [300, 2700],
  advanced: [480, 3600],
};

const MAX_SCORE = 100;

/** Component weights (must sum to MAX_SCORE). */
const TOPIC_MATCH_WEIGHT = 25;
const TITLE_MATCH_WEIGHT = 20;
const DESCRIPTION_MATCH_WEIGHT = 10;
const EDUCATIONAL_SIGNALS_WEIGHT = 15;
const DURATION_FIT_WEIGHT = 10;
const LEVEL_FIT_WEIGHT = 5;
const LANGUAGE_MATCH_WEIGHT = 15;

/** Devanagari block: strong evidence the video's text (and usually audio) is Hindi. */
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

/** Scores a single resource against the search context. Pure and deterministic. */
export function scoreResource(resource: ScorableResource, context: ScoringContext): ResourceScore {
  const titleTokens = new Set(tokenize(resource.title));
  const descriptionTokens = new Set(tokenize(resource.description));
  const channelTokens = new Set(tokenize(resource.channelName));
  const everywhereTokens = new Set([...titleTokens, ...descriptionTokens, ...channelTokens]);

  const combined = `${resource.title} ${resource.description} ${resource.channelName}`.toLowerCase();

  const breakdown: RelevanceScoreBreakdown = {
    topicMatch: matchFraction(context.topicTokens, everywhereTokens) * TOPIC_MATCH_WEIGHT,
    titleMatch: matchFraction(context.queryTokens, titleTokens) * TITLE_MATCH_WEIGHT,
    descriptionMatch: matchFraction(context.queryTokens, descriptionTokens) * DESCRIPTION_MATCH_WEIGHT,
    educationalSignals: educationalSignalPoints(combined),
    durationFit: durationFitPoints(resource.durationSeconds, context.level),
    levelFit: levelFitPoints(combined, context.level),
    languageMatch: languageMatchPoints(combined, context.language),
  };

  const total = Math.min(
    MAX_SCORE,
    round1(
      breakdown.topicMatch +
        breakdown.titleMatch +
        breakdown.descriptionMatch +
        breakdown.educationalSignals +
        breakdown.durationFit +
        breakdown.levelFit +
        breakdown.languageMatch,
    ),
  );

  return { breakdown: roundBreakdown(breakdown), total };
}

/** Sort comparator: score desc, then newer first, then stable id order. */
export function compareByRelevance(
  a: { score: ResourceScore; externalId: string; publishedAt: string | null },
  b: { score: ResourceScore; externalId: string; publishedAt: string | null },
): number {
  if (a.score.total !== b.score.total) return b.score.total - a.score.total;
  const aDate = parseTimestamp(a.publishedAt);
  const bDate = parseTimestamp(b.publishedAt);
  if (aDate !== bDate) return bDate - aDate;
  return a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0;
}

function matchFraction(tokens: string[], haystack: Set<string>): number {
  if (tokens.length === 0) return 0;
  let matched = 0;
  for (const token of tokens) {
    if (haystack.has(token)) matched += 1;
  }
  return matched / tokens.length;
}

function educationalSignalPoints(combined: string): number {
  let signals = 0;
  for (const signal of EDUCATIONAL_SIGNALS) {
    if (combined.includes(signal)) signals += 1;
  }
  return Math.min(signals * 5, EDUCATIONAL_SIGNALS_WEIGHT);
}

function durationFitPoints(durationSeconds: number | null, level: LearningLevel): number {
  if (durationSeconds === null) return DURATION_FIT_WEIGHT / 2; // Unknown length: neutral, not zero.
  const [minSeconds, maxSeconds] = DURATION_RANGES[level];
  if (durationSeconds >= minSeconds && durationSeconds <= maxSeconds) return DURATION_FIT_WEIGHT;
  const width = maxSeconds - minSeconds;
  const distance = durationSeconds < minSeconds ? minSeconds - durationSeconds : durationSeconds - maxSeconds;
  const overshoot = distance / width;
  if (overshoot <= 0.25) return DURATION_FIT_WEIGHT * 0.7;
  if (overshoot <= 0.5) return DURATION_FIT_WEIGHT * 0.4;
  return DURATION_FIT_WEIGHT * 0.1;
}

function levelFitPoints(combined: string, level: LearningLevel): number {
  const hasBeginner = BEGINNER_SIGNALS.some((signal) => combined.includes(signal));
  const hasAdvanced = ADVANCED_SIGNALS.some((signal) => combined.includes(signal));
  if (level === "beginner") return hasBeginner ? LEVEL_FIT_WEIGHT : hasAdvanced ? 0 : LEVEL_FIT_WEIGHT * 0.4;
  if (level === "advanced") return hasAdvanced ? LEVEL_FIT_WEIGHT : hasBeginner ? 0 : LEVEL_FIT_WEIGHT * 0.4;
  return hasBeginner || hasAdvanced ? LEVEL_FIT_WEIGHT * 0.6 : LEVEL_FIT_WEIGHT * 0.4;
}

/**
 * Preferred-video-language match (spec parts 6, 13, 15), verified from the
 * video's own persisted text. Honest by design: when the metadata gives no
 * evidence either way the video keeps most of the component (YouTube
 * metadata is often English even for Hindi audio), while clear evidence of
 * the WRONG language (e.g. Devanagari for an English preference) costs it.
 */
function languageMatchPoints(combined: string, language: string | null): number {
  // No preference, or a code we cannot verify from persisted metadata:
  // neutral - never punish the learner for not choosing.
  if (!language || language === "any") return LANGUAGE_MATCH_WEIGHT;

  const hasDevanagari = DEVANAGARI_PATTERN.test(combined);
  const mentionsHindi = /\bhindi\b/.test(combined);
  const mentionsEnglish = /\benglish\b/.test(combined);

  if (language === "en") {
    if (mentionsEnglish) return LANGUAGE_MATCH_WEIGHT;
    // English is the metadata default; Hindi evidence suggests otherwise.
    if (hasDevanagari || mentionsHindi) return LANGUAGE_MATCH_WEIGHT * 0.2;
    return LANGUAGE_MATCH_WEIGHT * 0.8;
  }

  if (language === "hi") {
    if (hasDevanagari) return LANGUAGE_MATCH_WEIGHT;
    if (mentionsHindi) return LANGUAGE_MATCH_WEIGHT * 0.9;
    // Hindi audio frequently ships with English metadata: keep partial credit.
    return LANGUAGE_MATCH_WEIGHT * 0.3;
  }

  if (language === "hinglish") {
    // Indian educators mark Hindi-English mixtures with "hindi" mentions or
    // Devanagari text; the AI also writes hinglish queries, which the
    // titleMatch component already rewards.
    if (mentionsHindi || hasDevanagari) return LANGUAGE_MATCH_WEIGHT;
    return LANGUAGE_MATCH_WEIGHT * 0.3;
  }

  // Other BCP-47 codes (public search API): cannot verify from metadata.
  return LANGUAGE_MATCH_WEIGHT;
}

function parseTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundBreakdown(breakdown: RelevanceScoreBreakdown): RelevanceScoreBreakdown {
  return {
    topicMatch: round1(breakdown.topicMatch),
    titleMatch: round1(breakdown.titleMatch),
    descriptionMatch: round1(breakdown.descriptionMatch),
    educationalSignals: round1(breakdown.educationalSignals),
    durationFit: round1(breakdown.durationFit),
    levelFit: round1(breakdown.levelFit),
    languageMatch: round1(breakdown.languageMatch),
  };
}
