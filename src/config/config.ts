import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import type { JsonObject, UspConfig } from "../types.js";
import { deepMerge, setDeepValue } from "../util/object.js";

export const DEFAULT_CONFIG_NAMES = ["usp.config.yml", ".usp.yml"];

export function getGlobalConfigPath() {
  return path.join(os.homedir(), ".config", "usp", "config.yml");
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
  const projectPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : await findProjectConfig(cwd);
  const projectConfig = projectPath ? await readYamlIfExists(projectPath) : {};

  let merged = deepMerge(globalConfig, projectConfig);
  for (const override of options.overrides ?? []) {
    const [key, ...rest] = override.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --set override "${override}". Expected key.path=value.`);
    }
    setDeepValue(merged, key, rest.join("="));
  }

  return merged as UspConfig;
}

export async function loadGlobalConfig(): Promise<UspConfig> {
  return (await readYamlIfExists(getGlobalConfigPath())) as UspConfig;
}

export async function writeGlobalConfig(config: UspConfig) {
  const configPath = getGlobalConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, YAML.stringify(config), { mode: 0o600 });
  return configPath;
}

export async function writeProjectConfig(config: UspConfig, filePath = ".usp.yml") {
  const resolved = path.resolve(process.cwd(), filePath);
  await fs.writeFile(resolved, YAML.stringify(config));
  return resolved;
}
