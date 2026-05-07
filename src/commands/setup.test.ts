import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { findProjectConfig } from "../config/config.js";

describe("setup bootstrap support", () => {
  it("can detect that a project config is missing before setup creates one", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-setup-"));
    await expect(findProjectConfig(dir)).resolves.toBeUndefined();
  });
});
