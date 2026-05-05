import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { loadGlobalConfig, writeGlobalConfig } from "../config/config.js";
import type { Platform, UspConfig } from "../types.js";

function ensureAccount(config: UspConfig, platform: Platform, name: string) {
  config.accounts ??= {};
  config.accounts[platform] ??= {};
  const accounts = config.accounts[platform] as Record<string, Record<string, unknown>>;
  accounts[name] ??= {};
  return accounts[name]!;
}

async function askRequired(rl: readline.Interface, prompt: string) {
  const value = await rl.question(prompt);
  if (!value.trim()) {
    throw new Error(`${prompt.replace(/[: ]+$/, "")} is required.`);
  }
  return value.trim();
}

export async function setupCommand() {
  const rl = readline.createInterface({ input, output });
  try {
    const config = await loadGlobalConfig();
    const platform = (await askRequired(rl, "Platform (x/linkedin/reddit/telegram): ")) as Platform;
    if (!["x", "linkedin", "reddit", "telegram"].includes(platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const name = (await rl.question("Account name [main]: ")).trim() || "main";
    const account = ensureAccount(config, platform, name);

    if (platform === "x") {
      account.consumerKey = await askRequired(rl, "X consumer key: ");
      account.consumerSecret = await askRequired(rl, "X consumer secret: ");
      account.accessToken = await askRequired(rl, "X access token: ");
      account.accessTokenSecret = await askRequired(rl, "X access token secret: ");
    }

    if (platform === "linkedin") {
      account.accessToken = await askRequired(rl, "LinkedIn access token: ");
      account.author = await askRequired(rl, "LinkedIn author URN (urn:li:person:...): ");
      account.version = (await rl.question("LinkedIn API version [202602]: ")).trim() || "202602";
    }

    if (platform === "reddit") {
      account.clientId = await askRequired(rl, "Reddit client id: ");
      account.clientSecret = await askRequired(rl, "Reddit client secret: ");
      account.refreshToken = await rl.question("Reddit refresh token (preferred, optional): ");
      if (!String(account.refreshToken).trim()) {
        delete account.refreshToken;
        account.username = await askRequired(rl, "Reddit username: ");
        account.password = await askRequired(rl, "Reddit password: ");
      }
      account.userAgent =
        (await rl.question("Reddit user agent [usp/0.1.0]: ")).trim() || "usp/0.1.0";
    }

    if (platform === "telegram") {
      account.botToken = await askRequired(rl, "Telegram bot token: ");
    }

    const path = await writeGlobalConfig(config);
    console.log(`Saved ${platform}.${name} credentials to ${path}`);
  } finally {
    rl.close();
  }
}
