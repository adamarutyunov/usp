import { GoogleGenAI } from "@google/genai";
import type { LlmConfig, LlmProvider } from "../types.js";
import { resolveSecret } from "../util/secrets.js";

export type LlmClient = {
  provider: LlmProvider;
  model: string;
  generate(prompt: string): Promise<string>;
};

export function createLlmClient(config: LlmConfig = {}): LlmClient {
  const provider = config.provider ?? "gemini";

  if (provider === "gemini") {
    const apiKey = resolveSecret(config.apiKey, config.apiKeyEnv, "Gemini API key", "GEMINI_API_KEY");
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
    const apiKey = resolveSecret(config.apiKey, config.apiKeyEnv, "OpenAI API key", "OPENAI_API_KEY");
    const model = config.model ?? "gpt-5.4-mini";
    return {
      provider,
      model,
      async generate(prompt) {
        const response = await fetch("https://api.openai.com/v1/responses", {
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
        });

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

  throw new Error(`Unsupported LLM provider: ${provider satisfies never}`);
}
