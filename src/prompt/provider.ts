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
    return buildPrompt({
      input: request.input,
      platform: request.platform,
      target: request.target,
      // Layer 1 addition: user's global rules.
      globalAppend: request.config.globalPrompt,
      // Layer 2 amendment: a platform-level override from config.
      platformOverride: request.config.prompts?.[request.platform],
      // Layer 3: a CLI --prompt (this run) wins over the target's own prompt.
      targetOverride: this.resolveTargetOverride(request),
    });
  }

  private resolveTargetOverride(request: PromptRequest): PromptLayer | undefined {
    const cli = this.overrides.get(request.platform);
    if (cli) {
      return { mode: cli.mode, text: cli.text };
    }
    return request.target.prompt;
  }
}
