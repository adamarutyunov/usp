import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { readCodexOpenAiCredential } from "./auth.js";

describe("readCodexOpenAiCredential", () => {
  it("reads Codex browser-login bearer credentials", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-codex-"));
    const authPath = path.join(dir, "auth.json");
    await fs.writeFile(
      authPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          access_token: "codex-access-token",
        },
      })
    );
    vi.stubEnv("CODEX_AUTH_PATH", authPath);

    try {
      await expect(readCodexOpenAiCredential()).resolves.toEqual({
        kind: "bearer",
        value: "codex-access-token",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
