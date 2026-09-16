/**
 * Curriculum generation with retry-on-invalid-output (spec part 6).
 *
 * Transient provider failures (network, timeout, rate limit, HTTP errors)
 * surface immediately as AiError - the onboarding answers stay saved and the
 * UI can offer a retry. Only INVALID output is retried here: the model gets
 * its previous answer plus the concrete validation reason back and must
 * answer again with valid JSON.
 */

import { nvidiaChatCompletion, NVIDIA_MODEL } from "./client";
import { buildCurriculumMessages } from "./prompt";
import { validateCurriculum } from "./validate";
import { AiError } from "./errors";
import type { AiCurriculum, OnboardingProfile } from "./curriculum";

const MAX_ATTEMPTS = 4;

export interface GeneratedCurriculum {
  curriculum: AiCurriculum;
  model: string;
}

/**
 * Generates a validated personalized curriculum from the learner's real
 * onboarding answers. Throws AiError with safe messages on any failure.
 */
export async function generateCurriculum(profile: OnboardingProfile): Promise<GeneratedCurriculum> {
  const { system, user } = buildCurriculumMessages(profile);
  // Each retry starts from the clean system+user conversation. When the
  // model degenerates mid-output (observed in production: broken JSON
  // syntax followed by hallucinated tool-call schemas), feeding its own
  // corrupted answer back into the history makes every retry imitate the
  // corruption, so the retry feedback travels as a note appended to the
  // user message instead.
  let retryNote = "";

  let lastReason = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = await nvidiaChatCompletion([
      { role: "system", content: system },
      { role: "user", content: user + retryNote },
    ]);
    const validation = validateCurriculum(raw, profile);
    if (validation.ok) {
      return { curriculum: validation.curriculum, model: NVIDIA_MODEL };
    }
    lastReason = validation.reason;
    retryNote += `\n\nYour previous response was rejected: ${validation.reason}. Respond again with ONLY one valid JSON object matching the required schema - strictly valid JSON, no markdown fences, no tool-call schemas, no content after the closing brace.`;
  }

  throw new AiError(
    "invalid_output",
    "The AI could not produce a valid learning path. Please try again.",
    `curriculum validation failed after ${MAX_ATTEMPTS} attempts; last reason: ${lastReason}`,
  );
}
