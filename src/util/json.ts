/**
 * Extract a JSON object from an LLM response. Tries to parse the whole (de-fenced)
 * payload first, then falls back to scanning for the first balanced `{...}` object —
 * respecting string literals and escapes, so braces inside strings or trailing prose
 * after the object don't corrupt the slice (the old first-`{`/last-`}` approach did).
 */
export function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    // Fall through to the balanced-brace scan below.
  }

  const extracted = extractFirstJsonObject(withoutFence);
  if (extracted === undefined) {
    throw new Error(`LLM response did not contain a JSON object: ${trimmed.slice(0, 160)}`);
  }
  return JSON.parse(extracted);
}

/** Return the first balanced `{...}` substring, or undefined if none is found. */
function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}
