import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import type { LlmConfig, LlmProvider } from "../types.js";
import { fetchWithTimeout } from "../util/http.js";
import { optionalSecret, resolveSecret } from "../util/secrets.js";

const LLM_TIMEOUT_MS = 60_000;
const LLM_MAX_OUTPUT_TOKENS = 8000;

export type LlmClient = {
  provider: LlmProvider;
  model: string;
  generate(prompt: string): Promise<string>;
};

export function createLlmClient(config: LlmConfig = {}): LlmClient {
  const provider = config.provider ?? "gemini";

  if (provider === "gemini") {
    const apiKey = resolveSecret(config.apiKey, "Gemini API key");
    const model = config.model ?? "gemini-2.5-flash-lite";
    const ai = new GoogleGenAI({ apiKey });
    return {
      provider,
      model,
      async generate(prompt) {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        });
        const text = response.text;
        if (!text?.trim()) {
          throw new Error("Gemini returned an empty response.");
        }
        return text;
      },
    };
  }

  if (provider === "openai") {
    const model = config.model ?? "gpt-5.4-mini";
    return {
      provider,
      model,
      async generate(prompt) {
        const apiKey = resolveSecret(config.apiKey, "OpenAI API key");
        const response = await fetchWithTimeout(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              input: prompt,
              text: {
                format: { type: "json_object" },
              },
            }),
          },
          { timeoutMs: LLM_TIMEOUT_MS }
        );

        const data = (await response.json().catch(() => null)) as {
          output_text?: string;
          error?: { message?: string };
        } | null;
        if (!response.ok) {
          throw new Error(`OpenAI request failed (${response.status}): ${data?.error?.message ?? JSON.stringify(data)}`);
        }
        if (!data?.output_text?.trim()) {
          throw new Error("OpenAI returned an empty response.");
        }
        return data.output_text;
      },
    };
  }

  if (provider === "anthropic") {
    const apiKey = optionalSecret(config.apiKey);
    const authToken = optionalSecret(config.authToken);
    const model = config.model ?? "claude-sonnet-4-5";
    if (!apiKey && !authToken) {
      throw new Error(
        "Missing Anthropic API key or auth token. Run usp setup to store one."
      );
    }
    // The official SDK handles request timeouts and exponential-backoff retry on
    // 429/5xx/overloaded with typed errors — no need to hand-roll any of it.
    const client = new Anthropic({
      ...(apiKey ? { apiKey } : {}),
      ...(authToken ? { authToken } : {}),
      timeout: LLM_TIMEOUT_MS,
      maxRetries: 2,
    });
    return {
      provider,
      model,
      async generate(prompt) {
        // No `temperature`: it is removed on current Opus models and would 400
        // if a user selects one; prompting drives the JSON-only behavior instead.
        const message = await client.messages.create({
          model,
          max_tokens: LLM_MAX_OUTPUT_TOKENS,
          system: "Return only valid JSON. No Markdown fences. No commentary.",
          messages: [{ role: "user", content: prompt }],
        });
        const text = message.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("")
          .trim();
        if (!text) {
          throw new Error("Anthropic returned an empty response.");
        }
        return text;
      },
    };
  }

  throw new Error(`Unsupported LLM provider: ${provider satisfies never}`);
}
