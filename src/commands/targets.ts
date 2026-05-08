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
      optionalSecret(account.consumerKey, account.consumerKeyEnv, "X_CONSUMER_KEY") &&
      optionalSecret(account.consumerSecret, account.consumerSecretEnv, "X_CONSUMER_SECRET") &&
      optionalSecret(account.accessToken, account.accessTokenEnv, "X_ACCESS_TOKEN") &&
      optionalSecret(account.accessTokenSecret, account.accessTokenSecretEnv, "X_ACCESS_TOKEN_SECRET");
    const hasOAuth2 = optionalSecret(account.oauth2AccessToken, account.oauth2AccessTokenEnv, "X_OAUTH2_ACCESS_TOKEN");
    return hasOAuth1 || hasOAuth2
      ? { ready: true }
      : { ready: false, reason: `missing X credentials for account "${target.account}"` };
  }

  if (target.platform === "linkedin") {
    const account = config.accounts?.linkedin?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing LinkedIn account "${target.account}"` };
    }
    const token = optionalSecret(account.accessToken, account.accessTokenEnv, "LINKEDIN_ACCESS_TOKEN");
    return token && hasValue(account.author)
      ? { ready: true }
      : { ready: false, reason: `missing LinkedIn access token or author for account "${target.account}"` };
  }

  if (target.platform === "reddit") {
    const account = config.accounts?.reddit?.[target.account];
    if (!account) {
      return { ready: false, reason: `missing Reddit account "${target.account}"` };
    }
    const clientId = optionalSecret(account.clientId, account.clientIdEnv, "REDDIT_CLIENT_ID");
    const clientSecret = optionalSecret(account.clientSecret, account.clientSecretEnv, "REDDIT_CLIENT_SECRET");
    const refreshToken = optionalSecret(account.refreshToken, account.refreshTokenEnv, "REDDIT_REFRESH_TOKEN");
    const username = optionalSecret(account.username, account.usernameEnv, "REDDIT_USERNAME");
    const password = optionalSecret(account.password, account.passwordEnv, "REDDIT_PASSWORD");
    const subreddit = target.subreddit || account.subreddit;
    return clientId && clientSecret && (refreshToken || (username && password)) && subreddit
      ? { ready: true }
      : { ready: false, reason: `missing Reddit credentials or subreddit for account "${target.account}"` };
  }

  const account = config.accounts?.telegram?.[target.account];
  if (!account) {
    return { ready: false, reason: `missing Telegram account "${target.account}"` };
  }
  const botToken = optionalSecret(account.botToken, account.botTokenEnv, "TELEGRAM_BOT_TOKEN");
  const chatId = target.chatId?.startsWith("$")
    ? process.env[target.chatId.slice(1)]
    : target.chatId || account.chatId || process.env.TELEGRAM_CHAT_ID;
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
