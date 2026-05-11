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

  it("keeps configured Aegea targets", () => {
    const readyConfig: UspConfig = {
      targets: {
        "aegea-blog": {
          platform: "aegea",
          account: "main",
        },
      },
      accounts: {
        aegea: {
          main: {
            baseUrl: "http://localhost/",
            password: "aegea",
          },
        },
      },
    };
    const targets = resolveTargets(readyConfig, { targets: ["aegea-blog"] });

    expect(filterReadyTargets(readyConfig, targets)).toMatchObject({
      ready: [{ id: "aegea-blog" }],
      skipped: [],
    });
  });

  it("keeps configured Bluesky targets", () => {
    const readyConfig: UspConfig = {
      targets: {
        "bluesky-main": {
          platform: "bluesky",
          account: "main",
        },
      },
      accounts: {
        bluesky: {
          main: {
            identifier: "you.bsky.social",
            appPassword: "app-password",
          },
        },
      },
    };
    const targets = resolveTargets(readyConfig, { targets: ["bluesky-main"] });

    expect(filterReadyTargets(readyConfig, targets)).toMatchObject({
      ready: [{ id: "bluesky-main" }],
      skipped: [],
    });
  });

  it("keeps configured Mastodon targets", () => {
    const readyConfig: UspConfig = {
      targets: {
        "mastodon-main": {
          platform: "mastodon",
          account: "main",
        },
      },
      accounts: {
        mastodon: {
          main: {
            instanceUrl: "https://mastodon.social",
            accessToken: "token",
          },
        },
      },
    };
    const targets = resolveTargets(readyConfig, { targets: ["mastodon-main"] });

    expect(filterReadyTargets(readyConfig, targets)).toMatchObject({
      ready: [{ id: "mastodon-main" }],
      skipped: [],
    });
  });

  it("keeps configured Discord targets", () => {
    const readyConfig: UspConfig = {
      targets: {
        "discord-main": {
          platform: "discord",
          account: "main",
        },
      },
      accounts: {
        discord: {
          main: {
            webhookUrl: "https://discord.com/api/webhooks/123/token",
          },
        },
      },
    };
    const targets = resolveTargets(readyConfig, { targets: ["discord-main"] });

    expect(filterReadyTargets(readyConfig, targets)).toMatchObject({
      ready: [{ id: "discord-main" }],
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
