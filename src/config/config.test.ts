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
});
