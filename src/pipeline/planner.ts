import { normalizePlan } from "../llm/planner.js";
import { PlatformPlanner, type PlanRequest, type PromptProvider, type LlmProcessor } from "./contracts.js";

export class LlmPlatformPlanner extends PlatformPlanner {
  constructor(
    private readonly prompts: PromptProvider,
    private readonly llm: LlmProcessor
  ) {
    super();
  }

  async plan(request: PlanRequest) {
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
