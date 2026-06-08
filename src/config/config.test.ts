import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { applyEnvFallbacks, loadConfig, migrateFlatConfig, normalizeTargets, remapIdsInPlace, writeSocialAuthConfig } from "./config.js";

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

  it("migrates legacy flat targets while loading", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "usp-home-"));
    vi.stubEnv("HOME", home);
    await fs.writeFile(
      path.join(home, ".usp.yml"),
      [
        "profiles:",
        "  default:",
        "    targets: [x-main]",
        "postingDefaults:",
        "  x-main: llm",
        "targets:",
        "  x-main:",
        "    platform: x",
        "    account: main",
      ].join("\n")
    );

    try {
      await expect(loadConfig({ cwd: home })).resolves.toMatchObject({
        profiles: { default: { targets: ["x/main/default"] } },
        postingDefaults: { "x/main/default": "llm" },
        targets: { "x/main/default": { platform: "x", account: "main" } },
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

  it("prefers an account-scoped env var over the platform-wide one", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "platform-wide");
    vi.stubEnv("TELEGRAM_NEWSBOT_BOT_TOKEN", "account-scoped");
    try {
      const config = applyEnvFallbacks({
        accounts: { telegram: { newsbot: {}, other: {} } },
      });
      expect(config.accounts?.telegram?.newsbot?.botToken).toBe("account-scoped");
      expect(config.accounts?.telegram?.other?.botToken).toBe("platform-wide");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("normalizeTargets", () => {
  it("flattens nested account targets, strips the targets key, and adds a default", () => {
    const config = normalizeTargets({
      accounts: {
        telegram: {
          newsbot: {
            botToken: "t",
            targets: {
              en: { chatId: "@news" },
              ru: { chatId: "@news_ru", prompt: { mode: "append", text: "In Russian." } },
            },
          },
        },
        x: { main: { accessToken: "a" } }, // no targets -> default
      },
    });

    expect(Object.keys(config.targets ?? {}).sort()).toEqual([
      "telegram/newsbot/en",
      "telegram/newsbot/ru",
      "x/main/default",
    ]);
    expect(config.targets?.["telegram/newsbot/en"]).toEqual({
      platform: "telegram",
      account: "newsbot",
      chatId: "@news",
    });
    expect(config.targets?.["telegram/newsbot/ru"]?.prompt).toEqual({ mode: "append", text: "In Russian." });
    expect(config.targets?.["x/main/default"]).toEqual({ platform: "x", account: "main" });
    // The targets key is removed from the auth object.
    expect((config.accounts?.telegram?.newsbot as { targets?: unknown }).targets).toBeUndefined();
  });

  it("keeps existing flat targets and does not double-create defaults for them", () => {
    const config = normalizeTargets({
      accounts: { x: { main: { accessToken: "a" } } },
      targets: { "x-main": { platform: "x", account: "main" } },
    });
    expect(Object.keys(config.targets ?? {})).toEqual(["x-main"]);
  });
});

describe("migrateFlatConfig", () => {
  it("nests flat targets and remaps profiles and postingDefaults", () => {
    const { config, idMap } = migrateFlatConfig({
      profiles: { default: { targets: ["x-main", "reddit-release"] } },
      postingDefaults: { "x-main": "llm", "reddit-release": "off" },
      targets: {
        "x-main": { platform: "x", account: "main" },
        "reddit-release": { platform: "reddit", account: "main", subreddit: "reddit_api_test" },
      },
    });

    expect(idMap).toEqual({ "x-main": "x/main/default", "reddit-release": "reddit/main/default" });
    expect(config.targets).toBeUndefined();
    expect(config.accounts?.x?.main).toEqual({ targets: { default: {} } });
    expect(config.accounts?.reddit?.main).toEqual({ targets: { default: { subreddit: "reddit_api_test" } } });
    expect(config.profiles?.default.targets).toEqual(["x/main/default", "reddit/main/default"]);
    expect(config.postingDefaults).toEqual({ "x/main/default": "llm", "reddit/main/default": "off" });
  });

  it("converts a legacy string prompt to a replace override and disambiguates name clashes", () => {
    const { config, idMap } = migrateFlatConfig({
      targets: {
        "x-a": { platform: "x", account: "main", prompt: "Only this." },
        "x-b": { platform: "x", account: "main" },
      },
    });
    expect(config.accounts?.x?.main?.targets?.default).toEqual({ prompt: { mode: "replace", text: "Only this." } });
    // Second target on the same account can't be "default" too.
    expect(idMap["x-b"]).toBe("x/main/x-b");
  });

  it("remaps a separate config's ids with an external id map", () => {
    const global = { postingDefaults: { "x-main": "llm" as const } };
    remapIdsInPlace(global, { "x-main": "x/main/default" });
    expect(global.postingDefaults).toEqual({ "x/main/default": "llm" });
  });
});
