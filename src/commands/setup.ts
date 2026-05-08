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
import type { LlmProvider, Platform, UspConfig } from "../types.js";
import { SAMPLE_CONFIG } from "./init.js";

const PLATFORM_ACCOUNT_NAMES: Record<Platform, string> = {
  x: "main",
  linkedin: "me",
  reddit: "main",
  telegram: "main",
};

const TARGET_IDS: Record<Platform, string> = {
  x: "x-main",
  linkedin: "linkedin-me",
  reddit: "reddit-release",
  telegram: "telegram-channel",
};

const LLM_DEFAULTS: Record<LlmProvider, { model: string; env: string; keyUrl: string; label: string }> = {
  gemini: {
    model: "gemini-2.5-flash-lite",
    env: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/app/apikey",
    label: "Gemini",
  },
  openai: {
    model: "gpt-5.4-mini",
    env: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    label: "OpenAI",
  },
  anthropic: {
    model: "claude-sonnet-4-5",
    env: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    label: "Anthropic",
  },
};

const SOCIAL_PLATFORMS: Platform[] = ["x", "linkedin", "reddit", "telegram"];

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

async function writePlatformSocialAuth(platform: Platform, account: Record<string, unknown>) {
  const accountName = PLATFORM_ACCOUNT_NAMES[platform];
  return writeSocialAuthConfig(`${platform}.yml`, {
    accounts: {
      [platform]: {
        [accountName]: account,
      },
    },
  } as UspConfig);
}

async function writeLlmAuth(config: UspConfig) {
  if (!config.llm) {
    return undefined;
  }
  return writeSocialAuthConfig("llm.yml", config);
}

function ensureTarget(project: UspConfig, platform: Platform) {
  const id = TARGET_IDS[platform];
  project.targets ??= {};
  project.targets[id] ??= {
    platform,
    account: PLATFORM_ACCOUNT_NAMES[platform],
  };
  project.targets[id]!.platform = platform;
  project.targets[id]!.account = PLATFORM_ACCOUNT_NAMES[platform];

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

function accountFor(config: UspConfig, platform: Platform) {
  return config.accounts?.[platform]?.[PLATFORM_ACCOUNT_NAMES[platform]] as
    | Record<string, unknown>
    | undefined;
}

function llmStatus(project: UspConfig, socialAuth: UspConfig) {
  const llm = socialAuth.llm ?? project.llm;
  if (!llm?.provider) {
    return "not set";
  }

  const auth =
    llm.authSource === "codex"
      ? "Codex"
      : llm.authSource === "anthropic-auth-token" || llm.authToken || llm.authTokenEnv
        ? "Claude token"
        : llm.apiKey || llm.apiKeyEnv
          ? "API key"
          : "auth pending";
  return `${llm.provider}, ${auth}`;
}

function platformStatus(project: UspConfig, socialAuth: UspConfig, platform: Platform) {
  const account = accountFor(socialAuth, platform);
  const target = project.targets?.[TARGET_IDS[platform]];

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
      hasValue(target?.subreddit)
      ? "set"
      : "not set";
  }

  return account && hasValue(account.botToken) && hasValue(target?.chatId) ? "set" : "not set";
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

  project.llm = {
    provider,
    model: defaults.model,
    apiKeyEnv: defaults.env,
  };

  if (provider === "openai") {
    note(
      [
        "Browser login path: run `codex login` first. usp will read ~/.codex/auth.json.",
        "API key path: https://platform.openai.com/api-keys",
        "Default env var: OPENAI_API_KEY",
      ].join("\n"),
      "OpenAI auth"
    );
    const mode = assertNotCancel(
      await select({
        message: "How should usp authenticate OpenAI?",
        initialValue: "codex",
        options: [
          { value: "codex", label: "Use Codex browser login", hint: "~/.codex/auth.json" },
          { value: "env", label: "Use env var", hint: "OPENAI_API_KEY" },
          { value: "paste", label: "Paste API key now", hint: "Saved under social-auth" },
        ],
      })
    ) as "codex" | "env" | "paste";

    project.llm = {
      provider,
      model: defaults.model,
      ...(mode === "codex" ? { authSource: "codex" as const } : { apiKeyEnv: defaults.env }),
    };
    socialAuth.llm =
      mode === "paste"
        ? {
            provider,
            model: defaults.model,
            apiKey: assertNotCancel(await password({ message: "OpenAI API key" })),
          }
        : mode === "codex"
          ? { provider, model: defaults.model, authSource: "codex" }
          : { provider, model: defaults.model, apiKeyEnv: defaults.env };
    return;
  }

  if (provider === "anthropic") {
    note(
      [
        "API key path: https://console.anthropic.com/settings/keys",
        "Claude Code token path: run `claude setup-token`, then paste the result here.",
        "Anthropic documents ANTHROPIC_AUTH_TOKEN as a bearer Authorization token for Claude Code style auth.",
      ].join("\n"),
      "Anthropic auth"
    );
    const mode = assertNotCancel(
      await select({
        message: "How should usp authenticate Anthropic?",
        initialValue: "auth-paste",
        options: [
          { value: "auth-paste", label: "Paste Claude setup-token result", hint: "Saved under social-auth" },
          { value: "api-env", label: "Use ANTHROPIC_API_KEY", hint: "API key env var" },
          { value: "api-paste", label: "Paste API key now", hint: "Saved under social-auth" },
        ],
      })
    ) as "auth-paste" | "api-env" | "api-paste";

    project.llm = {
      provider,
      model: defaults.model,
      ...(mode === "auth-paste"
        ? { authSource: "anthropic-auth-token" as const, authTokenEnv: "ANTHROPIC_AUTH_TOKEN" }
        : { apiKeyEnv: "ANTHROPIC_API_KEY" }),
    };
    socialAuth.llm =
      mode === "auth-paste"
        ? {
            provider,
            model: defaults.model,
            authSource: "anthropic-auth-token",
            authToken: assertNotCancel(await password({ message: "Claude setup-token result" })),
          }
        : mode === "api-paste"
            ? {
                provider,
                model: defaults.model,
                apiKey: assertNotCancel(await password({ message: "Anthropic API key" })),
              }
            : { provider, model: defaults.model, apiKeyEnv: "ANTHROPIC_API_KEY" };
    return;
  }

  note(
    [`Create or copy an API key here: ${defaults.keyUrl}`, `Default env var: ${defaults.env}`].join("\n"),
    `${defaults.label} key`
  );
  const secretMode = assertNotCancel(
    await select({
      message: "How should usp store the LLM key?",
      initialValue: "env",
      options: [
        { value: "env", label: "Use env var", hint: defaults.env },
        { value: "paste", label: "Paste key now", hint: "Saved under social-auth" },
      ],
    })
  ) as "env" | "paste";

  if (secretMode === "paste") {
    socialAuth.llm = {
      provider,
      model: defaults.model,
      apiKey: assertNotCancel(await password({ message: `${defaults.label} API key` })),
    };
  } else {
    socialAuth.llm = {
      provider,
      model: defaults.model,
      apiKeyEnv: defaults.env,
    };
  }
}

async function configureX(socialAuth: UspConfig, project: UspConfig) {
  ensureTarget(project, "x");
  note(
    [
      "Create an X developer app and enable user authentication with read/write permissions.",
      "Developer portal: https://developer.x.com/en/portal/dashboard",
      "You need OAuth 1.0a consumer key/secret and access token/secret for media uploads.",
    ].join("\n"),
    "X credentials"
  );

  const account = ensureAccount(socialAuth, "x");
  account.consumerKey = assertNotCancel(await password({ message: "X consumer key" }));
  account.consumerSecret = assertNotCancel(await password({ message: "X consumer secret" }));
  account.accessToken = assertNotCancel(await password({ message: "X access token" }));
  account.accessTokenSecret = assertNotCancel(await password({ message: "X access token secret" }));
}

async function configureLinkedIn(socialAuth: UspConfig, project: UspConfig) {
  ensureTarget(project, "linkedin");
  note(
    [
      "Create a LinkedIn developer app and request member posting access.",
      "Developer apps: https://www.linkedin.com/developers/apps",
      "Practical walkthrough: https://marcusnoble.co.uk/2025-02-02-posting-to-linkedin-via-the-api/",
      "Author URN should look like: urn:li:person:abc123",
    ].join("\n"),
    "LinkedIn credentials"
  );

  const account = ensureAccount(socialAuth, "linkedin");
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

async function configureReddit(socialAuth: UspConfig, project: UspConfig) {
  const target = ensureTarget(project, "reddit");
  note(
    [
      "Create a Reddit OAuth app. Script apps are simplest for personal testing.",
      "App console: https://www.reddit.com/prefs/apps",
      "Use OAuth scope: submit. Prefer a refresh token for CI.",
    ].join("\n"),
    "Reddit credentials"
  );

  target.subreddit = assertNotCancel(
    await text({
      message: "Subreddit for this target",
      placeholder: "reddit_api_test",
      defaultValue: target.subreddit ?? "reddit_api_test",
    })
  );

  const account = ensureAccount(socialAuth, "reddit");
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

async function configureTelegram(socialAuth: UspConfig, project: UspConfig) {
  const target = ensureTarget(project, "telegram");
  note(
    [
      "Create a bot with BotFather, then add it to your channel/group if needed.",
      "BotFather: https://t.me/BotFather",
      "chat_id can be a numeric chat ID or a public channel username like @my_channel.",
    ].join("\n"),
    "Telegram credentials"
  );

  const account = ensureAccount(socialAuth, "telegram");
  account.botToken = assertNotCancel(await password({ message: "Telegram bot token" }));
  target.chatId = assertNotCancel(
    await text({
      message: "Telegram chat_id",
      placeholder: "@my_channel",
      defaultValue: target.chatId?.startsWith("$") ? undefined : target.chatId,
    })
  );
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
          { value: "exit", label: "Exit" },
        ],
      })
    ) as "llm" | "social" | "exit";

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

    const platform = assertNotCancel(
      await select({
        message: "Social auth",
        options: [
          { value: "x", label: "X", hint: `API posting with media, ${statusHint(platformStatus(project, socialAuth, "x"))}` },
          { value: "linkedin", label: "LinkedIn", hint: `Personal profile posts, ${statusHint(platformStatus(project, socialAuth, "linkedin"))}` },
          { value: "reddit", label: "Reddit", hint: `One subreddit target, ${statusHint(platformStatus(project, socialAuth, "reddit"))}` },
          { value: "telegram", label: "Telegram", hint: `Channel, group, or chat, ${statusHint(platformStatus(project, socialAuth, "telegram"))}` },
          { value: "back", label: "Back" },
        ],
      })
    ) as Platform | "back";

    if (platform === "back") {
      continue;
    }

    if (platform === "x") {
      await configureX(socialAuth, project);
    } else if (platform === "linkedin") {
      await configureLinkedIn(socialAuth, project);
    } else if (platform === "reddit") {
      await configureReddit(socialAuth, project);
    } else if (platform === "telegram") {
      await configureTelegram(socialAuth, project);
    }

    await writePlatformSocialAuth(platform, ensureAccount(socialAuth, platform));
    await writeConfigFile(loadedProject.path, project);
    note(`${platform} settings saved. Pick another section or Exit.`, "Saved");
  }
}

export async function setupCommand(options: { platform?: Platform; account?: string; value?: string[] } = {}) {
  if (options.platform) {
    await ensureProjectConfig();
    if (!["x", "linkedin", "reddit", "telegram"].includes(options.platform)) {
      throw new Error(`Unsupported platform: ${options.platform}`);
    }
    const config = await loadSocialAuthConfig();
    const name = options.account ?? PLATFORM_ACCOUNT_NAMES[options.platform];
    const account = ensureAccount(config, options.platform, name);
    applyValues(account, options.value);
    const path = await writePlatformSocialAuth(options.platform, account);
    console.log(`Saved ${options.platform}.${name} credentials to ${path}`);
    return;
  }

  await runInteractiveSetup();
}
