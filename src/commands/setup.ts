import {
  cancel,
  intro,
  isCancel,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";

import {
  findProjectConfig,
  loadProjectConfig,
  loadSocialAuthConfig,
  writeConfigFile,
  writeProjectConfig,
  writeSocialAuthConfig,
} from "../config/config.js";
import { DEFAULT_PLATFORM_PROMPTS } from "../llm/prompts.js";
import type { LlmProvider, Platform, UspConfig } from "../types.js";
import { SAMPLE_CONFIG } from "./init.js";

const PLATFORM_ACCOUNT_NAMES: Record<Platform, string> = {
  x: "main",
  linkedin: "me",
  reddit: "main",
  telegram: "main",
  aegea: "main",
  bluesky: "main",
  mastodon: "main",
  discord: "main",
  threads: "main",
};

const TARGET_IDS: Record<Platform, string> = {
  x: "x-main",
  linkedin: "linkedin-me",
  reddit: "reddit-release",
  telegram: "telegram-channel",
  aegea: "aegea-blog",
  bluesky: "bluesky-main",
  mastodon: "mastodon-main",
  discord: "discord-main",
  threads: "threads-main",
};

const LLM_DEFAULTS: Record<LlmProvider, { model: string; keyUrl: string; label: string }> = {
  gemini: {
    model: "gemini-2.5-flash-lite",
    keyUrl: "https://aistudio.google.com/app/apikey",
    label: "Gemini",
  },
  openai: {
    model: "gpt-5.4-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    label: "OpenAI",
  },
  anthropic: {
    model: "claude-sonnet-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    label: "Anthropic",
  },
};

const SOCIAL_PLATFORMS: Platform[] = [
  "x",
  "linkedin",
  "reddit",
  "telegram",
  "aegea",
  "bluesky",
  "mastodon",
  "discord",
  "threads",
];

function assertNotCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
  return value;
}

function ensureAccount(config: UspConfig, platform: Platform, name = PLATFORM_ACCOUNT_NAMES[platform]) {
  config.accounts ??= {};
  config.accounts[platform] ??= {};
  const accounts = config.accounts[platform] as Record<string, Record<string, unknown>>;
  accounts[name] ??= {};
  return accounts[name]!;
}

async function ensureProjectConfig() {
  const projectConfig = await findProjectConfig();
  if (projectConfig) {
    return projectConfig;
  }

  const created = await writeProjectConfig(SAMPLE_CONFIG, ".usp.yml");
  note(created, "Created project config");
  return created;
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

async function writePlatformSocialAuth(
  platform: Platform,
  socialAuth: UspConfig
) {
  return writeSocialAuthConfig(`${platform}.yml`, {
    accounts: {
      [platform]: socialAuth.accounts?.[platform] ?? {},
    },
  } as UspConfig);
}

async function writeLlmAuth(config: UspConfig) {
  if (!config.llm) {
    return undefined;
  }
  return writeSocialAuthConfig("llm.yml", config);
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
}

function targetIdFor(platform: Platform, accountName: string) {
  const legacyName = PLATFORM_ACCOUNT_NAMES[platform];
  return accountName === legacyName ? TARGET_IDS[platform] : `${platform}-${safeSegment(accountName)}`;
}

function ensureTarget(project: UspConfig, platform: Platform, accountName = PLATFORM_ACCOUNT_NAMES[platform]) {
  const id = targetIdFor(platform, accountName);
  project.targets ??= {};
  project.targets[id] ??= {
    platform,
    account: accountName,
  };
  project.targets[id]!.platform = platform;
  project.targets[id]!.account = accountName;

  project.profiles ??= {};
  project.profiles.default ??= { targets: [] };
  if (!project.profiles.default.targets.includes(id)) {
    project.profiles.default.targets.push(id);
  }

  return project.targets[id]!;
}

function hasValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function accountsFor(config: UspConfig, platform: Platform) {
  return (config.accounts?.[platform] ?? {}) as Record<string, Record<string, unknown>>;
}

function llmStatus(project: UspConfig, socialAuth: UspConfig) {
  const llm = socialAuth.llm ?? project.llm;
  if (!llm?.provider) {
    return "not set";
  }

  const auth = llm.authToken ? "Claude token" : llm.apiKey ? "API key" : "auth pending";
  return `${llm.provider}, ${auth}`;
}

function platformStatus(project: UspConfig, socialAuth: UspConfig, platform: Platform) {
  const accounts = accountsFor(socialAuth, platform);
  const statuses = Object.entries(accounts).map(([accountName, account]) => {
    const target = Object.values(project.targets ?? {}).find(
      (item) => item.platform === platform && item.account === accountName
    );

    if (platform === "x") {
      return account &&
      hasValue(account.consumerKey) &&
      hasValue(account.consumerSecret) &&
      hasValue(account.accessToken) &&
      hasValue(account.accessTokenSecret)
      ? "set"
      : "not set";
    }

    if (platform === "linkedin") {
      return account && hasValue(account.accessToken) && hasValue(account.author) ? "set" : "not set";
    }

    if (platform === "reddit") {
      return account &&
      hasValue(account.clientId) &&
      hasValue(account.clientSecret) &&
      (hasValue(account.refreshToken) || (hasValue(account.username) && hasValue(account.password))) &&
      hasValue(account.subreddit || target?.subreddit)
      ? "set"
      : "not set";
    }

    if (platform === "telegram") {
      return account && hasValue(account.botToken) && hasValue(account.chatId || target?.chatId) ? "set" : "not set";
    }

    if (platform === "aegea") {
      return account && hasValue(account.baseUrl) && hasValue(account.password) ? "set" : "not set";
    }

    if (platform === "bluesky") {
      return account && hasValue(account.identifier) && hasValue(account.appPassword) ? "set" : "not set";
    }

    if (platform === "mastodon") {
      return account && hasValue(account.instanceUrl) && hasValue(account.accessToken) ? "set" : "not set";
    }

    if (platform === "threads") {
      return account && hasValue(account.accessToken) ? "set" : "not set";
    }

    return account && hasValue(account.webhookUrl) ? "set" : "not set";
  });

  if (statuses.length === 0) {
    return "not set";
  }
  return statuses.every((item) => item === "set") ? `${statuses.length} configured` : `${statuses.length} partial`;
}

function statusHint(status: string) {
  return status === "set" ? "configured" : status;
}

function socialSummary(project: UspConfig, socialAuth: UspConfig) {
  return SOCIAL_PLATFORMS.map((platform) => `${platform}: ${platformStatus(project, socialAuth, platform)}`).join(", ");
}

async function configureLlm(project: UspConfig, socialAuth: UspConfig) {
  const provider = assertNotCancel(
    await select({
      message: "Choose your LLM provider",
      initialValue: project.llm?.provider ?? "anthropic",
      options: [
        { value: "anthropic", label: "Anthropic", hint: "Claude, recommended" },
        { value: "openai", label: "OpenAI", hint: "GPT models" },
        { value: "gemini", label: "Gemini", hint: "Google AI Studio" },
      ],
    })
  ) as LlmProvider;
  const defaults = LLM_DEFAULTS[provider];

  if (provider === "anthropic") {
    note(
      [
        "API key path: https://console.anthropic.com/settings/keys",
        "Claude Code token path: run `claude setup-token`, then paste the result here.",
      ].join("\n"),
      "Anthropic auth"
    );
    const mode = assertNotCancel(
      await select({
        message: "How should usp authenticate Anthropic?",
        initialValue: "auth-paste",
        options: [
          { value: "auth-paste", label: "Paste Claude setup-token result", hint: "Saved under social-auth" },
          { value: "api-paste", label: "Paste API key now", hint: "Saved under social-auth" },
        ],
      })
    ) as "auth-paste" | "api-paste";

    project.llm = {
      provider,
      model: defaults.model,
    };
    socialAuth.llm =
      mode === "auth-paste"
        ? {
            provider,
            model: defaults.model,
            authToken: assertNotCancel(await password({ message: "Claude setup-token result" })),
          }
        : {
            provider,
            model: defaults.model,
            apiKey: assertNotCancel(await password({ message: "Anthropic API key" })),
          };
    return;
  }

  note(`Create or copy an API key here: ${defaults.keyUrl}`, `${defaults.label} key`);
  project.llm = { provider, model: defaults.model };
  socialAuth.llm = {
    provider,
    model: defaults.model,
    apiKey: assertNotCancel(await password({ message: `${defaults.label} API key` })),
  };
}

async function configureX(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "x", accountName);
  note(
    [
      "Create an X developer app and enable user authentication with read/write permissions.",
      "Developer portal: https://developer.x.com/en/portal/dashboard",
      "You need OAuth 1.0a consumer key/secret and access token/secret for media uploads.",
    ].join("\n"),
    "X credentials"
  );

  const account = ensureAccount(socialAuth, "x", accountName);
  account.consumerKey = assertNotCancel(await password({ message: "X consumer key" }));
  account.consumerSecret = assertNotCancel(await password({ message: "X consumer secret" }));
  account.accessToken = assertNotCancel(await password({ message: "X access token" }));
  account.accessTokenSecret = assertNotCancel(await password({ message: "X access token secret" }));
}

async function configureLinkedIn(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "linkedin", accountName);
  note(
    [
      "Create a LinkedIn developer app and request member posting access.",
      "Developer apps: https://www.linkedin.com/developers/apps",
      "Practical walkthrough: https://marcusnoble.co.uk/2025-02-02-posting-to-linkedin-via-the-api/",
      "Author URN should look like: urn:li:person:abc123",
    ].join("\n"),
    "LinkedIn credentials"
  );

  const account = ensureAccount(socialAuth, "linkedin", accountName);
  account.accessToken = assertNotCancel(await password({ message: "LinkedIn access token" }));
  account.author = assertNotCancel(await text({ message: "LinkedIn personal author URN" }));
  account.version = assertNotCancel(
    await text({
      message: "LinkedIn API version",
      placeholder: "202602",
      defaultValue: "202602",
    })
  );
}

async function configureReddit(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  const target = ensureTarget(project, "reddit", accountName);
  note(
    [
      "Create a Reddit OAuth app. Script apps are simplest for personal testing.",
      "App console: https://www.reddit.com/prefs/apps",
      "Use OAuth scope: submit. Prefer a refresh token for CI.",
    ].join("\n"),
    "Reddit credentials"
  );

  const account = ensureAccount(socialAuth, "reddit", accountName);
  account.subreddit = assertNotCancel(
    await text({
      message: "Default subreddit for this account",
      placeholder: "reddit_api_test",
      defaultValue: String(account.subreddit ?? target.subreddit ?? "reddit_api_test"),
    })
  );
  account.clientId = assertNotCancel(await password({ message: "Reddit client id" }));
  account.clientSecret = assertNotCancel(await password({ message: "Reddit client secret" }));

  const authMode = assertNotCancel(
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
    account.refreshToken = assertNotCancel(await password({ message: "Reddit refresh token" }));
    delete account.username;
    delete account.password;
  } else {
    account.username = assertNotCancel(await text({ message: "Reddit username" }));
    account.password = assertNotCancel(await password({ message: "Reddit password" }));
    delete account.refreshToken;
  }

  account.userAgent = assertNotCancel(
    await text({
      message: "Reddit user agent",
      placeholder: "usp/0.1.0 by your_reddit_username",
      defaultValue: account.userAgent ? String(account.userAgent) : "usp/0.1.0",
    })
  );
}

async function configureTelegram(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  const target = ensureTarget(project, "telegram", accountName);
  note(
    [
      "Create a bot with BotFather, then add it to your channel/group if needed.",
      "BotFather: https://t.me/BotFather",
      "chat_id can be a numeric chat ID or a public channel username like @my_channel.",
    ].join("\n"),
    "Telegram credentials"
  );

  const account = ensureAccount(socialAuth, "telegram", accountName);
  account.botToken = assertNotCancel(await password({ message: "Telegram bot token" }));
  account.chatId = assertNotCancel(
    await text({
      message: "Default Telegram chat_id",
      placeholder: "@my_channel",
      defaultValue: String(account.chatId ?? target.chatId ?? ""),
    })
  );
}

async function configureAegea(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "aegea", accountName);
  note(
    [
      "Aegea posts use the normal author password flow.",
      "Local Docker default URL: http://localhost/",
      "The connector uploads images through Aegea, then saves and publishes the post.",
    ].join("\n"),
    "Aegea credentials"
  );

  const account = ensureAccount(socialAuth, "aegea", accountName);
  account.baseUrl = assertNotCancel(
    await text({
      message: "Aegea base URL",
      placeholder: "http://localhost/",
      defaultValue: String(account.baseUrl ?? "http://localhost/"),
    })
  );
  account.password = assertNotCancel(await password({ message: "Aegea author password" }));
}

async function configureBluesky(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "bluesky", accountName);
  note(
    [
      "Create a Bluesky app password, not your main account password.",
      "App passwords: https://bsky.app/settings/app-passwords",
      "Default PDS URL: https://bsky.social",
    ].join("\n"),
    "Bluesky credentials"
  );

  const account = ensureAccount(socialAuth, "bluesky", accountName);
  account.identifier = assertNotCancel(
    await text({
      message: "Bluesky handle or email",
      placeholder: "you.bsky.social",
      defaultValue: typeof account.identifier === "string" ? account.identifier : undefined,
    })
  );
  account.appPassword = assertNotCancel(await password({ message: "Bluesky app password" }));
  account.pdsUrl = assertNotCancel(
    await text({
      message: "Bluesky PDS URL",
      placeholder: "https://bsky.social",
      defaultValue: String(account.pdsUrl ?? "https://bsky.social"),
    })
  );
}

async function configureMastodon(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "mastodon", accountName);
  note(
    [
      "Create an access token in your Mastodon instance preferences.",
      "Required scopes: write:statuses and write:media.",
      "API docs: https://docs.joinmastodon.org/methods/statuses/",
    ].join("\n"),
    "Mastodon credentials"
  );

  const account = ensureAccount(socialAuth, "mastodon", accountName);
  account.instanceUrl = assertNotCancel(
    await text({
      message: "Mastodon instance URL",
      placeholder: "https://mastodon.social",
      defaultValue: String(account.instanceUrl ?? "https://mastodon.social"),
    })
  );
  account.accessToken = assertNotCancel(await password({ message: "Mastodon access token" }));
  account.visibility = assertNotCancel(
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

async function configureDiscord(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "discord", accountName);
  note(
    [
      "Discord incoming webhooks post into one channel without a bot token.",
      "In Discord: Channel settings -> Integrations -> Webhooks -> New Webhook -> Copy Webhook URL.",
      "Webhook docs: https://docs.discord.com/developers/resources/webhook#execute-webhook",
    ].join("\n"),
    "Discord credentials"
  );

  const account = ensureAccount(socialAuth, "discord", accountName);
  account.webhookUrl = assertNotCancel(await password({ message: "Discord webhook URL" }));
  account.threadId = assertNotCancel(
    await text({
      message: "Default Discord thread ID",
      placeholder: "Optional",
      defaultValue: typeof account.threadId === "string" ? account.threadId : "",
    })
  );
  account.username = assertNotCancel(
    await text({
      message: "Webhook display name",
      placeholder: "Ultimate Social Poster",
      defaultValue: typeof account.username === "string" ? account.username : "Ultimate Social Poster",
    })
  );
  account.avatarUrl = assertNotCancel(
    await text({
      message: "Webhook avatar URL",
      placeholder: "Optional",
      defaultValue: typeof account.avatarUrl === "string" ? account.avatarUrl : "",
    })
  );
}

async function configureThreads(socialAuth: UspConfig, project: UspConfig, accountName: string) {
  ensureTarget(project, "threads", accountName);
  note(
    [
      "Create a Meta app with the Threads use case and request Threads publishing access.",
      "Required scopes include threads_basic and threads_content_publish.",
      "The user id can be left as me for the token owner.",
    ].join("\n"),
    "Threads credentials"
  );

  const account = ensureAccount(socialAuth, "threads", accountName);
  account.accessToken = assertNotCancel(await password({ message: "Threads access token" }));
  account.userId = assertNotCancel(
    await text({
      message: "Threads user id",
      placeholder: "me",
      defaultValue: typeof account.userId === "string" ? account.userId : "me",
    })
  );
  account.replyControl = assertNotCancel(
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

async function deriveAccountName(platform: Platform, account: Record<string, unknown>) {
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

function renameProfileTarget(project: UspConfig, oldId: string, newId: string) {
  for (const profile of Object.values(project.profiles ?? {})) {
    profile.targets = profile.targets.map((id) => (id === oldId ? newId : id));
  }
}

function renameAccount(project: UspConfig, socialAuth: UspConfig, platform: Platform, oldName: string, newName: string) {
  if (oldName === newName) {
    return;
  }

  const accounts = accountsFor(socialAuth, platform);
  const account = accounts[oldName];
  if (!account) {
    return;
  }
  accounts[newName] = account;
  delete accounts[oldName];

  const oldTargetId = targetIdFor(platform, oldName);
  const newTargetId = targetIdFor(platform, newName);
  const target = project.targets?.[oldTargetId];
  if (target) {
    target.account = newName;
    if (oldTargetId !== newTargetId && !project.targets?.[newTargetId]) {
      project.targets![newTargetId] = target;
      delete project.targets![oldTargetId];
      renameProfileTarget(project, oldTargetId, newTargetId);
    }
  }
}

function deleteAccount(project: UspConfig, socialAuth: UspConfig, platform: Platform, accountName: string) {
  const accounts = accountsFor(socialAuth, platform);
  delete accounts[accountName];
  const removedTargets = Object.entries(project.targets ?? {})
    .filter(([, target]) => target.platform === platform && target.account === accountName)
    .map(([id]) => id);
  for (const id of removedTargets) {
    delete project.targets?.[id];
  }
  for (const profile of Object.values(project.profiles ?? {})) {
    profile.targets = profile.targets.filter((id) => !removedTargets.includes(id));
  }
}

async function configurePlatformAccount(
  platform: Platform,
  socialAuth: UspConfig,
  project: UspConfig,
  accountName: string
) {
  if (platform === "x") {
    await configureX(socialAuth, project, accountName);
  } else if (platform === "linkedin") {
    await configureLinkedIn(socialAuth, project, accountName);
  } else if (platform === "reddit") {
    await configureReddit(socialAuth, project, accountName);
  } else if (platform === "telegram") {
    await configureTelegram(socialAuth, project, accountName);
  } else if (platform === "aegea") {
    await configureAegea(socialAuth, project, accountName);
  } else if (platform === "bluesky") {
    await configureBluesky(socialAuth, project, accountName);
  } else if (platform === "mastodon") {
    await configureMastodon(socialAuth, project, accountName);
  } else if (platform === "discord") {
    await configureDiscord(socialAuth, project, accountName);
  } else {
    await configureThreads(socialAuth, project, accountName);
  }

  const account = accountsFor(socialAuth, platform)[accountName] ?? {};
  const derived = safeSegment((await deriveAccountName(platform, account)) ?? accountName);
  if (platform === "threads" && derived && derived !== "threads") {
    account.username = derived;
  }
  const finalName = safeSegment(
    assertNotCancel(
      await text({
        message: "Account name",
        defaultValue: derived,
        placeholder: derived,
      })
    )
  );
  renameAccount(project, socialAuth, platform, accountName, finalName);
  ensureTarget(project, platform, finalName);
  note(`${platform}.${finalName} saved.`, "Saved");
}

async function configureSocialPlatform(platform: Platform, socialAuth: UspConfig, project: UspConfig, projectPath: string) {
  for (;;) {
    const accounts = Object.keys(accountsFor(socialAuth, platform));
    const choice = assertNotCancel(
      await select({
        message: `${platform} accounts`,
        options: [
          ...accounts.map((name) => ({ value: `edit:${name}`, label: name, hint: "Configure or delete" })),
          { value: "add", label: "Add account" },
          { value: "back", label: "Back" },
        ],
      })
    ) as string;

    if (choice === "back") {
      return;
    }

    if (choice === "add") {
      await configurePlatformAccount(platform, socialAuth, project, `__new_${Date.now()}`);
      await writePlatformSocialAuth(platform, socialAuth);
      await writeConfigFile(projectPath, project);
      continue;
    }

    const accountName = choice.slice("edit:".length);
    const action = assertNotCancel(
      await select({
        message: `${platform}.${accountName}`,
        options: [
          { value: "configure", label: "Configure" },
          { value: "delete", label: "Delete" },
          { value: "back", label: "Back" },
        ],
      })
    ) as "configure" | "delete" | "back";

    if (action === "back") {
      continue;
    }
    if (action === "delete") {
      deleteAccount(project, socialAuth, platform, accountName);
      await writePlatformSocialAuth(platform, socialAuth);
      await writeConfigFile(projectPath, project);
      note(`${platform}.${accountName} deleted.`, "Deleted");
      continue;
    }
    await configurePlatformAccount(platform, socialAuth, project, accountName);
    await writePlatformSocialAuth(platform, socialAuth);
    await writeConfigFile(projectPath, project);
  }
}

async function configurePrompts(project: UspConfig) {
  const platform = assertNotCancel(
    await select({
      message: "Prompt platform",
      options: SOCIAL_PLATFORMS.map((item) => ({ value: item, label: item })),
    })
  ) as Platform;

  const current = project.prompts?.[platform] ?? DEFAULT_PLATFORM_PROMPTS[platform];
  note(current, `${platform} current prompt`);
  const action = assertNotCancel(
    await select({
      message: "Change prompt",
      options: [
        { value: "append", label: "Append" },
        { value: "replace", label: "Replace" },
        { value: "revert", label: "Revert to original" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "append" | "replace" | "revert" | "back";

  if (action === "back") {
    return;
  }
  project.prompts ??= {};
  if (action === "revert") {
    delete project.prompts[platform];
    note("Default prompt restored.", "Saved");
    return;
  }
  const value = assertNotCancel(
    await text({
      message: action === "append" ? "Prompt text to append" : "Replacement prompt",
      placeholder: "Return JSON only...",
    })
  );
  project.prompts[platform] = action === "append" ? [current, "", value].join("\n") : value;
  note("Prompt saved.", "Saved");
}

async function runInteractiveSetup() {
  intro("usp setup");
  const projectPath = await ensureProjectConfig();
  const loadedProject = await loadProjectConfig(projectPath);
  if (!loadedProject) {
    throw new Error(`Could not load project config at ${projectPath}.`);
  }

  const socialAuth = await loadSocialAuthConfig();
  const project = loadedProject.config;

  for (;;) {
    const section = assertNotCancel(
      await select({
        message: "Setup menu",
        options: [
          { value: "llm", label: "LLM provider", hint: llmStatus(project, socialAuth) },
          { value: "social", label: "Social auth", hint: socialSummary(project, socialAuth) },
          { value: "prompts", label: "Prompts", hint: "Customize platform prompts" },
          { value: "exit", label: "Exit" },
        ],
      })
    ) as "llm" | "social" | "prompts" | "exit";

    if (section === "exit") {
      await writeLlmAuth({ llm: socialAuth.llm });
      await writeConfigFile(loadedProject.path, project);
      outro(`Social auth is saved under ~/.config/usp/social-auth\nProject config is saved at ${loadedProject.path}`);
      return;
    }

    if (section === "llm") {
      await configureLlm(project, socialAuth);
      await writeLlmAuth({ llm: socialAuth.llm });
      await writeConfigFile(loadedProject.path, project);
      note("LLM settings saved. Pick another section or Exit.", "Saved");
      continue;
    }

    if (section === "prompts") {
      await configurePrompts(project);
      await writeConfigFile(loadedProject.path, project);
      continue;
    }

    const platform = assertNotCancel(
      await select({
        message: "Social auth",
        options: [
          { value: "x", label: "X", hint: `API posting with media, ${statusHint(platformStatus(project, socialAuth, "x"))}` },
          { value: "linkedin", label: "LinkedIn", hint: `Personal profile posts, ${statusHint(platformStatus(project, socialAuth, "linkedin"))}` },
          { value: "reddit", label: "Reddit", hint: `One subreddit target, ${statusHint(platformStatus(project, socialAuth, "reddit"))}` },
          { value: "telegram", label: "Telegram", hint: `Channel, group, or chat, ${statusHint(platformStatus(project, socialAuth, "telegram"))}` },
          { value: "aegea", label: "Aegea", hint: `Blog post via password login, ${statusHint(platformStatus(project, socialAuth, "aegea"))}` },
          { value: "bluesky", label: "Bluesky", hint: `API posts and threads, ${statusHint(platformStatus(project, socialAuth, "bluesky"))}` },
          { value: "mastodon", label: "Mastodon", hint: `Instance API posts and threads, ${statusHint(platformStatus(project, socialAuth, "mastodon"))}` },
          { value: "discord", label: "Discord", hint: `Incoming webhook, ${statusHint(platformStatus(project, socialAuth, "discord"))}` },
          { value: "threads", label: "Threads", hint: `API posts and reply chains, ${statusHint(platformStatus(project, socialAuth, "threads"))}` },
          { value: "back", label: "Back" },
        ],
      })
    ) as Platform | "back";

    if (platform === "back") {
      continue;
    }

    await configureSocialPlatform(platform, socialAuth, project, loadedProject.path);
  }
}

export async function setupCommand(options: { platform?: Platform; account?: string; value?: string[] } = {}) {
  if (options.platform) {
    await ensureProjectConfig();
    if (!["x", "linkedin", "reddit", "telegram", "aegea", "bluesky", "mastodon", "discord", "threads"].includes(options.platform)) {
      throw new Error(`Unsupported platform: ${options.platform}`);
    }
    const config = await loadSocialAuthConfig();
    const name = options.account ?? PLATFORM_ACCOUNT_NAMES[options.platform];
    const account = ensureAccount(config, options.platform, name);
    applyValues(account, options.value);
    const path = await writePlatformSocialAuth(options.platform, config);
    console.log(`Saved ${options.platform}.${name} credentials to ${path}`);
    return;
  }

  await runInteractiveSetup();
}
