import { publishTarget } from "../adapters/index.js";
import { loadConfig } from "../config/config.js";
import { readMarkdownInput } from "../content/markdown.js";
import { createLlmClient } from "../llm/client.js";
import { buildPublishPlan } from "../llm/planner.js";
import type { PublishTargetResult } from "../types.js";
import { resolveTargets } from "./targets.js";

function printHumanResults(results: PublishTargetResult[]) {
  for (const result of results) {
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
  const input = await readMarkdownInput(file);
  const llm = createLlmClient(config.llm);
  const plan = await buildPublishPlan({ input, config, targets, llm });
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
  const input = await readMarkdownInput(file);
  const llm = createLlmClient(config.llm);
  const plan = await buildPublishPlan({ input, config, targets, llm });
  const results = [];

  for (const target of targets) {
    results.push(
      await publishTarget({
        targetId: target.id,
        target: target.config,
        config,
        plan,
        media: input.media,
        dryRun: Boolean(options.dryRun),
      })
    );
  }

  if (options.json) {
    console.log(JSON.stringify({ plan, results }, null, 2));
  } else {
    printHumanResults(results);
  }
}
