import type {
  PlatformPlan,
  PublishTargetResult,
  SourceMedia,
  TargetConfig,
  UspConfig,
} from "../types.js";

export type PublishContext = {
  targetId: string;
  target: TargetConfig;
  config: UspConfig;
  plan: PlatformPlan;
  media: SourceMedia[];
  dryRun: boolean;
};

export type PlatformPublisher = (context: PublishContext) => Promise<PublishTargetResult>;

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
