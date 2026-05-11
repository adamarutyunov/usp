import { publishToXBrowser } from "../adapters/browser/x.js";
import { loadConfig } from "../config/config.js";
import type { Platform, TargetConfig } from "../types.js";
import { platformName } from "../util/display.js";

type BrowserPostOptions = {
  account?: string;
  browser?: "chrome" | "chromium" | "msedge";
  headed?: boolean;
  headless?: boolean;
  media?: string[];
  profileDir?: string;
  text?: string;
  thread?: string[];
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
};

function assertPlatform(value: string): asserts value is Platform {
  if (value !== "x") {
    throw new Error("Browser posting currently supports only x.");
  }
}

function mediaRefsForUnit(index: number, unitCount: number, mediaCount: number) {
  if (mediaCount === 0) {
    return undefined;
  }

  if (unitCount > 1 && mediaCount === unitCount) {
    return [`cli-media-${index + 1}`];
  }

  return index === 0 ? Array.from({ length: mediaCount }, (_item, mediaIndex) => `cli-media-${mediaIndex + 1}`) : undefined;
}

export async function browserPostCommand(platformArg = "x", options: BrowserPostOptions = {}) {
  assertPlatform(platformArg);
  const text = options.text?.trim();
  const thread = (options.thread?.length ? options.thread : text ? [text] : []).map((item) => item.trim()).filter(Boolean);
  if (thread.length === 0) {
    throw new Error("Provide --text or repeat --thread for the browser post.");
  }
  if (!options.dryRun && !options.yes) {
    throw new Error("Refusing to publish without --yes. Use --dry-run to test without posting.");
  }

  const config = await loadConfig();
  const target: TargetConfig = {
    platform: "x",
    account: options.account ?? "main",
  };

  const result = await publishToXBrowser({
    targetId: "x-browser",
    target,
    config,
    plan: {
      units: thread.map((item, index) => ({
        text: item,
        mediaRefs: mediaRefsForUnit(index, thread.length, options.media?.length ?? 0),
      })),
    },
    media: (options.media ?? []).map((filePath, index) => ({
      id: `cli-media-${index + 1}`,
      alt: "",
      rawPath: filePath,
      resolvedPath: filePath,
      isRemote: false,
    })),
    dryRun: Boolean(options.dryRun),
    browser: options.browser,
    headless: options.headed ? false : options.headless ?? true,
    profileDir: options.profileDir,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const prefix = result.dryRun ? "Prepared browser post for" : "Posted to";
  console.log(`${prefix} ${platformName(result.platform)} (${result.account})`);
  for (const post of result.posts) {
    if (post.url) {
      console.log(`  ${post.url}`);
    } else if (post.id) {
      console.log(`  ${post.id}`);
    } else {
      console.log(`  ${post.text}`);
    }
  }
}
