import { loadGlobalConfig, writeGlobalConfig } from "../config/config.js";
import type { Platform, UspConfig } from "../types.js";
import { setDeepValue } from "../util/object.js";

function ensureAccount(config: UspConfig, platform: Platform, name: string) {
  config.accounts ??= {};
  config.accounts[platform] ??= {};
  const accounts = config.accounts[platform] as Record<string, Record<string, unknown>>;
  accounts[name] ??= {};
  return accounts[name]!;
}

export async function accountSetCommand(
  platform: Platform,
  name: string,
  options: { value?: string[] }
) {
  if (!["x", "linkedin", "reddit", "telegram"].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const config = await loadGlobalConfig();
  const account = ensureAccount(config, platform, name);
  for (const item of options.value ?? []) {
    const [key, ...rest] = item.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --value "${item}". Expected key=value.`);
    }
    setDeepValue(account, key, rest.join("="));
  }

  const path = await writeGlobalConfig(config);
  console.log(`Saved ${platform}.${name} to ${path}`);
}
