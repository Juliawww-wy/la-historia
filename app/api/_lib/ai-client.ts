import OpenAI from "openai";

export interface ApiConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  label: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

/**
 * Builds an OpenAI-compatible client + model name for this request.
 *
 * - If the caller supplied a valid apiConfig (from the settings sheet in
 *   the UI), we use THEIR baseURL / apiKey / model — the request goes
 *   straight from our server to their chosen provider, key is never
 *   persisted server-side.
 * - Otherwise we fall back to the platform default (DeepSeek, via env var).
 */
export function resolveClient(apiConfig: unknown): {
  client: OpenAI;
  model: string;
  usingCustom: boolean;
} {
  if (isValidApiConfig(apiConfig)) {
    return {
      client: new OpenAI({
        apiKey: apiConfig.apiKey,
        baseURL: apiConfig.baseURL,
      }),
      model: apiConfig.model,
      usingCustom: true,
    };
  }

  return {
    client: new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: DEFAULT_BASE_URL,
    }),
    model: DEFAULT_MODEL,
    usingCustom: false,
  };
}

function isValidApiConfig(value: unknown): value is ApiConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.baseURL === "string" &&
    v.baseURL.trim() !== "" &&
    typeof v.apiKey === "string" &&
    v.apiKey.trim() !== "" &&
    typeof v.model === "string" &&
    v.model.trim() !== ""
  );
}
