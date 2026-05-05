import type { TargetConfig, UspConfig } from "../types.js";

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
