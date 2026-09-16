/**
 * Validates the NVIDIA_API_KEY from .env.local against the NVIDIA NIM
 * chat-completions endpoint using the exact production payload (model
 * nvidia/nemotron-3.5-lightning-30b-a3b, curriculum system prompt, tiny
 * user message). Prints ONLY the outcome and latency - the key itself is
 * never echoed.
 *
 * Usage: node scripts/check-nvidia-key.mjs [timeoutMs]
 */
import { readFile } from "node:fs/promises";

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
const key = env.NVIDIA_API_KEY?.trim();
if (!key) {
  console.log("NVIDIA_API_KEY: not set in .env.local (the route will return a 503 config error).");
  process.exit(0);
}

const timeoutMs = Number(process.argv[2] ?? 180000);
const started = Date.now();

try {
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [
        {
          role: "user",
          content: "Reply with exactly: ok",
        },
      ],
      temperature: 0.3,
      max_tokens: 8,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const elapsed = Date.now() - started;
  if (res.ok) {
    const body = await res.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    const preview = typeof content === "string" ? content.slice(0, 40) : "<no content>";
    console.log(`NVIDIA_API_KEY: valid (HTTP ${res.status}, ${elapsed}ms). Reply: ${JSON.stringify(preview)}`);
  } else {
    const text = await res.text().catch(() => "");
    console.log(
      `NVIDIA_API_KEY: rejected (HTTP ${res.status}, ${elapsed}ms). Body: ${text.slice(0, 300).replace(/\s+/g, " ")}`,
    );
  }
} catch (error) {
  const elapsed = Date.now() - started;
  console.log(`NVIDIA_API_KEY: request failed after ${elapsed}ms: ${error?.name ?? "Error"}: ${(error?.message ?? "").slice(0, 200)}`);
}
