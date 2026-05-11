import type {
  MarkdownInput,
  Platform,
  PlatformPlan,
  PublishPlan,
  PublishTargetResult,
  SourceMedia,
  TargetConfig,
  UspConfig,
} from "../types.js";

export type TargetRef = {
  id: string;
  config: TargetConfig;
};

export type PipelineInput = MarkdownInput;

export abstract class InputSource {
  abstract read(): Promise<PipelineInput>;
}

export type PromptRequest = {
  input: PipelineInput;
  platform: Platform;
  target: TargetConfig;
  config: UspConfig;
};

export abstract class PromptProvider {
  abstract build(request: PromptRequest): string;
}

export abstract class LlmProcessor {
  abstract generateJson(prompt: string): Promise<unknown>;
}

export type PlanRequest = {
  input: PipelineInput;
  target: TargetRef;
  config: UspConfig;
};

export abstract class PlatformPlanner {
  abstract plan(request: PlanRequest): Promise<PlatformPlan>;
}

export type PostRequest = {
  targetId: string;
  target: TargetConfig;
  config: UspConfig;
  plan: PublishPlan;
  media: SourceMedia[];
  dryRun: boolean;
};

export abstract class Poster {
  abstract post(request: PostRequest): Promise<PublishTargetResult>;
}

export type PipelineHooks = {
  onSkip?(target: TargetRef, reason: string): void;
  onPrepareStart?(target: TargetRef): void;
  onPrepareSuccess?(target: TargetRef, plan: PlatformPlan): void;
  onPrepareError?(target: TargetRef, error: unknown): void;
  onPostStart?(target: TargetRef): void;
  onPostSuccess?(target: TargetRef, result: PublishTargetResult): void;
  onPostError?(target: TargetRef, error: unknown): void;
};
