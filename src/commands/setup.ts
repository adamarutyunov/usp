import {
  confirm,
  intro,
  isCancel,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";
import pc from "yoctocolors";

import {
  findProjectConfig,
  loadGlobalConfig,
  loadProjectConfig,
  loadSocialAuthConfig,
  writeConfigFile,
  writeGlobalConfig,
  writeProjectConfig,
  writeSocialAuthConfig,
} from "../config/config.js";
import { BASE_GUIDANCE, DEFAULT_PLATFORM_PROMPTS } from "../llm/prompts.js";
import type { LlmProvider, Platform, TargetRouting, UspConfig } from "../types.js";
import { SAMPLE_CONFIG } from "./init.js";
import { pickPostTargets, type PostTargetRow } from "./post-picker.js";
import { browseTargets, rowKey, type TreeRow } from "./target-tree.js";

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

const MODEL_SUGGESTIONS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-5.4", "gpt-5.4-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
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

/** Thrown when a prompt is cancelled (Esc / Ctrl+C). Caught by the nearest menu loop, which treats it as "back". */
class SetupBack {}

function orBack<T>(value: T | symbol): T {
  if (isCancel(value)) {
    throw new SetupBack();
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

// The single routing field a platform needs per target. Platforms not listed have no
// routing — their targets are prompt-only variants of the account's one destination.
const ROUTING_FIELDS: Partial<Record<Platform, { key: "subreddit" | "chatId" | "threadId"; label: string; placeholder: string; required: boolean }>> = {
  reddit: { key: "subreddit", label: "Subreddit", placeholder: "reddit_api_test", required: true },
  telegram: { key: "chatId", label: "Chat id", placeholder: "@my_channel", required: true },
  discord: { key: "threadId", label: "Thread id", placeholder: "(optional)", required: false },
};

type ProjectAccount = Record<string, unknown> & { targets?: Record<string, TargetRouting> };

function projectAccount(project: UspConfig, platform: Platform, accountName: string): ProjectAccount & { targets: Record<string, TargetRouting> } {
  project.accounts ??= {};
  const platformAccounts = ((project.accounts as Record<string, Record<string, ProjectAccount>>)[platform] ??= {});
  const account = (platformAccounts[accountName] ??= {});
  account.targets ??= {};
  return account as ProjectAccount & { targets: Record<string, TargetRouting> };
}

function fullTargetId(platform: Platform, accountName: string, targetName: string) {
  return `${platform}/${accountName}/${targetName}`;
}

/** Keep profiles.default pointing at every configured target so `--profile default` stays complete. */
function rebuildDefaultProfile(project: UspConfig) {
  const ids: string[] = [];
  for (const [platform, accounts] of Object.entries(project.accounts ?? {})) {
    for (const [accountName, account] of Object.entries((accounts ?? {}) as Record<string, ProjectAccount>)) {
      for (const targetName of Object.keys(account.targets ?? {})) {
        ids.push(fullTargetId(platform as Platform, accountName, targetName));
      }
    }
  }
  project.profiles ??= {};
  project.profiles.default = { targets: ids };
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
  const model = llm.model ?? LLM_DEFAULTS[llm.provider].model;
  return `${llm.provider}, ${auth}, ${model}`;
}

const PLATFORM_INFO: Record<Platform, { label: string; hint: string }> = {
  x: { label: "X", hint: "API posting with media" },
  linkedin: { label: "LinkedIn", hint: "Personal profile posts" },
  reddit: { label: "Reddit", hint: "One subreddit target" },
  telegram: { label: "Telegram", hint: "Channel, group, or chat" },
  aegea: { label: "Aegea", hint: "Blog post via password login" },
  bluesky: { label: "Bluesky", hint: "API posts and threads" },
  mastodon: { label: "Mastodon", hint: "Instance API posts and threads" },
  discord: { label: "Discord", hint: "Incoming webhook" },
  threads: { label: "Threads", hint: "API posts and reply chains" },
};

function targetsSummary(project: UspConfig, socialAuth: UspConfig) {
  const accounts = listAccounts(socialAuth, project);
  if (accounts.length === 0) {
    return "none yet";
  }
  const targets = accounts.reduce((sum, { platform, name }) => sum + Object.keys(readTargets(project, platform, name)).length, 0);
  return `${accounts.length} account${accounts.length === 1 ? "" : "s"}, ${targets} target${targets === 1 ? "" : "s"}`;
}

async function authenticateLlm(provider: LlmProvider, model: string, project: UspConfig, socialAuth: UspConfig) {
  const defaults = LLM_DEFAULTS[provider];

  if (provider === "anthropic") {
    note(
      [
        "API key path: https://console.anthropic.com/settings/keys",
        "Claude Code token path: run `claude setup-token`, then paste the result here.",
      ].join("\n"),
      "Anthropic auth"
    );
    const mode = orBack(
      await select({
        message: "How should usp authenticate Anthropic?",
        initialValue: "auth-paste",
        options: [
          { value: "auth-paste", label: "Paste Claude setup-token result", hint: "Saved under social-auth" },
          { value: "api-paste", label: "Paste API key now", hint: "Saved under social-auth" },
        ],
      })
    ) as "auth-paste" | "api-paste";

    project.llm = { provider, model };
    socialAuth.llm =
      mode === "auth-paste"
        ? { provider, model, authToken: orBack(await password({ message: "Claude setup-token result" })) }
        : { provider, model, apiKey: orBack(await password({ message: "Anthropic API key" })) };
    return;
  }

  note(`Create or copy an API key here: ${defaults.keyUrl}`, `${defaults.label} key`);
  project.llm = { provider, model };
  socialAuth.llm = {
    provider,
    model,
    apiKey: orBack(await password({ message: `${defaults.label} API key` })),
  };
}

async function selectLlmModel(provider: LlmProvider, currentModel: string) {
  const suggestions = MODEL_SUGGESTIONS[provider];
  const choice = orBack(
    await select({
      message: "Model",
      initialValue: currentModel,
      options: [
        ...suggestions.map((id) => ({ value: id, label: id, ...(id === currentModel ? { hint: "current" } : {}) })),
        ...(suggestions.includes(currentModel) ? [] : [{ value: currentModel, label: currentModel, hint: "current" }]),
        { value: "__custom", label: "Custom…", hint: "Enter a model id" },
      ],
    })
  ) as string;

  if (choice !== "__custom") {
    return choice;
  }
  const custom = orBack(
    await text({ message: "Model id", defaultValue: currentModel, placeholder: currentModel })
  );
  return custom.trim() || currentModel;
}

async function configureLlm(project: UspConfig, socialAuth: UspConfig) {
  const authedProvider = socialAuth.llm?.provider;
  const provider = orBack(
    await select({
      message: "Choose your LLM provider",
      initialValue: authedProvider ?? project.llm?.provider ?? "anthropic",
      options: [
        { value: "anthropic", label: "Anthropic", hint: "Claude, recommended" },
        { value: "openai", label: "OpenAI", hint: "GPT models" },
        { value: "gemini", label: "Gemini", hint: "Google AI Studio" },
      ],
    })
  ) as LlmProvider;

  const currentModel =
    (socialAuth.llm?.provider === provider && socialAuth.llm.model) ||
    (project.llm?.provider === provider && project.llm.model) ||
    LLM_DEFAULTS[provider].model;

  // A provider that isn't authenticated yet has nothing to "change" — go straight to auth.
  if (provider !== authedProvider) {
    await authenticateLlm(provider, currentModel, project, socialAuth);
    return;
  }

  const authLabel = socialAuth.llm?.authToken ? "Claude token" : socialAuth.llm?.apiKey ? "API key" : "auth pending";
  const action = orBack(
    await select({
      message: `${LLM_DEFAULTS[provider].label} setup`,
      options: [
        { value: "reauth", label: "Reauthenticate", hint: authLabel },
        { value: "model", label: "Change model", hint: currentModel },
        { value: "back", label: "Back" },
      ],
    })
  ) as "reauth" | "model" | "back";

  if (action === "back") {
    return;
  }
  if (action === "model") {
    const model = await selectLlmModel(provider, currentModel);
    project.llm = { provider, model };
    socialAuth.llm = { ...(socialAuth.llm ?? {}), provider, model };
    note(`Model set to ${model}.`, "Saved");
    return;
  }

  await authenticateLlm(provider, currentModel, project, socialAuth);
}

async function configureX(account: Record<string, unknown>) {
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

async function configureLinkedIn(account: Record<string, unknown>) {
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

async function configureReddit(account: Record<string, unknown>) {
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

async function configureTelegram(account: Record<string, unknown>) {
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

async function configureAegea(account: Record<string, unknown>) {
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

async function configureBluesky(account: Record<string, unknown>) {
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

async function configureMastodon(account: Record<string, unknown>) {
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

async function configureDiscord(account: Record<string, unknown>) {
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

async function configureThreads(account: Record<string, unknown>) {
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

function deleteAccount(project: UspConfig, socialAuth: UspConfig, platform: Platform, accountName: string) {
  delete accountsFor(socialAuth, platform)[accountName];
  const projectAccounts = project.accounts?.[platform] as Record<string, unknown> | undefined;
  delete projectAccounts?.[accountName];
  rebuildDefaultProfile(project);
}

async function configureCredentials(platform: Platform, account: Record<string, unknown>) {
  if (platform === "x") await configureX(account);
  else if (platform === "linkedin") await configureLinkedIn(account);
  else if (platform === "reddit") await configureReddit(account);
  else if (platform === "telegram") await configureTelegram(account);
  else if (platform === "aegea") await configureAegea(account);
  else if (platform === "bluesky") await configureBluesky(account);
  else if (platform === "mastodon") await configureMastodon(account);
  else if (platform === "discord") await configureDiscord(account);
  else await configureThreads(account);
}

function readTargets(project: UspConfig, platform: Platform, accountName: string): Record<string, TargetRouting> {
  return ((project.accounts?.[platform] as Record<string, ProjectAccount> | undefined)?.[accountName]?.targets) ?? {};
}

function listAccounts(socialAuth: UspConfig, project: UspConfig) {
  const seen = new Map<string, { platform: Platform; name: string }>();
  for (const source of [socialAuth.accounts, project.accounts]) {
    for (const [platform, accounts] of Object.entries(source ?? {})) {
      for (const name of Object.keys(accounts ?? {})) {
        seen.set(`${platform}:${name}`, { platform: platform as Platform, name });
      }
    }
  }
  return [...seen.values()];
}

async function editTargetRouting(project: UspConfig, platform: Platform, accountName: string, targetName: string) {
  const routing = ROUTING_FIELDS[platform];
  if (!routing) {
    return;
  }
  const target = projectAccount(project, platform, accountName).targets[targetName]!;
  const current = (target as Record<string, unknown>)[routing.key];
  const value = orBack(
    await text({
      message: routing.label,
      placeholder: routing.placeholder,
      defaultValue: typeof current === "string" ? current : "",
      validate: routing.required ? (input) => (input?.trim() ? undefined : `${routing.label} is required.`) : undefined,
    })
  ).trim();
  if (value) {
    (target as Record<string, unknown>)[routing.key] = value;
  } else {
    delete (target as Record<string, unknown>)[routing.key];
  }
}

async function editTargetPrompt(project: UspConfig, platform: Platform, accountName: string, targetName: string) {
  const target = projectAccount(project, platform, accountName).targets[targetName]!;
  if (target.prompt) {
    note(target.prompt.text, `Current override (${target.prompt.mode})`);
  }
  const action = orBack(
    await select({
      message: "Target prompt",
      options: [
        { value: "append", label: "Append", hint: "Add after the platform rules" },
        { value: "replace", label: "Replace", hint: "Use only your text" },
        { value: "clear", label: "Clear override" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "append" | "replace" | "clear" | "back";

  if (action === "back") return;
  if (action === "clear") {
    delete target.prompt;
    return;
  }
  const value = orBack(
    await text({
      message: action === "append" ? "Text to append" : "Replacement prompt",
      defaultValue: target.prompt?.mode === action ? target.prompt.text : undefined,
    })
  );
  target.prompt = { mode: action, text: value };
}

function buildTreeRows(socialAuth: UspConfig, project: UspConfig): TreeRow[] {
  const byPlatform = new Map<Platform, string[]>();
  for (const { platform, name } of listAccounts(socialAuth, project)) {
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), name]);
  }

  const rows: TreeRow[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const accounts = byPlatform.get(platform);
    if (!accounts?.length) {
      continue;
    }
    const platformPrompt = project.prompts?.[platform];
    rows.push({
      kind: "platform",
      platform,
      label: PLATFORM_INFO[platform].label,
      promptBadge: platformPrompt ? `prompt: ${platformPrompt.mode}` : undefined,
    });

    const routing = ROUTING_FIELDS[platform];
    for (const account of [...accounts].sort()) {
      const targets = Object.entries(readTargets(project, platform, account));
      rows.push({ kind: "account", platform, account, label: account, status: `${targets.length} target${targets.length === 1 ? "" : "s"}` });

      for (const [name, target] of targets) {
        const dest = routing ? (target as Record<string, unknown>)[routing.key] : undefined;
        const destText = typeof dest === "string" && dest.trim() ? dest : undefined;
        rows.push({
          kind: "target",
          platform,
          account,
          target: name,
          label: name,
          routing: destText,
          needsDestination: Boolean(routing?.required) && !destText,
          promptBadge: target.prompt ? target.prompt.mode : undefined,
        });
      }
    }
  }
  rows.push({ kind: "add-account" });
  return rows;
}

async function editPlatformPrompt(project: UspConfig, platform: Platform) {
  note(DEFAULT_PLATFORM_PROMPTS[platform], `${PLATFORM_INFO[platform].label} rules`);
  const existing = project.prompts?.[platform];
  if (existing) {
    note(existing.text, `Override (${existing.mode})`);
  }
  const action = orBack(
    await select({
      message: `${PLATFORM_INFO[platform].label} prompt`,
      options: [
        { value: "append", label: "Append", hint: "Add after the platform rules" },
        { value: "replace", label: "Replace", hint: "Use only your text" },
        { value: "clear", label: "Clear override" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "append" | "replace" | "clear" | "back";

  if (action === "back") return;
  project.prompts ??= {};
  if (action === "clear") {
    delete project.prompts[platform];
    note("Reverted to default rules.", "Saved");
    return;
  }
  const value = orBack(
    await text({
      message: action === "append" ? "Text to append" : "Replacement prompt",
      defaultValue: existing?.mode === action ? existing.text : undefined,
    })
  );
  project.prompts[platform] = { mode: action, text: value };
  note("Prompt saved.", "Saved");
}

async function addAccountFlow(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform?: Platform) {
  let chosen = platform;
  if (!chosen) {
    const pick = orBack(
      await select({
        message: "Platform for the new account",
        options: [
          ...SOCIAL_PLATFORMS.map((item) => ({ value: item, label: PLATFORM_INFO[item].label, hint: PLATFORM_INFO[item].hint })),
          { value: "back", label: "Back" },
        ],
      })
    ) as Platform | "back";
    if (pick === "back") return;
    chosen = pick;
  }

  // Gather everything into detached objects and commit only once every prompt is answered,
  // so escaping mid-setup never leaves an abandoned account or target behind.
  const account: Record<string, unknown> = {};
  await configureCredentials(chosen, account);

  const derived = safeSegment((await deriveAccountName(chosen, account)) ?? chosen);
  if (chosen === "threads" && derived && derived !== "threads") {
    account.username = derived;
  }
  const name = safeSegment(
    orBack(await text({ message: "Account name", defaultValue: derived, placeholder: derived }))
  );

  // Routing platforms need a destination, so the first target is created right away with one.
  // Other platforms post to the account's own feed, so a `default` target is enough.
  const routing = ROUTING_FIELDS[chosen];
  let targetName = "default";
  const targetRouting: TargetRouting = {};
  if (routing) {
    targetName = safeSegment(orBack(await text({ message: "Target name", placeholder: "channel" })));
    const value = orBack(
      await text({
        message: routing.label,
        placeholder: routing.placeholder,
        validate: routing.required ? (input) => (input?.trim() ? undefined : `${routing.label} is required.`) : undefined,
      })
    ).trim();
    if (value) (targetRouting as Record<string, unknown>)[routing.key] = value;
  }

  accountsFor(socialAuth, chosen)[name] = account;
  projectAccount(project, chosen, name).targets[targetName] = targetRouting;
  rebuildDefaultProfile(project);
  await writePlatformSocialAuth(chosen, socialAuth);
  await writeConfigFile(projectPath, project);
  note(`${PLATFORM_INFO[chosen].label} · ${name} saved.`, "Saved");
}

async function addTargetFlow(project: UspConfig, projectPath: string, platform: Platform, accountName: string) {
  const routing = ROUTING_FIELDS[platform];
  const name = safeSegment(
    orBack(await text({ message: "Target name", placeholder: routing ? "channel" : "language or variant" }))
  );

  const target: TargetRouting = {};
  if (routing) {
    const value = orBack(
      await text({
        message: routing.label,
        placeholder: routing.placeholder,
        validate: routing.required ? (input) => (input?.trim() ? undefined : `${routing.label} is required.`) : undefined,
      })
    ).trim();
    if (value) {
      (target as Record<string, unknown>)[routing.key] = value;
    }
  }

  projectAccount(project, platform, accountName).targets[name] = target;
  rebuildDefaultProfile(project);
  await writeConfigFile(projectPath, project);
}

async function manageTargetNode(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform: Platform, account: string, targetName: string) {
  const routing = ROUTING_FIELDS[platform];
  const action = orBack(
    await select({
      message: fullTargetId(platform, account, targetName),
      options: [
        { value: "prompt", label: "Edit prompt" },
        ...(routing ? [{ value: "destination", label: `Set ${routing.label.toLowerCase()}` }] : []),
        { value: "delete", label: "Delete target" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "prompt" | "destination" | "delete" | "back";

  if (action === "back") return;
  if (action === "prompt") {
    await editTargetPrompt(project, platform, account, targetName);
  } else if (action === "destination") {
    await editTargetRouting(project, platform, account, targetName);
    rebuildDefaultProfile(project);
  } else if (action === "delete") {
    const ok = await confirm({ message: `Delete target ${fullTargetId(platform, account, targetName)}?`, initialValue: false });
    if (isCancel(ok) || !ok) return;
    delete projectAccount(project, platform, account).targets[targetName];
    rebuildDefaultProfile(project);
    note("Target deleted.", "Deleted");
  }
  await writeConfigFile(projectPath, project);
}

async function manageAccountNode(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform: Platform, account: string) {
  const action = orBack(
    await select({
      message: `${PLATFORM_INFO[platform].label} · ${account}`,
      options: [
        { value: "add-target", label: "Add target" },
        { value: "credentials", label: "Edit credentials" },
        { value: "delete", label: "Delete account" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "add-target" | "credentials" | "delete" | "back";

  if (action === "back") return;
  if (action === "add-target") {
    await addTargetFlow(project, projectPath, platform, account);
  } else if (action === "credentials") {
    const edited = { ...ensureAccount(socialAuth, platform, account) };
    await configureCredentials(platform, edited); // commit only if every prompt is answered
    accountsFor(socialAuth, platform)[account] = edited;
    await writePlatformSocialAuth(platform, socialAuth);
    note("Credentials updated.", "Saved");
  } else if (action === "delete") {
    const ok = await confirm({ message: `Delete account ${PLATFORM_INFO[platform].label} · ${account} and its targets?`, initialValue: false });
    if (isCancel(ok) || !ok) return;
    deleteAccount(project, socialAuth, platform, account);
    await writePlatformSocialAuth(platform, socialAuth);
    await writeConfigFile(projectPath, project);
    note("Account deleted.", "Deleted");
  }
}

async function managePlatformNode(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform: Platform) {
  const action = orBack(
    await select({
      message: PLATFORM_INFO[platform].label,
      options: [
        { value: "prompt", label: "Edit platform prompt" },
        { value: "add-account", label: "Add account" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "prompt" | "add-account" | "back";

  if (action === "back") return;
  if (action === "prompt") {
    await editPlatformPrompt(project, platform);
    await writeConfigFile(projectPath, project);
  } else if (action === "add-account") {
    await addAccountFlow(socialAuth, project, projectPath, platform);
  }
}

async function dispatchTreeSelection(row: TreeRow, socialAuth: UspConfig, project: UspConfig, projectPath: string) {
  if (row.kind === "add-account") {
    await addAccountFlow(socialAuth, project, projectPath);
  } else if (row.kind === "platform") {
    await managePlatformNode(socialAuth, project, projectPath, row.platform);
  } else if (row.kind === "account") {
    await manageAccountNode(socialAuth, project, projectPath, row.platform, row.account);
  } else {
    await manageTargetNode(socialAuth, project, projectPath, row.platform, row.account, row.target);
  }
}

async function configureTargets(socialAuth: UspConfig, project: UspConfig, projectPath: string) {
  let selectedKey: string | undefined;
  for (;;) {
    const action = await browseTargets(buildTreeRows(socialAuth, project), { selectedKey });
    if (action.kind === "done") return;
    selectedKey = rowKey(action.row); // re-enter on the same node after the sub-menu closes
    try {
      await dispatchTreeSelection(action.row, socialAuth, project, projectPath);
    } catch (error) {
      if (error instanceof SetupBack) continue;
      throw error;
    }
  }
}

async function configureGlobalPrompt() {
  const global = await loadGlobalConfig();
  note(BASE_GUIDANCE, "Base prompt (fixed)");
  if (global.globalPrompt) {
    note(global.globalPrompt, "Your global rules");
  }
  const action = orBack(
    await select({
      message: "Global prompt (appended to every prompt)",
      options: [
        { value: "edit", label: global.globalPrompt ? "Edit global rules" : "Add global rules" },
        ...(global.globalPrompt ? [{ value: "clear", label: "Clear" }] : []),
        { value: "back", label: "Back" },
      ],
    })
  ) as "edit" | "clear" | "back";

  if (action === "back") return;
  if (action === "clear") {
    delete global.globalPrompt;
    await writeGlobalConfig(global);
    note("Cleared.", "Saved");
    return;
  }
  const value = orBack(
    await text({
      message: "Global rules (appended to every prompt)",
      defaultValue: global.globalPrompt,
      placeholder: "e.g. Always write in British English.",
    })
  ).trim();
  if (value) {
    global.globalPrompt = value;
  } else {
    delete global.globalPrompt;
  }
  await writeGlobalConfig(global);
  note("Global prompt saved.", "Saved");
}

async function configurePostingDefaults(project: UspConfig) {
  const targets = Object.entries(project.targets ?? {});
  if (targets.length === 0) {
    note("No targets configured yet. Add a target first.", "Default posting");
    return;
  }

  const global = await loadGlobalConfig();
  const rows: PostTargetRow[] = targets.map(([id, target]) => ({
    id,
    platform: target.platform,
    account: target.account,
    mode: global.postingDefaults?.[id] ?? "off",
  }));

  const selection = await pickPostTargets(rows, { message: "Default posting per target" });
  if (selection === null) {
    return;
  }

  global.postingDefaults = Object.fromEntries(selection.map((row) => [row.id, row.mode]));
  await writeGlobalConfig(global);
  note("Default posting saved.", "Saved");
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

  let lastSection: string | undefined;
  for (;;) {
    let section: "llm" | "targets" | "prompts" | "posting" | "exit";
    try {
      section = orBack(
        await select({
          message: "Setup menu",
          initialValue: lastSection, // keep the cursor where it was after returning from a section
          options: [
            { value: "targets", label: "Targets", hint: targetsSummary(project, socialAuth) },
            { value: "llm", label: "LLM provider", hint: llmStatus(project, socialAuth) },
            { value: "prompts", label: "Global prompt", hint: "global rules appended to every prompt" },
            { value: "posting", label: "Default posting", hint: "per-target defaults for the publish picker" },
            { value: "exit", label: "Exit" },
          ],
        })
      ) as "llm" | "targets" | "prompts" | "posting" | "exit";
      lastSection = section;
    } catch (error) {
      // Cancelling the top-level menu exits the wizard (saving first).
      if (error instanceof SetupBack) {
        section = "exit";
      } else {
        throw error;
      }
    }

    if (section === "exit") {
      await writeLlmAuth({ llm: socialAuth.llm });
      await writeConfigFile(loadedProject.path, project);
      outro(`Social auth is saved under ~/.config/usp/social-auth\nProject config is saved at ${loadedProject.path}`);
      return;
    }

    // Cancelling anything inside a section drops back to this menu.
    try {
      if (section === "llm") {
        await configureLlm(project, socialAuth);
        await writeLlmAuth({ llm: socialAuth.llm });
        await writeConfigFile(loadedProject.path, project);
        note("LLM settings saved. Pick another section or Exit.", "Saved");
        continue;
      }

      if (section === "prompts") {
        await configureGlobalPrompt();
        continue;
      }

      if (section === "posting") {
        await configurePostingDefaults(project);
        continue;
      }

      await configureTargets(socialAuth, project, loadedProject.path);
    } catch (error) {
      if (error instanceof SetupBack) continue;
      throw error;
    }
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
