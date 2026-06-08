import { writeProjectConfig } from "../config/config.js";
import type { UspConfig } from "../types.js";

// A minimal nested starter. Credentials are NOT stored here — `usp setup` writes them under
// ~/.config/usp/social-auth, or supply them via environment variables. Accounts hold targets;
// a target is a concrete destination (a subreddit, a Telegram chat) plus an optional prompt.
export const SAMPLE_CONFIG: UspConfig = {
  llm: {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
  },
  accounts: {
    x: {
      main: {
        targets: {
          default: {},
        },
      },
    },
    telegram: {
      main: {
        targets: {
          news: { chatId: "@your_channel" },
        },
      },
    },
  },
  profiles: {
    default: {
      targets: ["x/main/default", "telegram/main/news"],
    },
  },
};

export async function initCommand(options: { output?: string }) {
  const output = await writeProjectConfig(SAMPLE_CONFIG, options.output ?? ".usp.yml");
  console.log(`Wrote ${output}`);
}
