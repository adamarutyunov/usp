import type { TargetConfig, UspConfig } from "../types.js";
import { optionalSecret } from "../util/secrets.js";

function hasValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function getTargetReadiness(config: UspConfig, target: TargetConfig) {
  if (target.platform === "x") {
    const account = config.accounts?.x?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing X account "${target.account}"` };
    }
    const hasOAuth1 =
      optionalSecret(account.consumerKey) &&
      optionalSecret(account.consumerSecret) &&
      optionalSecret(account.accessToken) &&
      optionalSecret(account.accessTokenSecret);
    return hasOAuth1
      ? { ready: true }
      : { ready: false, reason: `missing X credentials for account "${target.account}"` };
  }

  if (target.platform === "linkedin") {
    const account = config.accounts?.linkedin?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing LinkedIn account "${target.account}"` };
    }
    const token = optionalSecret(account.accessToken);
    return token && hasValue(account.author)
      ? { ready: true }
      : { ready: false, reason: `missing LinkedIn access token or author for account "${target.account}"` };
  }

  if (target.platform === "reddit") {
    const account = config.accounts?.reddit?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Reddit account "${target.account}"` };
    }
    const clientId = optionalSecret(account.clientId);
    const clientSecret = optionalSecret(account.clientSecret);
    const refreshToken = optionalSecret(account.refreshToken);
    const username = optionalSecret(account.username);
    const password = optionalSecret(account.password);
    const subreddit = target.subreddit || account.subreddit;
    return clientId && clientSecret && (refreshToken || (username && password)) && subreddit
      ? { ready: true }
      : { ready: false, reason: `missing Reddit credentials or subreddit for account "${target.account}"` };
  }

  if (target.platform === "aegea") {
    const account = config.accounts?.aegea?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Aegea account "${target.account}"` };
    }
    const password = optionalSecret(account.password);
    return password && hasValue(account.baseUrl)
      ? { ready: true }
      : { ready: false, reason: `missing Aegea baseUrl or password for account "${target.account}"` };
  }

  if (target.platform === "bluesky") {
    const account = config.accounts?.bluesky?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Bluesky account "${target.account}"` };
    }
    const identifier = optionalSecret(account.identifier);
    const appPassword = optionalSecret(account.appPassword);
    return identifier && appPassword
      ? { ready: true }
      : { ready: false, reason: `missing Bluesky identifier or app password for account "${target.account}"` };
  }

  if (target.platform === "mastodon") {
    const account = config.accounts?.mastodon?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Mastodon account "${target.account}"` };
    }
    const accessToken = optionalSecret(account.accessToken);
    return accessToken && hasValue(account.instanceUrl)
      ? { ready: true }
      : { ready: false, reason: `missing Mastodon instance URL or access token for account "${target.account}"` };
  }

  if (target.platform === "discord") {
    const account = config.accounts?.discord?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Discord account "${target.account}"` };
    }
    const webhookUrl = optionalSecret(account.webhookUrl);
    return webhookUrl
      ? { ready: true }
      : { ready: false, reason: `missing Discord webhook URL for account "${target.account}"` };
  }

  if (target.platform === "threads") {
    const account = config.accounts?.threads?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Threads account "${target.account}"` };
    }
    const accessToken = optionalSecret(account.accessToken);
    return accessToken
      ? { ready: true }
      : { ready: false, reason: `missing Threads access token for account "${target.account}"` };
  }

  const account = config.accounts?.telegram?.[target.account];
  if (!account) {
    return { ready: false, reason: `missing Telegram account "${target.account}"` };
  }
  const botToken = optionalSecret(account.botToken);
  const chatId = target.chatId || account.chatId;
  return botToken && chatId
    ? { ready: true }
    : { ready: false, reason: `missing Telegram bot token or chat_id for account "${target.account}"` };
}

export function resolveTargets(config: UspConfig, options: { profile?: string; targets?: string[] }) {
  const allTargets = config.targets ?? {};
  let ids = options.targets?.filter(Boolean) ?? [];

  if (ids.length === 0) {
    const profileName = options.profile ?? "default";
    ids = config.profiles?.[profileName]?.targets ?? [];
    if (ids.length === 0 && Object.keys(allTargets).length === 1) {
      ids = Object.keys(allTargets);
    }
    if (ids.length === 0) {
      throw new Error(`No targets selected. Define profiles.${profileName}.targets or pass --target.`);
    }
  }

  return ids.map((id) => {
    const target = allTargets[id];
    if (!target) {
      throw new Error(`Unknown target "${id}".`);
    }
    return { id, config: target as TargetConfig };
  });
}

export function filterReadyTargets(
  config: UspConfig,
  targets: Array<{ id: string; config: TargetConfig }>,
  options: { explicitTargets?: boolean } = {}
) {
  const ready = [];
  const skipped = [];

  for (const target of targets) {
    const readiness = getTargetReadiness(config, target.config);
    if (readiness.ready) {
      ready.push(target);
    } else {
      skipped.push({ ...target, reason: readiness.reason ?? "not configured" });
    }
  }

  if (options.explicitTargets && skipped.length > 0) {
    throw new Error(
      skipped.map((target) => `Target "${target.id}" is not configured: ${target.reason}`).join("\n")
    );
  }

  return { ready, skipped };
}
