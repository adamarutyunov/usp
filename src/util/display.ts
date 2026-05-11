import ora from "ora";
import pc from "yoctocolors";
import type { Platform, PlatformPlan } from "../types.js";

const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  telegram: "Telegram",
  aegea: "Aegea",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  discord: "Discord",
};

export function platformName(platform: Platform) {
  return PLATFORM_LABELS[platform];
}

export function createSpinner(text: string) {
  return ora({
    text,
    spinner: "dots",
  }).start();
}

export function createNoopSpinner() {
  return {
    succeed() {},
    fail() {},
  };
}

export function printPlatformText(platform: Platform, plan: PlatformPlan) {
  console.log("");
  console.log(pc.bold(`${platformName(platform)} text:`));
  if (plan.title) {
    console.log(pc.dim(`Title: ${plan.title}`));
  }
  for (const [index, unit] of plan.units.entries()) {
    const prefix = plan.units.length > 1 ? `${index + 1}. ` : "";
    console.log(`${prefix}${unit.text}`);
    if (unit.mediaRefs?.length) {
      console.log(pc.dim(`   media: ${unit.mediaRefs.join(", ")}`));
    }
  }
}

export function printError(message: string) {
  console.error(pc.red(message));
}

export function printWarning(message: string) {
  console.warn(pc.yellow(message));
}
