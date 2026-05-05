export function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LLM response did not contain a JSON object: ${trimmed.slice(0, 160)}`);
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
}
