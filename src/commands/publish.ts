import { loadConfig } from "../config/config.js";
import { MarkdownFileInputSource, MarkdownTextInputSource, StdinMarkdownInputSource } from "../input/markdown-source.js";
import { createLlmClient } from "../llm/client.js";
import { JsonLlmProcessor } from "../llm/processor.js";
import { PublishPipeline, formatError } from "../pipeline/pipeline.js";
import { LlmPlatformPlanner } from "../pipeline/planner.js";
import { AdapterPoster } from "../posting/poster.js";
import { ConfigPromptProvider, parsePromptOverride } from "../prompt/provider.js";
import type { PlatformPlan, PublishTargetResult } from "../types.js";
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

function createPipeline(
  file: string | undefined,
  options: { prompt?: string[]; inputText?: string; stdin?: boolean },
  config: Awaited<ReturnType<typeof loadConfig>>
) {
  if (!options.stdin && !options.inputText && !file) {
    throw new Error("Provide a Markdown file, --input, or --stdin.");
  }
  const input = options.stdin
    ? new StdinMarkdownInputSource()
    : options.inputText
      ? new MarkdownTextInputSource(options.inputText)
      : new MarkdownFileInputSource(file ?? "");
  const llm = new JsonLlmProcessor(createLlmClient(config.llm));
  const prompts = new ConfigPromptProvider((options.prompt ?? []).map(parsePromptOverride));
  const planner = new LlmPlatformPlanner(prompts, llm);
  return new PublishPipeline(input, planner, new AdapterPoster());
}

function createHumanHooks(json?: boolean) {
  const makeSpinner = json ? createNoopSpinner : createSpinner;
  let prepareSpinner: ReturnType<typeof makeSpinner> | undefined;
  let postSpinner: ReturnType<typeof makeSpinner> | undefined;

  return {
    onPrepareStart(target: { config: { platform: Parameters<typeof platformName>[0] } }) {
      prepareSpinner = makeSpinner(`Preparing text for ${platformName(target.config.platform)}...`);
    },
    onPrepareSuccess(target: { config: { platform: Parameters<typeof platformName>[0] } }, plan: PlatformPlan) {
      const name = platformName(target.config.platform);
      prepareSpinner?.succeed(`Prepared text for ${name}`);
      if (!json) {
        printPlatformText(target.config.platform, plan);
      }
    },
    onPrepareError(target: { config: { platform: Parameters<typeof platformName>[0] } }, error: unknown) {
      const name = platformName(target.config.platform);
      prepareSpinner?.fail(`Error preparing text for ${name}`);
      if (!json) {
        printError(`Error preparing text for ${name}: ${formatError(error)}`);
      }
    },
    onPostStart(target: { config: { platform: Parameters<typeof platformName>[0] } }) {
      postSpinner = makeSpinner(`Posting to ${platformName(target.config.platform)}...`);
    },
    onPostSuccess(target: { config: { platform: Parameters<typeof platformName>[0] } }, result: PublishTargetResult) {
      postSpinner?.succeed(`Successfully posted to ${platformName(target.config.platform)}`);
      if (!json) {
        printPostSuccess(result);
      }
    },
    onPostError(target: { config: { platform: Parameters<typeof platformName>[0] } }, error: unknown) {
      const name = platformName(target.config.platform);
      postSpinner?.fail(`Error posting to ${name}`);
      if (!json) {
        printError(`Error posting to ${name}: ${formatError(error)}`);
      }
    },
  };
}

export async function planCommand(
  file: string | undefined,
  options: {
    config?: string;
    profile?: string;
    target?: string[];
    set?: string[];
    prompt?: string[];
    inputText?: string;
    stdin?: boolean;
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
  const pipeline = createPipeline(file, options, config);
  const { plan } = await pipeline.planOnly({
    config,
    targets: locallyReady,
  });
  console.log(JSON.stringify(plan, null, 2));
}

export async function publishCommand(
  file: string | undefined,
  options: {
    config?: string;
    profile?: string;
    target?: string[];
    set?: string[];
    prompt?: string[];
    inputText?: string;
    stdin?: boolean;
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
  const pipeline = createPipeline(file, options, config);
  const { plan, results } = await pipeline.publish({
    config,
    targets: locallyReady,
    dryRun: Boolean(options.dryRun),
    hooks: createHumanHooks(options.json),
  });

  if (options.json) {
    console.log(JSON.stringify({ plan, results }, null, 2));
  } else {
    if (options.dryRun) {
      printHumanResults(results);
    }
  }
}
