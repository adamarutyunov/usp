import type { MarkdownInput, Platform, PromptLayer, TargetConfig } from "../types.js";

// Layer 1 — the task and the quality bar. Always applied; shown read-only in the global-prompt editor.
export const BASE_GUIDANCE = [
  "Turn the source into copy that is ready to post on social media.",
  "Stay faithful to it: no invented facts, no hype, no emojis unless the source already uses them.",
  "Be concrete and useful. Never mention that the source was Markdown.",
].join("\n");

// Output contract — structural, machine-facing. Always enforced, even when an override replaces the guidance.
const OUTPUT_CONTRACT = [
  'Return only valid JSON: {"title":"optional title","units":[{"text":"post text","mediaRefs":["img1"]}]}',
  "No code fences, no commentary.",
  "Use only media ids from the catalog, attach each to the unit it belongs to, and keep their order.",
].join("\n");

// Layer 2 — per-platform rules. This is what the setup UI shows and edits.
export const DEFAULT_PLATFORM_PROMPTS: Record<Platform, string> = {
  x: [
    "X: one tweet or a tight thread, at most 280 characters per unit.",
    "Attach each image to the tweet it supports. Hashtags only when already present or clearly useful.",
  ].join("\n"),
  linkedin: [
    "LinkedIn personal post: clear and specific, no corporate filler.",
    "One unit unless length or image order needs more.",
  ].join("\n"),
  reddit: [
    "Reddit self-post: a discussion-worthy title (at most 300 characters) and one body.",
    "No marketing. Attach only images that add real context.",
  ].join("\n"),
  telegram: [
    "Telegram channel: direct copy, at most 4096 characters per unit.",
    "Split into units when images should send as separate messages. Keep links intact.",
  ].join("\n"),
  aegea: [
    "Aegea blog: a title and body units.",
    "Start a new unit wherever an image should appear, and attach that image to the unit it follows.",
    "Do not shorten unless the source repeats itself.",
  ].join("\n"),
  bluesky: [
    "Bluesky: one post or a tight thread, at most 300 characters per unit.",
    "Attach each image to the post it supports, in order. Hashtags only when already present or clearly useful.",
  ].join("\n"),
  mastodon: [
    "Mastodon: one status or a short reply thread, at most 500 characters per unit unless the source needs more.",
    "Attach each image to the status it supports, in order. Keep it plain and instance-portable.",
  ].join("\n"),
  discord: [
    "Discord channel: direct copy, at most 2000 characters per unit.",
    "Split into units when images should send as separate messages. Keep links and code intact.",
  ].join("\n"),
  threads: [
    "Threads: one post or a short reply chain, at most 500 characters per unit.",
    "Attach remote images or videos to the post they support; never local-only media. Hashtags only when present or clearly useful.",
  ].join("\n"),
};

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
    layers.push(globalAppend.trim());
  }
  layers.push(platformRules);
  if (targetText) {
    layers.push(targetText);
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
