/**
 * NVIDIA NIM client (OpenAI-compatible chat completions).
 *
 * Plain fetch - the project deliberately has no AI SDK dependency. The API
 * key is read server-side only (lib/ai/env.ts) and every failure maps to an
 * AiError whose safeMessage never leaks the key, the model endpoint, or raw
 * upstream bodies to the browser.
 */

import { AiError } from "./errors";
import { getNvidiaApiKey } from "./env";

const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/** Model chosen for this integration (kept in one place for observability). */
export const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

const REQUEST_TIMEOUT_MS = 260_000;
// The curriculum contract now nests lessons inside modules and adds the
// final outcome, so a full 12-lesson answer needs more room than the flat
// contract did - observed NVIDIA latency for the nested curriculum ranges
// from ~2 minutes to well over 4 minutes, so the request budget is 260s.
// It stays under the ~300s headers timeout of API clients, leaving room
// for the route's DB writes and YouTube attach before responding. The
// token cap stays generous because a truncated reply would corrupt the
// strict-JSON contract and burn a retry.
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.3;

export interface NvidiaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Sends one non-streaming chat completion and returns the assistant message
 * content. Throws AiError (config / rate_limit / timeout / network / api)
 * with safe user-facing messages.
 */
export async function nvidiaChatCompletion(messages: NvidiaChatMessage[]): Promise<string> {
  const apiKey = getNvidiaApiKey();
  if (!apiKey) {
    throw new AiError("config", "AI path generation is not configured on this server.");
  }

  let response: Response;
  try {
    response = await fetch(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: false,
        // Nemotron is a hybrid reasoning model: by default it emits a long
        // inline "thinking process" before the answer, which burns the whole
        // completion budget and truncates the strict-JSON curriculum. The
        // curriculum prompt is fully specified, so thinking is disabled to
        // keep responses complete, valid, and fast.
        chat_template_kwargs: { thinking: false },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AiError("timeout", "Path generation took too long. Please try again.", describe(error));
    }
    throw new AiError("network", "Could not reach the AI service. Please try again.", describe(error));
  }

  if (response.status === 401 || response.status === 403) {
    throw new AiError("config", "AI path generation is not configured on this server.", `status ${response.status}`);
  }
  if (response.status === 429) {
    throw new AiError("rate_limit", "The AI service is busy right now. Please try again in a moment.", "status 429");
  }
  if (!response.ok) {
    throw new AiError("api", "The AI service returned an error. Please try again.", `status ${response.status} ${await safeBody(response)}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AiError("api", "The AI service returned an unreadable response. Please try again.", describe(error));
  }

  const content = extractContent(body);
  if (!content) {
    throw new AiError("api", "The AI service returned an empty response. Please try again.");
  }
  return content;
}

/** Extracts choices[0].message.content defensively from an unknown body. */
function extractContent(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) {
    return null;
  }
  const choice = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return null;
  }
  const content = choice.message.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }
  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Server-side detail only - never returned to the browser. */
async function safeBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500).replace(/\s+/g, " ").trim();
  } catch {
    return "<unreadable body>";
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
