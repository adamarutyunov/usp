import type { Platform, PlatformPlan, PublishPlan, PublishTargetResult, TargetConfig, UspConfig } from "../types.js";
import type { PreviewStore } from "../preview/store.js";
import { PartialPublishError } from "../adapters/common.js";
import {
  InputSource,
  PlatformPlanner,
  Poster,
  type PipelineHooks,
  type PipelineInput,
  type TargetRef,
} from "./contracts.js";

const DEFAULT_CONCURRENCY = 4;

export type PipelineRunResult = {
  input: PipelineInput;
  plan: PublishPlan;
  results: PublishTargetResult[];
  previewDir?: string;
};

/** Run `fn` over items with at most `limit` in flight, preserving input order in the results. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

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

function formatError(error: unknown): string {
  // A partial-thread failure: report the underlying cause, not the wrapper.
  if (error instanceof PartialPublishError) {
    return formatError(error.cause);
  }
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
  if (details.cause instanceof Error) {
    parts.push(`cause=${details.cause.message}`);
  } else if (details.cause !== undefined && typeof details.cause !== "object") {
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
    // Surface any posts that already went live mid-thread so they are not re-published.
    posts: error instanceof PartialPublishError ? error.posts : [],
  };
}

function previewResult(target: { id: string; config: TargetConfig }, platformPlan: PlatformPlan): PublishTargetResult {
  return {
    target: target.id,
    platform: target.config.platform,
    account: target.config.account,
    dryRun: true,
    ok: true,
    posts: (platformPlan.units ?? []).map((unit) => ({ text: unit.text })),
  };
}

export class PublishPipeline {
  constructor(
    private readonly inputSource: InputSource,
    private readonly planner: PlatformPlanner,
    private readonly poster: Poster,
    private readonly concurrency: number = DEFAULT_CONCURRENCY
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

    for (const target of targets) {
      const platform = target.config.platform;

      hooks.onPrepareStart?.(target);
      try {
        const platformPlan = await this.planner.plan({ input, target, config });
        plan.targets![target.id] = platformPlan;
        plan.platforms[platform] ??= platformPlan;
        hooks.onPrepareSuccess?.(target, platformPlan);
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
    const basePlan = createEmptyPlan(input);
    const previewSession = preview?.store.open(input);
    const previewDir = previewSession?.dir;
    const previewExists = previewSession ? await previewSession.exists() : false;
    const previewActive = Boolean(previewSession && preview && (preview.previewOnly || previewExists));
    const previewOnly = Boolean(preview?.previewOnly);
    let reusePreview = false;

    if (previewActive && previewSession && preview) {
      hooks.onPreviewDirectory?.(previewSession.dir);
      reusePreview = previewExists
        ? (await preview.onExistingDirectory?.(previewSession.dir)) === "reuse"
        : false;
    }

    // Dedup identical plans: by target id under preview (each has its own file),
    // otherwise by platform+postMode+prompt. The per-target prompt MUST be in the key —
    // two targets on one account with different prompts (e.g. an English and a Russian
    // tweet) generate different text, and sharing a plan would post duplicate content.
    const planMemo = new Map<string, Promise<PlatformPlan>>();
    const planKey = (target: TargetRef) =>
      `${target.config.platform}:${target.postMode ?? "llm"}:${JSON.stringify(target.config.prompt ?? null)}`;

    // Resolve a target's plan and the media it should post with. For a reused
    // preview that's the (possibly edited) Markdown plus any images the user added;
    // otherwise it's the freshly generated plan over the source media.
    const resolvePlan = async (target: TargetRef): Promise<{ plan: PlatformPlan; media: typeof input.media }> => {
      if (previewActive && reusePreview && previewSession) {
        const cached = await previewSession.read(target);
        if (cached) {
          hooks.onPreviewReuse?.(target);
          return cached;
        }
      }

      const key = previewActive ? target.id : planKey(target);
      let pending = planMemo.get(key);
      if (!pending) {
        pending = this.planner.plan({ input, target, config });
        planMemo.set(key, pending);
      }
      const plan = await pending;

      if (previewActive && previewSession) {
        await previewSession.write(target, plan);
        hooks.onPreviewWrite?.(target, previewSession.filePath(target));
      }
      return { plan, media: input.media };
    };

    // Per-target plan handed to the poster; avoids a shared `plan.platforms`
    // that same-platform targets would otherwise clobber for one another.
    const singleTargetPlan = (target: TargetRef, platformPlan: PlatformPlan): PublishPlan => ({
      ...basePlan,
      platforms: { [target.config.platform]: platformPlan },
      targets: { [target.id]: platformPlan },
    });

    const processTarget = async (target: TargetRef): Promise<PublishTargetResult> => {
      hooks.onPrepareStart?.(target);
      let platformPlan: PlatformPlan;
      let media = input.media;
      try {
        const resolved = await resolvePlan(target);
        platformPlan = resolved.plan;
        media = resolved.media;
        hooks.onPrepareSuccess?.(target, platformPlan);
      } catch (error) {
        hooks.onPrepareError?.(target, error);
        return errorResult(target, error, previewOnly || dryRun);
      }
      basePlan.targets![target.id] = platformPlan;

      if (previewOnly) {
        return previewResult(target, platformPlan);
      }

      const targetPlan = singleTargetPlan(target, platformPlan);
      const postRequest = {
        targetId: target.id,
        target: target.config,
        config,
        plan: targetPlan,
        media,
      };

      if (dryRun) {
        return this.poster.post({ ...postRequest, dryRun: true });
      }

      hooks.onPostStart?.(target);
      try {
        const result = await this.poster.post({ ...postRequest, dryRun: false });
        const withStatus = { ...result, ok: true };
        hooks.onPostSuccess?.(target, withStatus);
        return withStatus;
      } catch (error) {
        hooks.onPostError?.(target, error);
        return errorResult(target, error, false);
      }
    };

    const results = await mapWithConcurrency(targets, this.concurrency, processTarget);
    return { input, plan: basePlan, results, previewDir };
  }
}

export { formatError };
