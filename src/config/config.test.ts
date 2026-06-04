import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { applyEnvFallbacks, loadConfig, writeSocialAuthConfig } from "./config.js";

describe("social auth config", () => {
  it("loads social auth files from ~/.config/usp/social-auth", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "usp-home-"));
    vi.stubEnv("HOME", home);
    await writeSocialAuthConfig("telegram.yml", {
      accounts: {
        telegram: {
          main: {
            botToken: "123:abc",
          },
        },
      },
    });

    try {
      await expect(loadConfig({ cwd: home })).resolves.toMatchObject({
        accounts: {
          telegram: {
            main: {
              botToken: "123:abc",
            },
          },
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets social auth override generated project account placeholders", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "usp-home-"));
    vi.stubEnv("HOME", home);
    await fs.writeFile(
      path.join(home, ".usp.yml"),
      [
        "accounts:",
        "  linkedin:",
        "    me:",
        "      author: urn:li:person:YOUR_PERSON_ID",
        "targets:",
        "  linkedin-me:",
        "    platform: linkedin",
        "    account: me",
      ].join("\n")
    );
    await writeSocialAuthConfig("linkedin.yml", {
      accounts: {
        linkedin: {
          me: {
            accessToken: "real-token",
            author: "urn:li:person:real",
          },
        },
      },
    });

    try {
      await expect(loadConfig({ cwd: home })).resolves.toMatchObject({
        accounts: {
          linkedin: {
            me: {
              accessToken: "real-token",
              author: "urn:li:person:real",
            },
          },
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fills credentials from conventional env vars when loading", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "usp-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "env-token");
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key");
    // No accounts block at all — env populates the target's account.
    await fs.writeFile(
      path.join(home, ".usp.yml"),
      [
        "llm:",
        "  provider: anthropic",
        "targets:",
        "  telegram-channel:",
        "    platform: telegram",
        "    account: main",
        "    chatId: \"@chan\"",
      ].join("\n")
    );

    try {
      await expect(loadConfig({ cwd: home })).resolves.toMatchObject({
        llm: { provider: "anthropic", apiKey: "env-key" },
        accounts: { telegram: { main: { botToken: "env-token" } } },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("applyEnvFallbacks", () => {
  it("fills blanks from env by convention without overriding real values", () => {
    vi.stubEnv("X_CONSUMER_KEY", "env-consumer");
    vi.stubEnv("X_ACCESS_TOKEN", "env-access");
    vi.stubEnv("OPENAI_API_KEY", "env-openai");
    try {
      const config = applyEnvFallbacks({
        llm: { provider: "openai", model: "gpt-5.4-mini" },
        accounts: { x: { main: { consumerKey: "real-consumer" } } },
        targets: { "x-main": { platform: "x", account: "main" } },
      });

      // Real config value is kept; blank fields are filled from env.
      expect(config.accounts?.x?.main).toMatchObject({
        consumerKey: "real-consumer",
        accessToken: "env-access",
      });
      expect(config.llm?.apiKey).toBe("env-openai");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does nothing when the env vars are absent", () => {
    const config = applyEnvFallbacks({
      accounts: { discord: { main: { webhookUrl: "https://hook" } } },
      targets: { "discord-main": { platform: "discord", account: "main" } },
    });
    expect(config.accounts?.discord?.main?.webhookUrl).toBe("https://hook");
  });
});
