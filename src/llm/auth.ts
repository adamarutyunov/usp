import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function stringAt(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  let cursor: unknown = value;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : undefined;
}

export async function readCodexOpenAiCredential() {
  const authPath = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), ".codex", "auth.json");
  const raw = await fs.readFile(authPath, "utf8");
  const auth = JSON.parse(raw) as Record<string, unknown>;

  const apiKey =
    stringAt(auth, ["OPENAI_API_KEY"]) ||
    stringAt(auth, ["OPENAI_API_KEY", "value"]) ||
    stringAt(auth, ["OPENAI_API_KEY", "api_key"]);
  if (apiKey) {
    return { kind: "apiKey" as const, value: apiKey };
  }

  const accessToken = stringAt(auth, ["tokens", "access_token"]);
  if (accessToken) {
    return { kind: "bearer" as const, value: accessToken };
  }

  throw new Error(`No usable OpenAI credential found in ${authPath}. Run codex login first.`);
}
