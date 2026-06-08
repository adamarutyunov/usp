import type { Platform, PlatformPlan } from "../types.js";

const PLATFORM_TEXT_LIMITS: Partial<Record<Platform, number>> = {
  x: 280,
  bluesky: 300,
  mastodon: 500,
  telegram: 4096,
  discord: 2000,
  threads: 500,
};

const ELLIPSIS = "...";

/** Split text into grapheme clusters so we never cut a surrogate pair or combined emoji in half. */
function toGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text); // code-point fallback — still surrogate-safe
}

function isWhitespace(grapheme: string | undefined) {
  return grapheme !== undefined && /\s/.test(grapheme);
}

/**
 * Split text into chunks no longer than `limit` graphemes, breaking on whitespace
 * where possible so words and URLs stay intact, and never cutting mid-grapheme.
 * Non-final chunks reserve room for the trailing ellipsis so the result still fits.
 */
function splitText(text: string, limit: number): string[] {
  const trimmed = text.trim();
  const graphemes = toGraphemes(trimmed);
  if (graphemes.length <= limit) {
    return [trimmed];
  }

  const windowSize = Math.max(1, limit - ELLIPSIS.length);
  const chunks: string[] = [];
  let start = 0;

  while (start < graphemes.length) {
    if (graphemes.length - start <= limit) {
      chunks.push(graphemes.slice(start).join("").trim());
      break;
    }

    const hardEnd = start + windowSize;
    // Prefer breaking at the last whitespace inside the window, unless that would
    // make the chunk less than half-full (e.g. one very long word) — then hard-break.
    let breakAt = hardEnd;
    for (let index = hardEnd; index > start; index -= 1) {
      if (isWhitespace(graphemes[index])) {
        breakAt = index;
        break;
      }
    }
    if (breakAt <= start + Math.floor(windowSize / 2)) {
      breakAt = hardEnd;
    }

    chunks.push(`${graphemes.slice(start, breakAt).join("").trim()}${ELLIPSIS}`);
    start = breakAt;
    while (start < graphemes.length && isWhitespace(graphemes[start])) {
      start += 1;
    }
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
