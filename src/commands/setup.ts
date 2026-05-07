import {
  cancel,
  group,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";

import {
  findProjectConfig,
  loadGlobalConfig,
  loadProjectConfig,
  writeConfigFile,
  writeGlobalConfig,
  writeProjectConfig,
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

async function configureLlm(project: UspConfig, global: UspConfig) {
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

  note(
    [
      `Create or copy an API key here: ${defaults.keyUrl}`,
      `Default env var: ${defaults.env}`,
    ].join("\n"),
    `${defaults.label} key`
  );

  const secretMode = assertNotCancel(
    await select({
      message: "How should usp store the LLM key?",
      initialValue: "env",
      options: [
        { value: "env", label: "Use env var", hint: defaults.env },
        { value: "paste", label: "Paste key now", hint: "Saved in ~/.config/usp/config.yml" },
      ],
    })
  ) as "env" | "paste";

  project.llm = {
    provider,
    model: defaults.model,
    apiKeyEnv: defaults.env,
  };

  if (secretMode === "paste") {
    global.llm = {
      provider,
      model: defaults.model,
      apiKey: assertNotCancel(await password({ message: `${defaults.label} API key` })),
    };
  } else {
    global.llm = {
      provider,
      model: defaults.model,
      apiKeyEnv: defaults.env,
    };
  }
}

async function configureX(global: UspConfig, project: UspConfig) {
  ensureTarget(project, "x");
  note(
    [
      "Create an X developer app and enable user authentication with read/write permissions.",
      "Developer portal: https://developer.x.com/en/portal/dashboard",
      "You need OAuth 1.0a consumer key/secret and access token/secret for media uploads.",
    ].join("\n"),
    "X credentials"
  );

  const account = ensureAccount(global, "x");
  account.consumerKey = assertNotCancel(await password({ message: "X consumer key" }));
  account.consumerSecret = assertNotCancel(await password({ message: "X consumer secret" }));
  account.accessToken = assertNotCancel(await password({ message: "X access token" }));
  account.accessTokenSecret = assertNotCancel(await password({ message: "X access token secret" }));
}

async function configureLinkedIn(global: UspConfig, project: UspConfig) {
  ensureTarget(project, "linkedin");
  note(
    [
      "Create a LinkedIn developer app and request member posting access.",
      "Developer apps: https://www.linkedin.com/developers/apps",
      "Author URN should look like: urn:li:person:abc123",
    ].join("\n"),
    "LinkedIn credentials"
  );

  const account = ensureAccount(global, "linkedin");
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

async function configureReddit(global: UspConfig, project: UspConfig) {
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

  const account = ensureAccount(global, "reddit");
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

async function configureTelegram(global: UspConfig, project: UspConfig) {
  const target = ensureTarget(project, "telegram");
  note(
    [
      "Create a bot with BotFather, then add it to your channel/group if needed.",
      "BotFather: https://t.me/BotFather",
      "chat_id can be a numeric chat ID or a public channel username like @my_channel.",
    ].join("\n"),
    "Telegram credentials"
  );

  const account = ensureAccount(global, "telegram");
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

  const global = await loadGlobalConfig();
  const project = loadedProject.config;

  const sections = assertNotCancel(
    await multiselect({
      message: "What do you want to configure?",
      required: true,
      options: [
        { value: "llm", label: "LLM provider", hint: "Anthropic, OpenAI, or Gemini" },
        { value: "x", label: "X", hint: "API posting with media" },
        { value: "linkedin", label: "LinkedIn", hint: "Personal profile posts" },
        { value: "reddit", label: "Reddit", hint: "One subreddit target" },
        { value: "telegram", label: "Telegram", hint: "Channel, group, or chat" },
      ],
    })
  ) as Array<"llm" | Platform>;

  await group(
    {
      llm: async () => {
        if (sections.includes("llm")) {
          await configureLlm(project, global);
        }
      },
      x: async () => {
        if (sections.includes("x")) {
          await configureX(global, project);
        }
      },
      linkedin: async () => {
        if (sections.includes("linkedin")) {
          await configureLinkedIn(global, project);
        }
      },
      reddit: async () => {
        if (sections.includes("reddit")) {
          await configureReddit(global, project);
        }
      },
      telegram: async () => {
        if (sections.includes("telegram")) {
          await configureTelegram(global, project);
        }
      },
    },
    {
      onCancel: () => {
        cancel("Setup cancelled.");
        process.exit(0);
      },
    }
  );

  const globalPath = await writeGlobalConfig(global);
  await writeConfigFile(loadedProject.path, project);
  outro(`Saved credentials to ${globalPath}\nSaved project config to ${loadedProject.path}`);
}

export async function setupCommand(options: { platform?: Platform; account?: string; value?: string[] } = {}) {
  if (options.platform) {
    await ensureProjectConfig();
    if (!["x", "linkedin", "reddit", "telegram"].includes(options.platform)) {
      throw new Error(`Unsupported platform: ${options.platform}`);
    }
    const config = await loadGlobalConfig();
    const name = options.account ?? PLATFORM_ACCOUNT_NAMES[options.platform];
    const account = ensureAccount(config, options.platform, name);
    applyValues(account, options.value);
    const path = await writeGlobalConfig(config);
    console.log(`Saved ${options.platform}.${name} credentials to ${path}`);
    return;
  }

  await runInteractiveSetup();
}
