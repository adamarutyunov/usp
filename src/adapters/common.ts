import type {
  Platform,
  PlatformPlan,
  PublishTargetResult,
  SourceMedia,
  TargetConfig,
  UspConfig,
} from "../types.js";
import { platformLabel } from "../platforms.js";

export { platformLabel };

export type PublishContext = {
  targetId: string;
  target: TargetConfig;
  config: UspConfig;
  plan: PlatformPlan;
  media: SourceMedia[];
  dryRun: boolean;
};

export type PublishPost = PublishTargetResult["posts"][number];

export type PlatformPublisher = (context: PublishContext) => Promise<PublishTargetResult>;

/**
 * Raised when a multi-post thread fails partway through. Carries the posts that
 * already went live so the pipeline can report them and the user does not
 * re-publish the whole thread (which would duplicate the successful units).
 */
export class PartialPublishError extends Error {
  constructor(
    readonly posts: PublishPost[],
    override readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PartialPublishError";
  }
}

/** Look up a per-platform account, throwing a consistent error when it is missing. */
export function requireAccount<T>(account: T | undefined, platform: Platform, name: string): T {
  if (!account) {
    throw new Error(`Missing ${platformLabel(platform)} account "${name}".`);
  }
  return account;
}

/** Assert that a media item has its bytes loaded (local images), returning them. */
export function requireMediaData(item: SourceMedia, platform: Platform): Buffer {
  if (!item.data) {
    throw new Error(`${platformLabel(platform)} requires loaded local media data: ${item.resolvedPath}`);
  }
  return item.data;
}

/** Build a multipart Blob from a loaded local media item. */
export function mediaBlob(item: SourceMedia, platform: Platform): Blob {
  return new Blob([new Uint8Array(requireMediaData(item, platform))], {
    type: item.mime ?? "application/octet-stream",
  });
}

/** Build a successful publish result for a target. */
export function publishResult(
  context: PublishContext,
  posts: PublishPost[],
  warnings?: string[]
): PublishTargetResult {
  return {
    target: context.targetId,
    platform: context.target.platform,
    account: context.target.account,
    dryRun: context.dryRun,
    posts,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Run each thread unit through `publish`, collecting posts. If a unit fails
 * after earlier units already posted, throw a PartialPublishError carrying the
 * successful posts so they are not re-published on retry.
 */
export async function publishThread<U>(
  units: U[],
  publish: (unit: U, index: number) => Promise<PublishPost>
): Promise<PublishPost[]> {
  const posts: PublishPost[] = [];
  for (const [index, unit] of units.entries()) {
    try {
      posts.push(await publish(unit, index));
    } catch (error) {
      if (posts.length > 0) {
        throw new PartialPublishError(posts, error);
      }
      throw error;
    }
  }
  return posts;
}

export function mediaById(media: SourceMedia[]) {
  return new Map(media.map((item) => [item.id, item]));
}

export function getReferencedMedia(media: SourceMedia[], refs: string[] | undefined) {
  const byId = mediaById(media);
  return (refs ?? []).map((id) => byId.get(id)).filter((item): item is SourceMedia => Boolean(item));
}

export function dryRunResult(context: PublishContext, warnings?: string[]): PublishTargetResult {
  return {
    target: context.targetId,
    platform: context.target.platform,
    account: context.target.account,
    dryRun: true,
    posts: context.plan.units.map((unit) => ({
      text: unit.text,
      id: undefined,
      url: undefined,
    })),
    warnings,
  };
}
