import type { Platform, PublishPlan, PublishTargetResult, TargetConfig, UspConfig } from "../types.js";
import {
  InputSource,
  PlatformPlanner,
  Poster,
  type PipelineHooks,
  type PipelineInput,
  type TargetRef,
} from "./contracts.js";

export type PipelineRunResult = {
  input: PipelineInput;
  plan: PublishPlan;
  results: PublishTargetResult[];
};

function createEmptyPlan(input: PipelineInput): PublishPlan {
  return {
    source: {
      inputPath: input.inputPath,
      title: input.title,
    },
    media: input.media.map(({ id, alt, rawPath, mime, size }) => ({ id, alt, rawPath, mime, size })),
    platforms: {},
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

function errorResult(target: { id: string; config: TargetConfig }, error: unknown, dryRun: boolean): PublishTargetResult {
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

export class PublishPipeline {
  constructor(
    private readonly inputSource: InputSource,
    private readonly planner: PlatformPlanner,
    private readonly poster: Poster
  ) {}

  async planOnly({
    config,
    targets,
    hooks = {},
  }: {
    config: UspConfig;
    targets: TargetRef[];
    hooks?: PipelineHooks;
  }) {
    const input = await this.inputSource.read();
    const plan = createEmptyPlan(input);
    const plannedPlatforms = new Set<Platform>();

    for (const target of targets) {
      const platform = target.config.platform;
      if (plannedPlatforms.has(platform)) {
        continue;
      }

      hooks.onPrepareStart?.(target);
      try {
        plan.platforms[platform] = await this.planner.plan({ input, target, config });
        plannedPlatforms.add(platform);
        hooks.onPrepareSuccess?.(target, plan.platforms[platform]!);
      } catch (error) {
        hooks.onPrepareError?.(target, error);
      }
    }

    return { input, plan, results: [] };
  }

  async publish({
    config,
    targets,
    dryRun,
    hooks = {},
  }: {
    config: UspConfig;
    targets: TargetRef[];
    dryRun: boolean;
    hooks?: PipelineHooks;
  }): Promise<PipelineRunResult> {
    const input = await this.inputSource.read();
    const plan = createEmptyPlan(input);
    const results: PublishTargetResult[] = [];
    const plannedPlatforms = new Set<Platform>();

    for (const target of targets) {
      const platform = target.config.platform;
      if (!plannedPlatforms.has(platform)) {
        hooks.onPrepareStart?.(target);
        try {
          plan.platforms[platform] = await this.planner.plan({ input, target, config });
          plannedPlatforms.add(platform);
          hooks.onPrepareSuccess?.(target, plan.platforms[platform]!);
        } catch (error) {
          hooks.onPrepareError?.(target, error);
          results.push(errorResult(target, error, dryRun));
          continue;
        }
      }

      if (dryRun) {
        results.push(
          await this.poster.post({
            targetId: target.id,
            target: target.config,
            config,
            plan,
            media: input.media,
            dryRun: true,
          })
        );
        continue;
      }

      hooks.onPostStart?.(target);
      try {
        const result = await this.poster.post({
          targetId: target.id,
          target: target.config,
          config,
          plan,
          media: input.media,
          dryRun: false,
        });
        const withStatus = { ...result, ok: true };
        results.push(withStatus);
        hooks.onPostSuccess?.(target, withStatus);
      } catch (error) {
        hooks.onPostError?.(target, error);
        results.push(errorResult(target, error, false));
      }
    }

    return { input, plan, results };
  }
}

export { formatError };
