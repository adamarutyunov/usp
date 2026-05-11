import type { Platform } from "../types.js";
import { buildPrompt, DEFAULT_PLATFORM_PROMPTS } from "../llm/prompts.js";
import { PromptProvider, type PromptRequest } from "../pipeline/contracts.js";

export type PromptOverrideMode = "replace" | "append";

export type PromptOverride = {
  platform: Platform;
  mode: PromptOverrideMode;
  text: string;
};

export function parsePromptOverride(value: string): PromptOverride {
  const [rawPlatform, rawModeOrText, ...rest] = value.split(":");
  if (!rawPlatform || !rawModeOrText) {
    throw new Error(`Invalid --prompt "${value}". Expected platform[:append|replace]:text.`);
  }
  if (!["x", "linkedin", "reddit", "telegram"].includes(rawPlatform)) {
    throw new Error(`Invalid --prompt platform "${rawPlatform}".`);
  }
  const hasExplicitMode = rawModeOrText === "append" || rawModeOrText === "replace";
  const mode = hasExplicitMode ? rawModeOrText : "replace";
  const promptText = hasExplicitMode ? rest.join(":") : [rawModeOrText, ...rest].join(":");
  if (!promptText.trim()) {
    throw new Error(`Invalid --prompt "${value}". Prompt text is empty.`);
  }
  return {
    platform: rawPlatform as Platform,
    mode,
    text: promptText,
  };
}

export class ConfigPromptProvider extends PromptProvider {
  private readonly overrides = new Map<Platform, PromptOverride>();

  constructor(overrides: PromptOverride[] = []) {
    super();
    for (const override of overrides) {
      this.overrides.set(override.platform, override);
    }
  }

  build(request: PromptRequest): string {
    const platform = request.platform;
    const configuredPrompt = request.target.prompt ?? request.config.prompts?.[platform];
    const basePrompt = configuredPrompt || DEFAULT_PLATFORM_PROMPTS[platform];
    const override = this.overrides.get(platform);
    const customPrompt = override
      ? override.mode === "append"
        ? [basePrompt, "", override.text].join("\n")
        : override.text
      : configuredPrompt;

    return buildPrompt({
      input: request.input,
      platform,
      target: request.target,
      customPrompt,
    });
  }
}
