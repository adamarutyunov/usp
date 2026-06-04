import type { Platform, PromptLayer } from "../types.js";
import { buildPrompt } from "../llm/prompts.js";
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
  if (!["x", "linkedin", "reddit", "telegram", "aegea", "bluesky", "mastodon", "discord", "threads"].includes(rawPlatform)) {
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
    return buildPrompt({
      input: request.input,
      platform,
      target: request.target,
      override: this.resolveOverride(request),
    });
  }

  // Layer 3 precedence: CLI --prompt > per-target prompt > configured prompt.
  private resolveOverride(request: PromptRequest): PromptLayer | undefined {
    const cli = this.overrides.get(request.platform);
    if (cli) {
      return { mode: cli.mode, text: cli.text };
    }
    if (request.target.prompt) {
      return { mode: "replace", text: request.target.prompt };
    }
    return request.config.prompts?.[request.platform];
  }
}
