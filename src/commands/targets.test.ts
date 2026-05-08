import { describe, expect, it } from "vitest";
import type { UspConfig } from "../types.js";
import { filterReadyTargets, resolveTargets } from "./targets.js";

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

  it("filters unconfigured profile targets before planning", () => {
    const targets = resolveTargets(config, { profile: "default" });

    expect(filterReadyTargets(config, targets)).toMatchObject({
      ready: [],
      skipped: [
        {
          id: "x-main",
          reason: 'missing X account "main"',
        },
      ],
    });
  });

  it("keeps configured targets", () => {
    const readyConfig: UspConfig = {
      ...config,
      accounts: {
        x: {
          main: {
            consumerKey: "ck",
            consumerSecret: "cs",
            accessToken: "at",
            accessTokenSecret: "ats",
          },
        },
      },
    };
    const targets = resolveTargets(readyConfig, { profile: "default" });

    expect(filterReadyTargets(readyConfig, targets)).toMatchObject({
      ready: [{ id: "x-main" }],
      skipped: [],
    });
  });

  it("throws for explicitly requested unconfigured targets", () => {
    const targets = resolveTargets(config, { targets: ["x-main"] });

    expect(() => filterReadyTargets(config, targets, { explicitTargets: true })).toThrow(
      'Target "x-main" is not configured: missing X account "main"'
    );
  });
});
