import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { browserProfileDir, expandHome, withBrowserProfileLock } from "./profile.js";

describe("browser profile helpers", () => {
  it("builds stable browser auth paths under the usp config dir", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "usp-home-"));
    vi.stubEnv("HOME", home);

    try {
      expect(browserProfileDir("x", "main")).toBe(path.join(home, ".config", "usp", "browser-auth", "x", "main"));
      expect(browserProfileDir("linkedin", "my account")).toBe(
        path.join(home, ".config", "usp", "browser-auth", "linkedin", "my_account")
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("expands tilde paths", () => {
    vi.stubEnv("HOME", "/tmp/usp-home");

    try {
      expect(expandHome("~/profiles/x")).toBe("/tmp/usp-home/profiles/x");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prevents two concurrent users of the same profile", async () => {
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-profile-"));

    await expect(
      withBrowserProfileLock(profileDir, async () => {
        await expect(withBrowserProfileLock(profileDir, async () => undefined)).rejects.toThrow(
          "Browser profile is already in use"
        );
      })
    ).resolves.toBeUndefined();
  });
});
