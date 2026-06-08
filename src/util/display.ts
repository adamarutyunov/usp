import ora from "ora";
import pc from "yoctocolors";
import { platformLabel } from "../platforms.js";
import type { Platform, PlatformPlan } from "../types.js";

export function platformName(platform: Platform) {
  return platformLabel(platform);
}

export function createSpinner(text: string) {
  return ora({
    text,
    spinner: "dots",
  }).start();
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
