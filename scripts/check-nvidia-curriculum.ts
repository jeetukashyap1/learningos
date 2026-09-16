/**
 * Full-fidelity probe of the production NVIDIA curriculum call.
 *
 * Sends the REAL system prompt (lib/ai/prompt.ts) and a REAL learner
 * profile with the REAL request parameters, then a thinking-disabled
 * variant, and prints timing, usage, and content shape so generation
 * timeouts can be diagnosed without touching the app. The returned
 * content is also run through the REAL production validator
 * (lib/ai/validate.ts), so the probe answers exactly the question the
 * generate route asks: would this output be accepted? The API key is
 * never printed.
 *
 * Usage: npx tsx scripts/check-nvidia-curriculum.ts [timeoutMs] [variant]
 *        variant = "both" (default) | "production" | "thinking-off"
 */
import { readFile, writeFile } from "node:fs/promises";
import { buildCurriculumMessages } from "../lib/ai/prompt";
import { validateCurriculum } from "../lib/ai/validate";

let key: string | undefined;

async function loadKey(): Promise<void> {
  const envFile = await readFile(".env.local", "utf8");
  const env = Object.fromEntries(
    envFile
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const eq = line.indexOf("=");
        return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
      }),
  );
  key = env.NVIDIA_API_KEY?.trim();
}

const timeoutMs = Number(process.argv[2] ?? 180000);

const profile = {
  topic: "Web development",
  currentLevel: "building" as const,
  dailyTime: "30" as const,
  goalType: "career" as const,
  videoLanguage: "en" as const,
};
const { system, user } = buildCurriculumMessages(profile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function probe(label: string, extra: Record<string, unknown> | undefined): Promise<void> {
  const started = Date.now();
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        stream: false,
        ...(extra ?? {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsed = Date.now() - started;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.log(`[${label}] HTTP ${response.status} after ${elapsed}ms: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
      return;
    }

    const body: unknown = await response.json().catch(() => null);
    const choice = isRecord(body) && Array.isArray(body.choices) ? body.choices[0] : null;
    const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
    const content = typeof message?.content === "string" ? message.content : "";
    const finishReason = isRecord(choice) ? String(choice.finish_reason) : "unknown";
    console.log(`[${label}] HTTP ${response.status} after ${elapsed}ms; finish_reason=${finishReason}; usage=${JSON.stringify(isRecord(body) ? body.usage : null)}`);
    console.log(`[${label}] content length: ${content.length}`);
    console.log(`[${label}] head: ${JSON.stringify(content.slice(0, 200))}`);
    console.log(`[${label}] tail: ${JSON.stringify(content.slice(-200))}`);

    // Keep the raw answer on disk so a rejection can be inspected offline.
    await writeFile("scripts/.probe-content.txt", content, "utf8");

    const validation = validateCurriculum(content, profile);
    if (validation.ok) {
      console.log(
        `[${label}] production validation: OK (modules=${validation.curriculum.modules.length}, outcome=${JSON.stringify(validation.curriculum.final_outcome.kind)}, lessons=${validation.curriculum.modules.reduce((n, m) => n + m.lessons.length, 0)})`,
      );
    } else {
      console.log(`[${label}] production validation: REJECT (${validation.reason})`);
      if (validation.reason === "the response is not valid JSON") {
        // Mirror extractJson's think-strip, then report the exact parse
        // error position and a window around it for diagnosis.
        let text = content.trim();
        const thinkEnd = text.lastIndexOf("</think>");
        if (thinkEnd >= 0) {
          text = text.slice(thinkEnd + "</think>".length).trim();
          console.log(`[${label}] note: content contained </think> at offset ${thinkEnd}`);
        }
        try {
          JSON.parse(text);
        } catch (error) {
          const message = (error as Error).message;
          const positionMatch = message.match(/position (\d+)/);
          console.log(`[${label}] direct parse error: ${message}`);
          if (positionMatch) {
            const position = Number(positionMatch[1]);
            console.log(`[${label}] context around position ${position}:`);
            console.log(JSON.stringify(text.slice(Math.max(0, position - 150), position + 150)));
          }
        }
      }
    }
  } catch (error) {
    console.log(`[${label}] request failed after ${Date.now() - started}ms: ${(error as Error)?.name}: ${(error as Error)?.message?.slice(0, 150)}`);
  }
}

async function main(): Promise<void> {
  await loadKey();
  if (!key) {
    console.log("NVIDIA_API_KEY: not set in .env.local.");
    return;
  }
  // Variant filter (argv[3]): "both" (default) | "production" | "thinking-off".
  const variant = process.argv[3] ?? "both";
  if (variant === "both" || variant === "production") {
    await probe("production-exact", undefined);
  }
  if (variant === "both" || variant === "thinking-off") {
    await probe("thinking-off", { chat_template_kwargs: { thinking: false } });
  }
}

void main();
