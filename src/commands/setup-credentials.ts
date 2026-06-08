import { note, password, select, text } from "@clack/prompts";
import type { Platform } from "../types.js";

export type OrBack = <T>(value: T | symbol) => T;

async function configureX(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create an X developer app and enable user authentication with read/write permissions.",
      "Developer portal: https://developer.x.com/en/portal/dashboard",
      "You need OAuth 1.0a consumer key/secret and access token/secret for media uploads.",
    ].join("\n"),
    "X credentials"
  );

  account.consumerKey = orBack(await password({ message: "X consumer key" }));
  account.consumerSecret = orBack(await password({ message: "X consumer secret" }));
  account.accessToken = orBack(await password({ message: "X access token" }));
  account.accessTokenSecret = orBack(await password({ message: "X access token secret" }));
}

async function configureLinkedIn(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create a LinkedIn developer app and request member posting access.",
      "Developer apps: https://www.linkedin.com/developers/apps",
      "Practical walkthrough: https://marcusnoble.co.uk/2025-02-02-posting-to-linkedin-via-the-api/",
      "Author URN should look like: urn:li:person:abc123",
    ].join("\n"),
    "LinkedIn credentials"
  );

  account.accessToken = orBack(await password({ message: "LinkedIn access token" }));
  account.author = orBack(await text({ message: "LinkedIn personal author URN" }));
  account.version = orBack(
    await text({
      message: "LinkedIn API version",
      placeholder: "202602",
      defaultValue: "202602",
    })
  );
}

async function configureReddit(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create a Reddit OAuth app. Script apps are simplest for personal testing.",
      "App console: https://www.reddit.com/prefs/apps",
      "Use OAuth scope: submit. Prefer a refresh token for CI.",
      "Subreddits are set per target, not on the account.",
    ].join("\n"),
    "Reddit credentials"
  );

  account.clientId = orBack(await password({ message: "Reddit client id" }));
  account.clientSecret = orBack(await password({ message: "Reddit client secret" }));

  const authMode = orBack(
    await select({
      message: "Reddit auth method",
      initialValue: "refresh",
      options: [
        { value: "refresh", label: "Refresh token", hint: "Best for CI" },
        { value: "password", label: "Username/password", hint: "Works for script apps" },
      ],
    })
  ) as "refresh" | "password";

  if (authMode === "refresh") {
    account.refreshToken = orBack(await password({ message: "Reddit refresh token" }));
    delete account.username;
    delete account.password;
  } else {
    account.username = orBack(await text({ message: "Reddit username" }));
    account.password = orBack(await password({ message: "Reddit password" }));
    delete account.refreshToken;
  }

  account.userAgent = orBack(
    await text({
      message: "Reddit user agent",
      placeholder: "usp/0.1.0 by your_reddit_username",
      defaultValue: account.userAgent ? String(account.userAgent) : "usp/0.1.0",
    })
  );
}

async function configureTelegram(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create a bot with BotFather, then add it to your channel/group if needed.",
      "BotFather: https://t.me/BotFather",
      "Chat ids (a channel @handle, group, or chat) are set per target, not on the account.",
    ].join("\n"),
    "Telegram credentials"
  );

  account.botToken = orBack(await password({ message: "Telegram bot token" }));
}

async function configureAegea(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Aegea posts use the normal author password flow.",
      "Local Docker default URL: http://localhost/",
      "The connector uploads images through Aegea, then saves and publishes the post.",
    ].join("\n"),
    "Aegea credentials"
  );

  account.baseUrl = orBack(
    await text({
      message: "Aegea base URL",
      placeholder: "http://localhost/",
      defaultValue: String(account.baseUrl ?? "http://localhost/"),
    })
  );
  account.password = orBack(await password({ message: "Aegea author password" }));
}

async function configureBluesky(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create a Bluesky app password, not your main account password.",
      "App passwords: https://bsky.app/settings/app-passwords",
      "Default PDS URL: https://bsky.social",
    ].join("\n"),
    "Bluesky credentials"
  );

  account.identifier = orBack(
    await text({
      message: "Bluesky handle or email",
      placeholder: "you.bsky.social",
      defaultValue: typeof account.identifier === "string" ? account.identifier : undefined,
    })
  );
  account.appPassword = orBack(await password({ message: "Bluesky app password" }));
  account.pdsUrl = orBack(
    await text({
      message: "Bluesky PDS URL",
      placeholder: "https://bsky.social",
      defaultValue: String(account.pdsUrl ?? "https://bsky.social"),
    })
  );
}

async function configureMastodon(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create an access token in your Mastodon instance preferences.",
      "Required scopes: write:statuses and write:media.",
      "API docs: https://docs.joinmastodon.org/methods/statuses/",
    ].join("\n"),
    "Mastodon credentials"
  );

  account.instanceUrl = orBack(
    await text({
      message: "Mastodon instance URL",
      placeholder: "https://mastodon.social",
      defaultValue: String(account.instanceUrl ?? "https://mastodon.social"),
    })
  );
  account.accessToken = orBack(await password({ message: "Mastodon access token" }));
  account.visibility = orBack(
    await select({
      message: "Mastodon visibility",
      initialValue: account.visibility ?? "public",
      options: [
        { value: "public", label: "public", hint: "Visible on public timelines" },
        { value: "unlisted", label: "unlisted", hint: "Public, but not listed" },
        { value: "private", label: "private", hint: "Followers only" },
        { value: "direct", label: "direct", hint: "Mentioned users only" },
      ],
    })
  ) as "public" | "unlisted" | "private" | "direct";
}

async function configureDiscord(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Discord incoming webhooks post into one channel without a bot token.",
      "In Discord: Channel settings -> Integrations -> Webhooks -> New Webhook -> Copy Webhook URL.",
      "One webhook is one channel; add a separate account per channel. Threads are set per target.",
    ].join("\n"),
    "Discord credentials"
  );

  account.webhookUrl = orBack(await password({ message: "Discord webhook URL" }));
  account.username = orBack(
    await text({
      message: "Webhook display name",
      placeholder: "Ultimate Social Poster",
      defaultValue: typeof account.username === "string" ? account.username : "Ultimate Social Poster",
    })
  );
  account.avatarUrl = orBack(
    await text({
      message: "Webhook avatar URL",
      placeholder: "Optional",
      defaultValue: typeof account.avatarUrl === "string" ? account.avatarUrl : "",
    })
  );
}

async function configureThreads(account: Record<string, unknown>, orBack: OrBack) {
  note(
    [
      "Create a Meta app with the Threads use case and request Threads publishing access.",
      "Required scopes include threads_basic and threads_content_publish.",
      "The user id can be left as me for the token owner.",
    ].join("\n"),
    "Threads credentials"
  );

  account.accessToken = orBack(await password({ message: "Threads access token" }));
  account.userId = orBack(
    await text({
      message: "Threads user id",
      placeholder: "me",
      defaultValue: typeof account.userId === "string" ? account.userId : "me",
    })
  );
  account.replyControl = orBack(
    await select({
      message: "Who can reply",
      initialValue: account.replyControl ?? "everyone",
      options: [
        { value: "everyone", label: "everyone" },
        { value: "followers", label: "followers" },
        { value: "mentioned_only", label: "mentioned only" },
      ],
    })
  ) as "everyone" | "followers" | "mentioned_only";
}

export async function configureCredentials(platform: Platform, account: Record<string, unknown>, orBack: OrBack) {
  if (platform === "x") await configureX(account, orBack);
  else if (platform === "linkedin") await configureLinkedIn(account, orBack);
  else if (platform === "reddit") await configureReddit(account, orBack);
  else if (platform === "telegram") await configureTelegram(account, orBack);
  else if (platform === "aegea") await configureAegea(account, orBack);
  else if (platform === "bluesky") await configureBluesky(account, orBack);
  else if (platform === "mastodon") await configureMastodon(account, orBack);
  else if (platform === "discord") await configureDiscord(account, orBack);
  else await configureThreads(account, orBack);
}

export async function deriveAccountName(platform: Platform, account: Record<string, unknown>) {
  try {
    if (platform === "telegram" && typeof account.botToken === "string") {
      const response = await fetch(`https://api.telegram.org/bot${account.botToken}/getMe`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = (await response.json().catch(() => undefined)) as
        | { ok?: boolean; result?: { username?: string; first_name?: string } }
        | undefined;
      return data?.ok ? data.result?.username || data.result?.first_name : undefined;
    }

    if (platform === "discord" && typeof account.webhookUrl === "string") {
      const response = await fetch(account.webhookUrl, { signal: AbortSignal.timeout(5000) });
      const data = (await response.json().catch(() => undefined)) as
        | { name?: string; channel_id?: string }
        | undefined;
      return data?.name || data?.channel_id || (typeof account.username === "string" ? account.username : undefined);
    }

    if (platform === "mastodon" && typeof account.instanceUrl === "string" && typeof account.accessToken === "string") {
      const response = await fetch(`${account.instanceUrl.replace(/\/+$/, "")}/api/v1/accounts/verify_credentials`, {
        headers: { authorization: `Bearer ${account.accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      const data = (await response.json().catch(() => undefined)) as { username?: string; acct?: string } | undefined;
      return data?.acct || data?.username;
    }

    if (platform === "threads" && typeof account.accessToken === "string") {
      const userId = typeof account.userId === "string" && account.userId.trim() ? account.userId.trim() : "me";
      const url = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(userId)}`);
      url.searchParams.set("fields", "id,username");
      url.searchParams.set("access_token", account.accessToken);
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = (await response.json().catch(() => undefined)) as { username?: string; id?: string } | undefined;
      return data?.username || data?.id;
    }
  } catch {
    // Verification-derived names are best effort; setup still lets the user choose a name.
  }

  if (platform === "bluesky" && typeof account.identifier === "string") {
    return account.identifier.replace(/^@/, "");
  }
  if (platform === "reddit" && typeof account.username === "string") {
    return account.username;
  }
  if (platform === "reddit" && typeof account.subreddit === "string") {
    return account.subreddit;
  }
  if (platform === "linkedin" && typeof account.author === "string") {
    return account.author.split(":").pop();
  }
  if (platform === "aegea" && typeof account.baseUrl === "string") {
    return new URL(account.baseUrl).hostname;
  }
  if (platform === "discord" && typeof account.username === "string") {
    return account.username;
  }
  if (platform === "threads" && typeof account.username === "string") {
    return account.username;
  }
  return platform;
}
