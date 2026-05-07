import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { findProjectConfig, loadGlobalConfig, writeGlobalConfig, writeProjectConfig } from "../config/config.js";
import type { Platform, UspConfig } from "../types.js";
import { SAMPLE_CONFIG } from "./init.js";

function ensureAccount(config: UspConfig, platform: Platform, name: string) {
  config.accounts ??= {};
  config.accounts[platform] ??= {};
  const accounts = config.accounts[platform] as Record<string, Record<string, unknown>>;
  accounts[name] ??= {};
  return accounts[name]!;
}

async function ensureProjectConfig() {
  const projectConfig = await findProjectConfig();
  if (!projectConfig) {
    const created = await writeProjectConfig(SAMPLE_CONFIG, ".usp.yml");
    console.log(`Wrote ${created}`);
  }
}

async function askRequired(rl: readline.Interface, prompt: string) {
  const value = await rl.question(prompt);
  if (!value.trim()) {
    throw new Error(`${prompt.replace(/[: ]+$/, "")} is required.`);
  }
  return value.trim();
}

function applyValues(account: Record<string, unknown>, values: string[] = []) {
  for (const item of values) {
    const [key, ...rest] = item.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --value "${item}". Expected key=value.`);
    }
    account[key] = rest.join("=");
  }
}

export async function setupCommand(options: { platform?: Platform; account?: string; value?: string[] } = {}) {
  await ensureProjectConfig();

  if (options.platform) {
    if (!["x", "linkedin", "reddit", "telegram"].includes(options.platform)) {
      throw new Error(`Unsupported platform: ${options.platform}`);
    }
    const config = await loadGlobalConfig();
    const name = options.account ?? "main";
    const account = ensureAccount(config, options.platform, name);
    applyValues(account, options.value);
    const path = await writeGlobalConfig(config);
    console.log(`Saved ${options.platform}.${name} credentials to ${path}`);
    return;
  }

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
