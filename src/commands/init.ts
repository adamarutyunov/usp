import { writeProjectConfig } from "../config/config.js";
import type { UspConfig } from "../types.js";

export const SAMPLE_CONFIG: UspConfig = {
  llm: {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  profiles: {
    default: {
      targets: ["x-main", "linkedin-me", "reddit-release", "telegram-channel"],
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
      chatId: "$TELEGRAM_CHAT_ID",
    },
  },
};

export async function initCommand(options: { output?: string }) {
  const output = await writeProjectConfig(SAMPLE_CONFIG, options.output ?? ".usp.yml");
  console.log(`Wrote ${output}`);
}
