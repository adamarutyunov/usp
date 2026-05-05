import { describe, expect, it } from "vitest";
import type { UspConfig } from "../types.js";
import { resolveTargets } from "./targets.js";

describe("resolveTargets", () => {
  const config: UspConfig = {
    profiles: {
      default: {
        targets: ["x-main"],
      },
    },
    targets: {
      "x-main": {
        platform: "x",
        account: "main",
      },
    },
  };

  it("resolves profile targets", () => {
    expect(resolveTargets(config, { profile: "default" })).toEqual([
      {
        id: "x-main",
        config: {
          platform: "x",
          account: "main",
        },
      },
    ]);
  });

  it("rejects unknown targets", () => {
    expect(() => resolveTargets(config, { targets: ["missing"] })).toThrow('Unknown target "missing"');
  });
});
