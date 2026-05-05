import { writeProjectConfig } from "../config/config.js";
import type { UspConfig } from "../types.js";

const SAMPLE_CONFIG: UspConfig = {
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
  accounts: {
    x: {
      main: {
        consumerKeyEnv: "X_CONSUMER_KEY",
        consumerSecretEnv: "X_CONSUMER_SECRET",
        accessTokenEnv: "X_ACCESS_TOKEN",
        accessTokenSecretEnv: "X_ACCESS_TOKEN_SECRET",
      },
    },
    linkedin: {
      me: {
        accessTokenEnv: "LINKEDIN_ACCESS_TOKEN",
        author: "urn:li:person:YOUR_PERSON_ID",
      },
    },
    reddit: {
      main: {
        clientIdEnv: "REDDIT_CLIENT_ID",
        clientSecretEnv: "REDDIT_CLIENT_SECRET",
        refreshTokenEnv: "REDDIT_REFRESH_TOKEN",
        userAgent: "usp/0.1.0 by YOUR_REDDIT_USERNAME",
      },
    },
    telegram: {
      main: {
        botTokenEnv: "TELEGRAM_BOT_TOKEN",
      },
    },
  },
};

export async function initCommand(options: { output?: string }) {
  const output = await writeProjectConfig(SAMPLE_CONFIG, options.output ?? ".usp.yml");
  console.log(`Wrote ${output}`);
}
