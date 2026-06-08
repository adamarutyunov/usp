import { loadConfig } from "../config/config.js";
import { MarkdownFileInputSource } from "../input/markdown-source.js";
import { createLlmClient } from "../llm/client.js";
import { JsonLlmProcessor } from "../llm/processor.js";
import { publishToXBrowser } from "../adapters/browser/x.js";
import { PublishPipeline, formatError } from "../pipeline/pipeline.js";
import { LlmPlatformPlanner } from "../pipeline/planner.js";
import { Poster, type PostRequest } from "../pipeline/contracts.js";
import { ConfigPromptProvider, parsePromptOverride } from "../prompt/provider.js";
import type { PublishTargetResult } from "../types.js";
import { createSpinner, platformName, printError, printPlatformText, printWarning } from "../util/display.js";
import { resolveTargets } from "./targets.js";

type BrowserPostOptions = {
  config?: string;
  profile?: string;
  target?: string[];
  set?: string[];
  prompt?: string[];
};

class BrowserPoster extends Poster {
  post(request: PostRequest) {
    if (request.target.platform !== "x") {
      throw new Error("Browser posting currently supports only X targets.");
    }
    return publishToXBrowser({
      targetId: request.targetId,
      target: request.target,
      config: request.config,
      plan: request.plan.targets?.[request.targetId] ?? request.plan.platforms.x!,
      media: request.media,
      dryRun: false,
      headless: true,
    });
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

export async function browserPostCommand(file: string | undefined, options: BrowserPostOptions = {}) {
  if (!file) {
    throw new Error("Provide a Markdown file.");
  }

  const config = await loadConfig({ configPath: options.config, overrides: options.set });
  const selectedTargets = resolveTargets(config, { profile: options.profile, targets: options.target });
  const targets = selectedTargets.filter((target) => target.config.platform === "x");
  if (targets.length === 0) {
    throw new Error("Browser posting currently supports only configured X targets.");
  }

  const input = new MarkdownFileInputSource(file);
  const llm = new JsonLlmProcessor(createLlmClient(config.llm));
  const prompts = new ConfigPromptProvider((options.prompt ?? []).map(parsePromptOverride));
  const planner = new LlmPlatformPlanner(prompts, llm);
  // Browser posting drives a single shared browser session, so it must run targets
  // one at a time (concurrency 1) — also keeps the per-step spinners below coherent.
  const pipeline = new PublishPipeline(input, planner, new BrowserPoster(), 1);
  let prepareSpinner: ReturnType<typeof createSpinner> | undefined;
  let postSpinner: ReturnType<typeof createSpinner> | undefined;

  const { results } = await pipeline.publish({
    config,
    targets,
    dryRun: false,
    hooks: {
      onPrepareStart(target) {
        prepareSpinner = createSpinner(`Preparing text for ${platformName(target.config.platform)}...`);
      },
      onPrepareSuccess(target, plan) {
        prepareSpinner?.succeed(`Prepared text for ${platformName(target.config.platform)}`);
        printPlatformText(target.config.platform, plan);
      },
      onPrepareError(target, error) {
        prepareSpinner?.fail(`Error preparing text for ${platformName(target.config.platform)}`);
        printError(`Error preparing text for ${platformName(target.config.platform)}: ${formatError(error)}`);
      },
      onPostStart(target) {
        postSpinner = createSpinner(`Browser posting to ${platformName(target.config.platform)}...`);
      },
      onPostSuccess(target, result) {
        postSpinner?.succeed(`Posted to ${platformName(target.config.platform)}`);
        printPostSuccess(result);
      },
      onPostError(target, error) {
        postSpinner?.fail(`Error posting to ${platformName(target.config.platform)}`);
        printError(`Error posting to ${platformName(target.config.platform)}: ${formatError(error)}`);
      },
    },
  });

  if (results.some((result) => result.ok === false)) {
    process.exitCode = 1;
  }
}
