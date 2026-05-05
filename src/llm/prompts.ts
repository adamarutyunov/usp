import type { MarkdownInput, Platform, TargetConfig } from "../types.js";

const SHARED_RULES = [
  "You convert Markdown into a platform-native social posting plan.",
  "Return only valid JSON. No Markdown fences. No commentary.",
  "The output schema is: {\"title\":\"optional title\",\"units\":[{\"text\":\"post text\",\"mediaRefs\":[\"img1\"]}]}",
  "Use only mediaRefs that appear in the source. Preserve the intended ordering of images by attaching each image to the exact unit where it belongs.",
  "Do not invent facts. Do not mention that the content came from Markdown.",
  "Keep the voice concrete, useful, and non-hypey.",
  "No emojis unless present in the source.",
];

export const DEFAULT_PLATFORM_PROMPTS: Record<Platform, string> = {
  x: [
    ...SHARED_RULES,
    "Platform: X.",
    "Create one tweet or a concise thread. Each unit must be at most 280 characters.",
    "Attach images to the specific tweet they support, not automatically to the first or last tweet.",
    "Avoid hashtags unless they are clearly useful or already present.",
  ].join("\n"),
  linkedin: [
    ...SHARED_RULES,
    "Platform: LinkedIn personal profile.",
    "Create a professional post that can stand alone in a feed.",
    "Prefer one unit unless image ordering or length makes multiple units necessary.",
    "Keep it clear and specific; avoid corporate filler.",
  ].join("\n"),
  reddit: [
    ...SHARED_RULES,
    "Platform: Reddit.",
    "Create a subreddit-appropriate title and one self-post body.",
    "The title must be no more than 300 characters.",
    "Avoid marketing language. Make the post useful for discussion.",
    "For mediaRefs, include only images that are important context for the post.",
  ].join("\n"),
  telegram: [
    ...SHARED_RULES,
    "Platform: Telegram channel or chat.",
    "Create direct channel copy. Multiple units are allowed when images should be sent as separate messages.",
    "Each unit must be at most 4096 characters.",
    "Keep links and concrete details intact.",
  ].join("\n"),
};

export function buildPrompt({
  input,
  platform,
  target,
  customPrompt,
}: {
  input: MarkdownInput;
  platform: Platform;
  target: TargetConfig;
  customPrompt?: string;
}) {
  const prompt = customPrompt || DEFAULT_PLATFORM_PROMPTS[platform];
  const mediaCatalog =
    input.media.length === 0
      ? "No images."
      : input.media
          .map((item) => `- ${item.id}: ${item.rawPath}${item.alt ? `, alt: ${item.alt}` : ""}`)
          .join("\n");

  return [
    prompt,
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
