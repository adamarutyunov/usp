import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import type { JsonObject, LlmProvider, Platform, UspConfig } from "../types.js";
import { deepMerge, setDeepValue } from "../util/object.js";

export const DEFAULT_CONFIG_NAMES = ["usp.config.yml", ".usp.yml"];

// Account fields that can be supplied via environment variables, by convention
// `${PLATFORM}_${FIELD}` (e.g. X_CONSUMER_KEY, DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN).
const ACCOUNT_ENV_FIELDS: Record<Platform, string[]> = {
  x: ["consumerKey", "consumerSecret", "accessToken", "accessTokenSecret"],
  linkedin: ["accessToken", "author", "version"],
  reddit: ["clientId", "clientSecret", "refreshToken", "username", "password", "subreddit", "userAgent"],
  telegram: ["botToken", "chatId"],
  aegea: ["baseUrl", "password"],
  bluesky: ["identifier", "appPassword", "pdsUrl"],
  mastodon: ["instanceUrl", "accessToken", "visibility"],
  discord: ["webhookUrl", "threadId", "username", "avatarUrl"],
  threads: ["accessToken", "userId", "username", "replyControl"],
};

export function getGlobalConfigPath() {
  return path.join(os.homedir(), ".config", "usp", "config.yml");
}

export function getSocialAuthDir() {
  return path.join(os.homedir(), ".config", "usp", "social-auth");
}

export function getBrowserAuthDir() {
  return path.join(os.homedir(), ".config", "usp", "browser-auth");
}

function isBlank(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function envName(platform: string, field: string) {
  const snake = field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  return `${platform.toUpperCase()}_${snake}`;
}

/**
 * Fill credentials from environment variables when the config leaves them blank.
 * Accounts use the convention `${PLATFORM}_${FIELD}` (e.g. X_CONSUMER_KEY); the LLM
 * key uses `${PROVIDER}_API_KEY` / `${PROVIDER}_AUTH_TOKEN`. Existing config values
 * always win — env is only a fallback, which is what makes CI secrets "just work".
 */
export function applyEnvFallbacks(config: UspConfig): UspConfig {
  config.accounts ??= {};
  const accounts = config.accounts as Record<string, Record<string, Record<string, unknown>>>;

  // Ensure every target's account object exists so env can populate it even with no accounts block.
  for (const target of Object.values(config.targets ?? {})) {
    accounts[target.platform] ??= {};
    accounts[target.platform]![target.account] ??= {};
  }

  for (const [platform, platformAccounts] of Object.entries(accounts)) {
    const fields = ACCOUNT_ENV_FIELDS[platform as Platform];
    if (!fields) {
      continue;
    }
    for (const account of Object.values(platformAccounts ?? {})) {
      for (const field of fields) {
        const fromEnv = process.env[envName(platform, field)];
        if (isBlank(account[field]) && fromEnv) {
          account[field] = fromEnv;
        }
      }
    }
  }

  const provider = config.llm?.provider as LlmProvider | undefined;
  if (provider) {
    const prefix = provider.toUpperCase();
    if (isBlank(config.llm!.apiKey)) {
      config.llm!.apiKey = process.env[`${prefix}_API_KEY`] ?? config.llm!.apiKey;
    }
    if (isBlank(config.llm!.authToken)) {
      config.llm!.authToken = process.env[`${prefix}_AUTH_TOKEN`] ?? config.llm!.authToken;
    }
  }

  return config;
}

async function readYamlIfExists(filePath: string): Promise<JsonObject> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return (YAML.parse(raw) ?? {}) as JsonObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function readSocialAuthConfig(): Promise<JsonObject> {
  const dir = getSocialAuthDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  let merged: JsonObject = {};
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) {
      continue;
    }
    merged = deepMerge(merged, await readYamlIfExists(path.join(dir, entry)));
  }
  return merged;
}

export async function findProjectConfig(cwd = process.cwd()) {
  for (const name of DEFAULT_CONFIG_NAMES) {
    const candidate = path.join(cwd, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

export async function loadConfig(options: {
  configPath?: string;
  overrides?: string[];
  cwd?: string;
} = {}): Promise<UspConfig> {
  const cwd = options.cwd ?? process.cwd();
  const globalConfig = await readYamlIfExists(getGlobalConfigPath());
  const socialAuthConfig = await readSocialAuthConfig();
  const projectPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : await findProjectConfig(cwd);
  const projectConfig = projectPath ? await readYamlIfExists(projectPath) : {};

  let merged = deepMerge(deepMerge(globalConfig, projectConfig), socialAuthConfig);
  for (const override of options.overrides ?? []) {
    const [key, ...rest] = override.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --set override "${override}". Expected key.path=value.`);
    }
    setDeepValue(merged, key, rest.join("="));
  }

  return applyEnvFallbacks(merged as UspConfig);
}

export async function loadGlobalConfig(): Promise<UspConfig> {
  return (await readYamlIfExists(getGlobalConfigPath())) as UspConfig;
}

export async function loadSocialAuthConfig(): Promise<UspConfig> {
  return (await readSocialAuthConfig()) as UspConfig;
}

export async function loadProjectConfig(configPath?: string): Promise<{ path: string; config: UspConfig } | undefined> {
  const projectPath = configPath ? path.resolve(process.cwd(), configPath) : await findProjectConfig();
  if (!projectPath) {
    return undefined;
  }
  return {
    path: projectPath,
    config: (await readYamlIfExists(projectPath)) as UspConfig,
  };
}

export async function writeConfigFile(filePath: string, config: UspConfig) {
  await fs.writeFile(filePath, YAML.stringify(config));
  return filePath;
}

export async function writeGlobalConfig(config: UspConfig) {
  const configPath = getGlobalConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, YAML.stringify(config), { mode: 0o600 });
  return configPath;
}

export async function writeSocialAuthConfig(fileName: string, config: UspConfig) {
  const dir = getSocialAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName.endsWith(".yml") ? fileName : `${fileName}.yml`);
  await fs.writeFile(filePath, YAML.stringify(config), { mode: 0o600 });
  return filePath;
}

export async function writeProjectConfig(config: UspConfig, filePath = ".usp.yml") {
  const resolved = path.resolve(process.cwd(), filePath);
  await fs.writeFile(resolved, YAML.stringify(config));
  return resolved;
}
