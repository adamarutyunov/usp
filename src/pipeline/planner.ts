import type { PipelineInput } from "./contracts.js";
import type { PlatformPlan } from "../types.js";
import { normalizePlan } from "../llm/planner.js";
import { PlatformPlanner, type PlanRequest, type PromptProvider, type LlmProcessor } from "./contracts.js";

export function rawPlan(input: PipelineInput): PlatformPlan {
  return {
    title: input.title,
    units: [
      {
        text: input.body,
        mediaRefs: input.media.map((item) => item.id),
      },
    ],
  };
}

export class LlmPlatformPlanner extends PlatformPlanner {
  constructor(
    private readonly prompts: PromptProvider,
    private readonly llm: LlmProcessor
  ) {
    super();
  }

  async plan(request: PlanRequest) {
    if (request.target.postMode === "as-is") {
      return rawPlan(request.input);
    }

    const platform = request.target.config.platform;
    const prompt = this.prompts.build({
      input: request.input,
      platform,
      target: request.target.config,
      config: request.config,
    });
    const raw = await this.llm.generateJson(prompt);
    return normalizePlan(platform, raw, new Set(request.input.media.map((item) => item.id)));
  }
}
