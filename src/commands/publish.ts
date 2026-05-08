import { publishTarget } from "../adapters/index.js";
import { loadConfig } from "../config/config.js";
import { readMarkdownInput } from "../content/markdown.js";
import { createLlmClient } from "../llm/client.js";
import { buildPlatformPlan, buildPublishPlan } from "../llm/planner.js";
import type { Platform, PublishPlan, PublishTargetResult, TargetConfig } from "../types.js";
import { createNoopSpinner, createSpinner, platformName, printError, printPlatformText, printWarning } from "../util/display.js";
import { filterReadyTargets, resolveTargets } from "./targets.js";

function printHumanResults(results: PublishTargetResult[]) {
  for (const result of results) {
    if (result.ok === false) {
      continue;
    }
    console.log(`${result.dryRun ? "[dry-run] " : ""}${result.target} (${result.platform}/${result.account})`);
    for (const post of result.posts) {
      if (post.url) {
        console.log(`  posted: ${post.url}`);
      } else if (post.id) {
        console.log(`  posted: ${post.id}`);
      } else if (post.text) {
        console.log(`  ${post.text}`);
      }
    }
    for (const warning of result.warnings ?? []) {
      console.warn(`  warning: ${warning}`);
    }
  }
}

function createEmptyPlan(input: Awaited<ReturnType<typeof readMarkdownInput>>): PublishPlan {
  return {
    source: {
      inputPath: input.inputPath,
      title: input.title,
    },
    media: input.media.map(({ id, alt, rawPath, mime, size }) => ({ id, alt, rawPath, mime, size })),
    platforms: {},
  };
}

function errorResult(
  target: { id: string; config: TargetConfig },
  error: unknown,
  dryRun: boolean
): PublishTargetResult {
  return {
    target: target.id,
    platform: target.config.platform,
    account: target.config.account,
    dryRun,
    ok: false,
    error: formatError(error),
    posts: [],
  };
}

function formatError(error: unknown) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const details = error as { message?: string; code?: number; data?: unknown; cause?: unknown };
  const parts = [details.message ?? String(error)];
  if (details.code) {
    parts.push(`status=${details.code}`);
  }
  if (details.data) {
    parts.push(`body=${JSON.stringify(details.data)}`);
  }
  if (details.cause && typeof details.cause !== "object") {
    parts.push(`cause=${String(details.cause)}`);
  }
  return parts.join(" ");
}

function printPostSuccess(result: PublishTargetResult) {
  for (const post of result.posts) {
    if (post.url) {
      console.log(`  ${post.url}`);
    } else if (post.id) {
      console.log(`  ${post.id}`);
    }
  }
  for (const warning of result.warnings ?? []) {
    printWarning(`Warning for ${platformName(result.platform)}: ${warning}`);
  }
}

export async function planCommand(
  file: string,
  options: {
    config?: string;
    profile?: string;
    target?: string[];
    set?: string[];
  }
) {
  const config = await loadConfig({ configPath: options.config, overrides: options.set });
  const targets = resolveTargets(config, { profile: options.profile, targets: options.target });
  const { ready: locallyReady, skipped: localSkipped } = filterReadyTargets(config, targets, {
    explicitTargets: Boolean(options.target?.length),
  });
  for (const target of localSkipped) {
    console.warn(`Skipping ${target.id}: ${target.reason}`);
  }
  if (locallyReady.length === 0) {
    throw new Error("No configured targets to plan for. Run `usp setup` or pass a configured --target.");
  }
  const input = await readMarkdownInput(file);
  const llm = createLlmClient(config.llm);
  const plan = await buildPublishPlan({ input, config, targets: locallyReady, llm });
  console.log(JSON.stringify(plan, null, 2));
}

export async function publishCommand(
  file: string,
  options: {
    config?: string;
    profile?: string;
    target?: string[];
    set?: string[];
    dryRun?: boolean;
    json?: boolean;
  }
) {
  const config = await loadConfig({ configPath: options.config, overrides: options.set });
  const targets = resolveTargets(config, { profile: options.profile, targets: options.target });
  const { ready: locallyReady, skipped: localSkipped } = filterReadyTargets(config, targets, {
    explicitTargets: Boolean(options.target?.length),
  });
  for (const target of localSkipped) {
    console.warn(`Skipping ${target.id}: ${target.reason}`);
  }
  if (locallyReady.length === 0) {
    throw new Error("No configured targets to publish to. Run `usp setup` or pass a configured --target.");
  }
  const input = await readMarkdownInput(file);
  const llm = createLlmClient(config.llm);
  const plan = createEmptyPlan(input);
  const results = [];
  const plannedPlatforms = new Set<Platform>();
  const makeSpinner = options.json ? createNoopSpinner : createSpinner;

  for (const target of locallyReady) {
    const platform = target.config.platform;
    const name = platformName(platform);

    if (!plannedPlatforms.has(platform)) {
      const prepareSpinner = makeSpinner(`Preparing text for ${name}...`);
      try {
        plan.platforms[platform] = await buildPlatformPlan({ input, config, target, llm });
        plannedPlatforms.add(platform);
        prepareSpinner.succeed(`Prepared text for ${name}`);
      } catch (error) {
        prepareSpinner.fail(`Error preparing text for ${name}`);
        if (!options.json) {
          printError(`Error preparing text for ${name}: ${formatError(error)}`);
        }
        results.push(errorResult(target, error, Boolean(options.dryRun)));
        continue;
      }

      if (!options.json) {
        printPlatformText(platform, plan.platforms[platform]!);
      }
    }

    if (options.dryRun) {
      const result = await publishTarget({
        targetId: target.id,
        target: target.config,
        config,
        plan,
        media: input.media,
        dryRun: true,
      });
      results.push({ ...result, ok: true });
      continue;
    }

    const postSpinner = makeSpinner(`Posting to ${name}...`);
    try {
      const result = await publishTarget({
        targetId: target.id,
        target: target.config,
        config,
        plan,
        media: input.media,
        dryRun: false,
      });
      const withStatus = { ...result, ok: true };
      results.push(withStatus);
      postSpinner.succeed(`Successfully posted to ${name}`);
      if (!options.json) {
        printPostSuccess(withStatus);
      }
    } catch (error) {
      postSpinner.fail(`Error posting to ${name}`);
      if (!options.json) {
        printError(`Error posting to ${name}: ${formatError(error)}`);
      }
      results.push(errorResult(target, error, false));
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ plan, results }, null, 2));
  } else {
    if (options.dryRun) {
      printHumanResults(results);
    }
  }
}
