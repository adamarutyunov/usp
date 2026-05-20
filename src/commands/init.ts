import { writeProjectConfig } from "../config/config.js";
import type { UspConfig } from "../types.js";

export const SAMPLE_CONFIG: UspConfig = {
  llm: {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
  },
  profiles: {
    default: {
      targets: [
        "x-main",
        "linkedin-me",
        "reddit-release",
        "telegram-channel",
        "aegea-blog",
        "bluesky-main",
        "mastodon-main",
        "discord-main",
        "threads-main",
      ],
    },
  },
  targets: {
    "x-main": {
      platform: "x",
      account: "main",
    },
    "linkedin-me": {
      platform: "linkedin",
      account: "me",
    },
    "reddit-release": {
      platform: "reddit",
      account: "main",
      subreddit: "reddit_api_test",
    },
    "telegram-channel": {
      platform: "telegram",
      account: "main",
    },
    "aegea-blog": {
      platform: "aegea",
      account: "main",
    },
    "bluesky-main": {
      platform: "bluesky",
      account: "main",
    },
    "mastodon-main": {
      platform: "mastodon",
      account: "main",
    },
    "discord-main": {
      platform: "discord",
      account: "main",
    },
    "threads-main": {
      platform: "threads",
      account: "main",
    },
  },
};

export async function initCommand(options: { output?: string }) {
  const output = await writeProjectConfig(SAMPLE_CONFIG, options.output ?? ".usp.yml");
  console.log(`Wrote ${output}`);
}
