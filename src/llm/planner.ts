import type {
  MarkdownInput,
  Platform,
  PlatformPlan,
  PublishPlan,
  TargetConfig,
  UspConfig,
} from "../types.js";
import { parseJsonObject } from "../util/json.js";
import type { LlmClient } from "./client.js";
import { buildPrompt } from "./prompts.js";

const PLATFORM_TEXT_LIMITS: Partial<Record<Platform, number>> = {
  x: 280,
  bluesky: 300,
  mastodon: 500,
  telegram: 4096,
  discord: 2000,
};

function splitText(text: string, limit: number) {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const cut = remaining.lastIndexOf(" ", limit - 4);
    const index = cut > limit * 0.6 ? cut : limit - 4;
    chunks.push(`${remaining.slice(0, index).trim()}...`);
    remaining = remaining.slice(index).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export function normalizePlan(platform: Platform, raw: unknown, availableMedia: Set<string>): PlatformPlan {
  const value = raw as { title?: unknown; units?: Array<{ text?: unknown; mediaRefs?: unknown }> };
  const sourceUnits = Array.isArray(value.units) ? value.units : [];
  const units = sourceUnits
    .map((unit) => ({
      text: String(unit.text ?? "").trim(),
      mediaRefs: Array.isArray(unit.mediaRefs)
        ? unit.mediaRefs.map(String).filter((id) => availableMedia.has(id))
        : [],
    }))
    .filter((unit) => unit.text || (unit.mediaRefs?.length ?? 0) > 0);

  const limit = PLATFORM_TEXT_LIMITS[platform];
  const limitedUnits = limit
    ? units.flatMap((unit) => {
        const chunks = splitText(unit.text, limit);
        return chunks.map((chunk, index) => ({
          text: chunk,
          mediaRefs: index === 0 ? unit.mediaRefs : [],
        }));
      })
    : units;

  if (limitedUnits.length === 0) {
    throw new Error(`LLM returned no publishable units for ${platform}.`);
  }

  return {
    title: typeof value.title === "string" ? value.title.trim().slice(0, 300) : undefined,
    units: limitedUnits,
  };
}

export async function buildPlatformPlan({
  input,
  config,
  target,
  llm,
}: {
  input: MarkdownInput;
  config: UspConfig;
  target: { id: string; config: TargetConfig };
  llm: LlmClient;
}): Promise<PlatformPlan> {
  const mediaIds = new Set(input.media.map((item) => item.id));
  const platform = target.config.platform;
  const prompt = buildPrompt({
    input,
    platform,
    target: target.config,
    customPrompt: target.config.prompt ?? config.prompts?.[platform],
  });
  const response = await llm.generate(prompt);
  return normalizePlan(platform, parseJsonObject(response), mediaIds);
}

export async function buildPublishPlan({
  input,
  config,
  targets,
  llm,
}: {
  input: MarkdownInput;
  config: UspConfig;
  targets: Array<{ id: string; config: TargetConfig }>;
  llm: LlmClient;
}): Promise<PublishPlan> {
  const platforms: PublishPlan["platforms"] = {};

  for (const target of targets) {
    const platform = target.config.platform;
    if (platforms[platform]) {
      continue;
    }

    platforms[platform] = await buildPlatformPlan({
      input,
      config,
      target,
      llm,
    });
  }

  return {
    source: {
      inputPath: input.inputPath,
      title: input.title,
    },
    media: input.media.map(({ id, alt, rawPath, mime, size }) => ({ id, alt, rawPath, mime, size })),
    platforms,
  };
}
