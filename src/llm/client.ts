import { GoogleGenAI } from "@google/genai";
import type { LlmConfig, LlmProvider } from "../types.js";
import { optionalSecret, resolveSecret } from "../util/secrets.js";
import { readCodexOpenAiCredential } from "./auth.js";

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
    const model = config.model ?? "gpt-5.4-mini";
    return {
      provider,
      model,
      async generate(prompt) {
        const credential =
          config.authSource === "codex"
            ? await readCodexOpenAiCredential()
            : {
                kind: "apiKey" as const,
                value: resolveSecret(config.apiKey, config.apiKeyEnv, "OpenAI API key", "OPENAI_API_KEY"),
              };
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.value}`,
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

  if (provider === "anthropic") {
    const apiKey = optionalSecret(config.apiKey, config.apiKeyEnv, "ANTHROPIC_API_KEY");
    const authToken = optionalSecret(config.authToken, config.authTokenEnv, "ANTHROPIC_AUTH_TOKEN");
    const model = config.model ?? "claude-sonnet-4-5";
    if (!apiKey && !authToken) {
      throw new Error(
        "Missing Anthropic API key or auth token. Provide ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or paste a Claude setup-token result in usp setup."
      );
    }
    return {
      provider,
      model,
      async generate(prompt) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            ...(apiKey ? { "x-api-key": apiKey } : {}),
            ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2000,
            temperature: 0.3,
            system: "Return only valid JSON. No Markdown fences. No commentary.",
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        });

        const data = (await response.json().catch(() => null)) as {
          content?: Array<{ type?: string; text?: string }>;
          error?: { message?: string };
        } | null;
        if (!response.ok) {
          throw new Error(
            `Anthropic request failed (${response.status}): ${data?.error?.message ?? JSON.stringify(data)}`
          );
        }
        const text = data?.content
          ?.filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
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
