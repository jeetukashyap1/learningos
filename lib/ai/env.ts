/**
 * NVIDIA NIM API configuration.
 *
 * Like the YouTube key, the NVIDIA key is OPTIONAL: when it is missing the
 * rest of the app keeps working and only AI learning-path generation is
 * unavailable. That is why this accessor returns null instead of throwing -
 * the generation service turns a missing key into a controlled config error
 * at the point of use, so no unrelated page or route can ever crash over it.
 *
 * Server-side only: read here and never exposed to the browser.
 */

const NVIDIA_API_KEY_NAME = "NVIDIA_API_KEY";

/**
 * Returns the server-side NVIDIA NIM API key, or null when it is not set.
 */
export function getNvidiaApiKey(): string | null {
  const apiKey = process.env[NVIDIA_API_KEY_NAME];
  const trimmed = apiKey?.trim();
  return trimmed ? trimmed : null;
}
