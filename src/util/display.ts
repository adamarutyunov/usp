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

/** Divider shown between posts; matches the separator written into preview Markdown files. */
export const POST_DIVIDER = "----------";

export function printPlatformText(platform: Platform, plan: PlatformPlan) {
  console.log("");
  const count = plan.units.length;
  const heading = count > 1 ? `${platformName(platform)} text (${count} posts):` : `${platformName(platform)} text:`;
  console.log(pc.bold(heading));
  if (plan.title) {
    console.log(pc.dim(`Title: ${plan.title}`));
  }
  for (const [index, unit] of plan.units.entries()) {
    if (index > 0) {
      console.log(pc.dim(POST_DIVIDER));
    }
    console.log(unit.text);
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
