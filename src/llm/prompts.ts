import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MarkdownInput, Platform, PromptLayer, TargetConfig } from "../types.js";

// Prompt text lives in ./prompts/*.md (copied to dist on build), read once at load.
const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");

function readPrompt(...segments: string[]): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, ...segments), "utf8").trim();
}

const PLATFORMS: Platform[] = ["x", "linkedin", "reddit", "telegram", "aegea", "bluesky", "mastodon", "discord", "threads"];

// Platforms whose posts are split into a hard-limited thread; they share the thread rules.
const THREAD_PLATFORMS = new Set<Platform>(["x", "bluesky", "mastodon", "threads"]);

// Layer 1 — the fixed base guidance. Always applied; shown read-only in the global-prompt editor.
export const BASE_GUIDANCE = readPrompt("base.md");

// Output contract — structural, machine-facing. Always enforced, even when an override replaces the guidance.
const OUTPUT_CONTRACT = readPrompt("output-contract.md");

// Layer 2 — per-platform rules. This is what the setup UI shows and edits.
const THREAD_RULES = readPrompt("thread-rules.md");
export const DEFAULT_PLATFORM_PROMPTS = Object.fromEntries(
  PLATFORMS.map((platform) => {
    const rules = readPrompt("platforms", `${platform}.md`);
    return [platform, THREAD_PLATFORMS.has(platform) ? `${rules}\n\n${THREAD_RULES}` : rules];
  })
) as Record<Platform, string>;

/**
 * Compose the guidance the model sees from up to three layers:
 * - Layer 1: base guidance (hidden, always on unless a target override replaces it).
 * - Layer 2: per-platform rules, optionally amended by a platform-level override.
 * - Layer 3: a target-level override (append after 1 + 2, or replace everything).
 * The output contract is added separately and always applies.
 */
export function composeGuidance(
  platform: Platform,
  options: { globalAppend?: string; platformOverride?: PromptLayer; targetOverride?: PromptLayer } = {}
) {
  const { globalAppend, platformOverride, targetOverride } = options;
  const targetText = targetOverride?.text?.trim();
  if (targetText && targetOverride?.mode === "replace") {
    return targetText;
  }

  let platformRules = DEFAULT_PLATFORM_PROMPTS[platform];
  const platformText = platformOverride?.text?.trim();
  if (platformText) {
    platformRules = platformOverride?.mode === "replace" ? platformText : `${platformRules}\n\n${platformText}`;
  }

  const layers = [BASE_GUIDANCE];
  if (globalAppend?.trim()) {
    layers.push(`# Custom Global Prompt\n\n${globalAppend.trim()}`);
  }
  layers.push(`# Platform Instructions\n\n${platformRules}`);
  if (targetText) {
    layers.push(`# Target Instructions\n\n${targetText}`);
  }
  return layers.join("\n\n");
}

export function buildPrompt({
  input,
  platform,
  target,
  globalAppend,
  platformOverride,
  targetOverride,
}: {
  input: MarkdownInput;
  platform: Platform;
  target: TargetConfig;
  globalAppend?: string;
  platformOverride?: PromptLayer;
  targetOverride?: PromptLayer;
}) {
  const mediaCatalog =
    input.media.length === 0
      ? "No images."
      : input.media
          .map((item) => `- ${item.id}: ${item.rawPath}${item.alt ? `, alt: ${item.alt}` : ""}`)
          .join("\n");

  return [
    composeGuidance(platform, { globalAppend, platformOverride, targetOverride }),
    "",
    OUTPUT_CONTRACT,
    "",
    "Target context:",
    JSON.stringify(
      {
        platform,
        subreddit: target.subreddit,
        chatId: target.chatId,
      },
      null,
      2
    ),
    "",
    "Media catalog:",
    mediaCatalog,
    "",
    "Source Markdown with media placeholders:",
    input.bodyWithMediaPlaceholders,
  ].join("\n");
}
