import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { loadConfig, writeSocialAuthConfig } from "./config.js";

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
});
