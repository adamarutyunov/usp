import type { PublishTargetResult, SourceMedia, TargetConfig, UspConfig, PublishPlan } from "../types.js";
import { publishToLinkedIn } from "./linkedin.js";
import { publishToReddit } from "./reddit.js";
import { publishToTelegram } from "./telegram.js";
import { publishToX } from "./x.js";

const publishers = {
  x: publishToX,
  linkedin: publishToLinkedIn,
  reddit: publishToReddit,
  telegram: publishToTelegram,
};

export async function publishTarget({
  targetId,
  target,
  config,
  plan,
  media,
  dryRun,
}: {
  targetId: string;
  target: TargetConfig;
  config: UspConfig;
  plan: PublishPlan;
  media: SourceMedia[];
  dryRun: boolean;
}): Promise<PublishTargetResult> {
  const platformPlan = plan.platforms[target.platform];
  if (!platformPlan) {
    throw new Error(`Plan does not contain platform "${target.platform}".`);
  }

  return publishers[target.platform]({
    targetId,
    target,
    config,
    plan: platformPlan,
    media,
    dryRun,
  });
}
