import { loadConfig } from "../config/config.js";
import type { Platform, UspConfig } from "../types.js";
import { platformName } from "../util/display.js";

const PLATFORMS: Platform[] = ["x", "linkedin", "reddit", "telegram", "aegea", "bluesky", "mastodon", "discord", "threads"];

function accountLabel(platform: Platform, account: Record<string, unknown>) {
  if (platform === "linkedin" && typeof account.author === "string") {
    return account.author;
  }
  if (platform === "reddit" && typeof account.username === "string") {
    return account.username;
  }
  if (platform === "telegram" && typeof account.chatId === "string") {
    return account.chatId;
  }
  if (platform === "aegea" && typeof account.baseUrl === "string") {
    return account.baseUrl;
  }
  if (platform === "bluesky" && typeof account.identifier === "string") {
    return account.identifier;
  }
  if (platform === "mastodon" && typeof account.instanceUrl === "string") {
    return account.instanceUrl;
  }
  if (platform === "discord" && typeof account.username === "string") {
    return account.username;
  }
  if (platform === "threads" && typeof account.username === "string") {
    return account.username;
  }
  return undefined;
}

function targetIdsFor(config: UspConfig, platform: Platform, accountName: string) {
  return Object.entries(config.targets ?? {})
    .filter(([, target]) => target.platform === platform && target.account === accountName)
    .map(([id]) => id);
}

export async function accountsCommand() {
  const config = await loadConfig();
  let printed = false;

  for (const platform of PLATFORMS) {
    const accounts = config.accounts?.[platform] as Record<string, Record<string, unknown>> | undefined;
    if (!accounts || Object.keys(accounts).length === 0) {
      continue;
    }

    printed = true;
    console.log(platformName(platform));
    for (const [name, account] of Object.entries(accounts)) {
      const label = accountLabel(platform, account);
      const targets = targetIdsFor(config, platform, name);
      const suffix = [label, targets.length ? `targets: ${targets.join(", ")}` : undefined]
        .filter(Boolean)
        .join(" | ");
      console.log(`  ${name}${suffix ? ` (${suffix})` : ""}`);
    }
  }

  if (!printed) {
    console.log("No accounts configured. Run `usp setup`.");
  }
}
