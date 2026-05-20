import type { Platform, PublishPlan, PublishTargetResult, TargetConfig, UspConfig } from "../types.js";
import type { PreviewStore } from "../preview/store.js";
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
  previewDir?: string;
};

export type PreviewPublishOptions = {
  store: PreviewStore;
  previewOnly: boolean;
  onExistingDirectory?: (dir: string) => Promise<"reuse" | "regenerate">;
};

function createEmptyPlan(input: PipelineInput): PublishPlan {
  return {
    source: {
      inputPath: input.inputPath,
      title: input.title,
    },
    media: input.media.map(({ id, alt, rawPath, mime, size }) => ({ id, alt, rawPath, mime, size })),
    platforms: {},
    targets: {},
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

function previewResult(target: { id: string; config: TargetConfig }, plan: PublishPlan): PublishTargetResult {
  const targetPlan = plan.targets?.[target.id] ?? plan.platforms[target.config.platform];
  return {
    target: target.id,
    platform: target.config.platform,
    account: target.config.account,
    dryRun: true,
    ok: true,
    posts: (targetPlan?.units ?? []).map((unit) => ({ text: unit.text })),
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
    preview,
    hooks = {},
  }: {
    config: UspConfig;
    targets: TargetRef[];
    dryRun: boolean;
    preview?: PreviewPublishOptions;
    hooks?: PipelineHooks;
  }): Promise<PipelineRunResult> {
    const input = await this.inputSource.read();
    const plan = createEmptyPlan(input);
    const results: PublishTargetResult[] = [];
    const plannedPlatforms = new Set<Platform>();
    const previewSession = preview?.store.open(input);
    const previewDir = previewSession?.dir;
    const previewExists = previewSession ? await previewSession.exists() : false;
    const usePreview = Boolean(previewSession && (preview?.previewOnly || previewExists));
    let reusePreview = false;

    if (previewSession && preview && usePreview) {
      hooks.onPreviewDirectory?.(previewSession.dir);
      reusePreview = previewExists
        ? (await preview.onExistingDirectory?.(previewSession.dir)) === "reuse"
        : false;
    }

    for (const target of targets) {
      const platform = target.config.platform;
      if (previewSession && preview && usePreview) {
        if (reusePreview) {
          hooks.onPrepareStart?.(target);
          const cached = await previewSession.read(target);
          if (cached) {
            plan.targets![target.id] = cached;
            plan.platforms[platform] = cached;
            hooks.onPreviewReuse?.(target);
            hooks.onPrepareSuccess?.(target, cached);

            if (preview.previewOnly) {
              results.push(previewResult(target, plan));
              continue;
            }
          }
        }

        if (!plan.targets?.[target.id]) {
          if (!reusePreview) {
            hooks.onPrepareStart?.(target);
          }
          try {
            const targetPlan = await this.planner.plan({ input, target, config });
            plan.targets![target.id] = targetPlan;
            plan.platforms[platform] = targetPlan;
            hooks.onPrepareSuccess?.(target, targetPlan);
            await previewSession.write(target, targetPlan);
            hooks.onPreviewWrite?.(target, previewSession.filePath(target));
          } catch (error) {
            hooks.onPrepareError?.(target, error);
            results.push(errorResult(target, error, true));
            continue;
          }
        }

        if (preview.previewOnly) {
          results.push(previewResult(target, plan));
          continue;
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
        continue;
      }

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

    return { input, plan, results, previewDir };
  }
}

export { formatError };
