import type { MarkdownInput, Platform, PromptLayer, TargetConfig } from "../types.js";

// Layer 1 — the task and the quality bar. Always applied, never shown in the UI.
const BASE_GUIDANCE = [
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
 * Compose the guidance the model sees, per the override mode:
 * - none/append: layer 1 + layer 2 (+ layer 3 when appending)
 * - replace: layer 3 only
 * The output contract is added separately and always applies.
 */
export function composeGuidance(platform: Platform, override?: PromptLayer) {
  const text = override?.text?.trim();
  if (text && override?.mode === "replace") {
    return text;
  }
  const layers = [BASE_GUIDANCE, DEFAULT_PLATFORM_PROMPTS[platform]];
  if (text) {
    layers.push(text);
  }
  return layers.join("\n\n");
}

export function buildPrompt({
  input,
  platform,
  target,
  override,
}: {
  input: MarkdownInput;
  platform: Platform;
  target: TargetConfig;
  override?: PromptLayer;
}) {
  const mediaCatalog =
    input.media.length === 0
      ? "No images."
      : input.media
          .map((item) => `- ${item.id}: ${item.rawPath}${item.alt ? `, alt: ${item.alt}` : ""}`)
          .join("\n");

  return [
    composeGuidance(platform, override),
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
