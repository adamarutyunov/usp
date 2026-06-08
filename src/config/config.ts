import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import type { JsonObject, LlmProvider, Platform, PostMode, PromptLayer, TargetConfig, TargetRouting, UspConfig } from "../types.js";
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

/**
 * Convert a legacy flat `targets` config into the nested account/target shape, returning the
 * map from old flat id -> new `platform/account/name` id so callers can remap profiles and
 * postingDefaults (including those in a separate global config). Idempotent: a config with no
 * flat `targets` is returned unchanged with an empty map.
 */
export function migrateFlatConfig(config: UspConfig): { config: UspConfig; idMap: Record<string, string> } {
  const idMap: Record<string, string> = {};
  const flat = config.targets ?? {};
  if (Object.keys(flat).length === 0) {
    return { config, idMap };
  }

  config.accounts ??= {};
  const accounts = config.accounts as Record<string, Record<string, Record<string, unknown> & { targets?: Record<string, TargetRouting> }>>;
  const usedNames = new Map<string, Set<string>>();

  for (const [oldId, target] of Object.entries(flat)) {
    const { platform, account, prompt, mode: _mode, ...routing } = target as TargetConfig;
    accounts[platform] ??= {};
    accounts[platform]![account] ??= {};
    const accountConfig = accounts[platform]![account]!;
    accountConfig.targets ??= {};

    const key = `${platform}/${account}`;
    const used = usedNames.get(key) ?? new Set<string>();
    let name = "default";
    if (used.has(name)) {
      const base = oldId.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase() || "target";
      name = base;
      for (let n = 2; used.has(name); n += 1) {
        name = `${base}-${n}`;
      }
    }
    used.add(name);
    usedNames.set(key, used);

    const routingEntry: TargetRouting = { ...(routing as TargetRouting) };
    // Old configs stored prompt as a plain string (= replace).
    if (typeof prompt === "string") {
      routingEntry.prompt = { mode: "replace", text: prompt };
    } else if (prompt) {
      routingEntry.prompt = prompt as PromptLayer;
    }
    accountConfig.targets[name] = routingEntry;
    idMap[oldId] = `${platform}/${account}/${name}`;
  }

  delete config.targets;
  remapIdsInPlace(config, idMap);
  return { config, idMap };
}

/** Rewrite profile target lists and postingDefaults keys through an old->new id map. */
export function remapIdsInPlace(config: UspConfig, idMap: Record<string, string>) {
  for (const profile of Object.values(config.profiles ?? {})) {
    profile.targets = profile.targets.map((id) => idMap[id] ?? id);
  }
  if (config.postingDefaults) {
    const remapped: Record<string, PostMode> = {};
    for (const [id, value] of Object.entries(config.postingDefaults)) {
      remapped[idMap[id] ?? id] = value;
    }
    config.postingDefaults = remapped;
  }
}

function isBlank(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Flatten nested `accounts.<platform>.<account>.targets` into the runtime `config.targets`
 * map (keyed `platform/account/name`), strip the `targets` key off the auth objects, and
 * give every account a `default` target when it declares none. Any legacy flat `targets`
 * entries are preserved as-is.
 */
export function normalizeTargets(config: UspConfig): UspConfig {
  const targets: Record<string, TargetConfig> = { ...(config.targets ?? {}) };
  const accountsWithTarget = new Set<string>();
  for (const target of Object.values(targets)) {
    accountsWithTarget.add(`${target.platform}/${target.account}`);
  }

  const accounts = (config.accounts ?? {}) as Record<
    string,
    Record<string, Record<string, unknown> & { targets?: Record<string, TargetRouting> }>
  >;

  for (const [platform, platformAccounts] of Object.entries(accounts)) {
    for (const [accountName, account] of Object.entries(platformAccounts ?? {})) {
      const nested = account.targets;
      delete account.targets;
      for (const [name, routing] of Object.entries(nested ?? {})) {
        targets[`${platform}/${accountName}/${name}`] = {
          platform: platform as Platform,
          account: accountName,
          ...routing,
        };
        accountsWithTarget.add(`${platform}/${accountName}`);
      }
    }
  }

  // Accounts with no target at all get a prompt-only `default` (routing platforms will
  // simply read as not-ready until a real target is added).
  for (const [platform, platformAccounts] of Object.entries(accounts)) {
    for (const accountName of Object.keys(platformAccounts ?? {})) {
      if (!accountsWithTarget.has(`${platform}/${accountName}`)) {
        targets[`${platform}/${accountName}/default`] = {
          platform: platform as Platform,
          account: accountName,
        };
      }
    }
  }

  config.targets = targets;
  return config;
}

function envSegment(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

/** Account-scoped name (e.g. TELEGRAM_NEWSBOT_BOT_TOKEN) takes precedence over the platform-wide one. */
function envValue(platform: string, account: string, field: string) {
  const scoped = process.env[`${envSegment(platform)}_${envSegment(account)}_${envSegment(field)}`];
  return scoped ?? process.env[`${envSegment(platform)}_${envSegment(field)}`];
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
    for (const [accountName, account] of Object.entries(platformAccounts ?? {})) {
      for (const field of fields) {
        const fromEnv = envValue(platform, accountName, field);
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

  return applyEnvFallbacks(normalizeTargets(merged as UspConfig));
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
