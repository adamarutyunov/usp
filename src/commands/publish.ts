import { cancel, confirm, isCancel, select } from "@clack/prompts";
import { loadConfig, loadGlobalConfig, writeGlobalConfig } from "../config/config.js";
import { MarkdownFileInputSource, MarkdownTextInputSource, StdinMarkdownInputSource } from "../input/markdown-source.js";
import { createLlmClient } from "../llm/client.js";
import { JsonLlmProcessor } from "../llm/processor.js";
import { PublishPipeline, formatError } from "../pipeline/pipeline.js";
import { LlmPlatformPlanner } from "../pipeline/planner.js";
import { AdapterPoster } from "../posting/poster.js";
import { PreviewStore } from "../preview/store.js";
import { ConfigPromptProvider, parsePromptOverride } from "../prompt/provider.js";
import type { PlatformPlan, PostMode, PublishTargetResult } from "../types.js";
import pc from "yoctocolors";
import { PartialPublishError } from "../adapters/common.js";
import { platformName, printError, printPlatformText, printWarning } from "../util/display.js";
import type { TargetRef } from "../pipeline/contracts.js";
import { pickPostTargets, type PostTargetRow } from "./post-picker.js";
import { filterReadyTargets, resolveInitialPostMode, resolveTargets } from "./targets.js";

function printHumanResults(results: PublishTargetResult[]) {
  for (const result of results) {
    if (result.ok === false) {
      continue;
    }
    console.log(`${result.target} (${result.platform}/${result.account})`);
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
  options: { prompt?: string[]; input?: string; inputText?: string; stdin?: boolean },
  config: Awaited<ReturnType<typeof loadConfig>>
) {
  const inlineInput = options.inputText ?? options.input;
  if (!options.stdin && !inlineInput && !file) {
    throw new Error("Provide a Markdown file, --input, or --stdin.");
  }
  const input = options.stdin
    ? new StdinMarkdownInputSource()
    : inlineInput
      ? new MarkdownTextInputSource(inlineInput)
      : new MarkdownFileInputSource(file ?? "");
  const llm = new JsonLlmProcessor(createLlmClient(config.llm));
  const prompts = new ConfigPromptProvider((options.prompt ?? []).map(parsePromptOverride));
  const planner = new LlmPlatformPlanner(prompts, llm);
  return new PublishPipeline(input, planner, new AdapterPoster());
}

function assertNotCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Publish cancelled.");
    process.exit(0);
  }
  return value;
}

// Targets are processed concurrently, so progress is shown as discrete labeled
// lines (each names its target) rather than a single shared spinner, which cannot
// represent several in-flight operations at once.
type HookTarget = { id: string; config: { platform: Parameters<typeof platformName>[0] } };

function label(target: HookTarget) {
  return `${platformName(target.config.platform)} (${target.id})`;
}

function createHumanHooks() {
  return {
    onPreviewDirectory(dir: string) {
      console.log(`Preview directory: ${dir}`);
    },
    onPreviewReuse(target: HookTarget) {
      console.log(pc.dim(`Loaded preview for ${target.id}`));
    },
    onPreviewWrite(target: HookTarget, filePath: string) {
      console.log(pc.dim(`  saved ${target.id}: ${filePath}`));
    },
    onPrepareStart(target: HookTarget) {
      console.log(pc.dim(`Preparing text for ${label(target)}…`));
    },
    onPrepareSuccess(target: HookTarget, plan: PlatformPlan) {
      printPlatformText(target.config.platform, plan);
    },
    onPrepareError(target: HookTarget, error: unknown) {
      printError(`Error preparing text for ${label(target)}: ${formatError(error)}`);
    },
    onPostStart(target: HookTarget) {
      console.log(pc.dim(`Posting to ${label(target)}…`));
    },
    onPostSuccess(target: HookTarget, result: PublishTargetResult) {
      console.log(pc.green(`✓ Posted to ${label(target)}`));
      printPostSuccess(result);
    },
    onPostError(target: HookTarget, error: unknown) {
      printError(`Error posting to ${label(target)}: ${formatError(error)}`);
      if (error instanceof PartialPublishError && error.posts.length > 0) {
        printWarning(
          `  ${error.posts.length} post(s) in this thread already went live before the failure — ` +
            `re-running ${target.id} would duplicate them:`
        );
        for (const post of error.posts) {
          if (post.url ?? post.id) {
            console.warn(`    ${post.url ?? post.id}`);
          }
        }
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
    input?: string;
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

type PublishOptions = {
  config?: string;
  profile?: string;
  target?: string[];
  set?: string[];
  prompt?: string[];
  input?: string;
  inputText?: string;
  stdin?: boolean;
};

async function savePostingDefaults(rows: PostTargetRow[]) {
  const global = await loadGlobalConfig();
  global.postingDefaults = Object.fromEntries(rows.map((row) => [row.id, row.mode]));
  await writeGlobalConfig(global);
}

async function resolvePublishTargets(
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: PublishOptions,
  mode: "publish" | "preview"
): Promise<TargetRef[]> {
  const interactive = !options.target?.length && !options.stdin && Boolean(process.stdout.isTTY);

  if (interactive) {
    const allTargets = Object.entries(config.targets ?? {}).map(([id, targetConfig]) => ({ id, config: targetConfig }));
    if (allTargets.length === 0) {
      throw new Error("No targets configured. Run `usp setup`.");
    }
    const { ready } = filterReadyTargets(config, allTargets);
    if (ready.length === 0) {
      throw new Error("No configured targets are ready to publish to. Run `usp setup`.");
    }
    const hasSavedDefaults = Object.keys(config.postingDefaults ?? {}).length > 0;
    const rows: PostTargetRow[] = ready.map((target) => ({
      id: target.id,
      platform: target.config.platform,
      account: target.config.account,
      mode: resolveInitialPostMode(config, target.id),
    }));
    const selection = await pickPostTargets(rows);
    if (selection === null) {
      cancel("Publish cancelled.");
      process.exit(0);
    }
    const chosen = selection.filter((row) => row.mode !== "off");
    if (chosen.length === 0) {
      throw new Error("No targets selected.");
    }

    if (mode === "publish" && !hasSavedDefaults) {
      const save = await confirm({ message: "Set this target configuration as default?", initialValue: false });
      if (isCancel(save)) {
        cancel("Publish cancelled.");
        process.exit(0);
      }
      if (save) {
        await savePostingDefaults(selection);
      }
    }

    const configById = new Map(ready.map((target) => [target.id, target.config]));
    return chosen.map((row) => ({ id: row.id, config: configById.get(row.id)!, postMode: row.mode }));
  }

  const targets = resolveTargets(config, { profile: options.profile, targets: options.target });
  const { ready, skipped } = filterReadyTargets(config, targets, {
    explicitTargets: Boolean(options.target?.length),
  });
  for (const target of skipped) {
    console.warn(`Skipping ${target.id}: ${target.reason}`);
  }
  if (ready.length === 0) {
    throw new Error("No configured targets to publish to. Run `usp setup` or pass a configured --target.");
  }
  return ready.map((target) => ({ ...target, postMode: "llm" as PostMode }));
}

async function runPublishFlow(
  file: string | undefined,
  options: PublishOptions,
  mode: "publish" | "preview"
) {
  const config = await loadConfig({ configPath: options.config, overrides: options.set });
  const locallyReady = await resolvePublishTargets(config, options, mode);
  const pipeline = createPipeline(file, options, config);
  const previewStore = new PreviewStore();
  const { plan, results } = await pipeline.publish({
    config,
    targets: locallyReady,
    dryRun: false,
    preview: {
      store: previewStore,
      previewOnly: mode === "preview",
      async onExistingDirectory(dir) {
        return assertNotCancel(
          await select({
            message: `A preview already exists for this input at ${dir}.`,
            options: [
              { value: "reuse", label: "Reuse preview text", hint: "Load existing target files and generate only missing ones" },
              { value: "regenerate", label: "Regenerate text", hint: "Replace preview files with fresh LLM output" },
            ],
          })
        );
      },
    },
    hooks: createHumanHooks(),
  });

  if (mode === "preview") {
    printHumanResults(results);
  }
}

export async function publishCommand(file: string | undefined, options: PublishOptions) {
  await runPublishFlow(file, options, "publish");
}

export async function previewCommand(file: string | undefined, options: PublishOptions) {
  await runPublishFlow(file, options, "preview");
}
