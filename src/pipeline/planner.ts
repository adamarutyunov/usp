import type { PipelineInput } from "./contracts.js";
import type { PlatformPlan } from "../types.js";
import { normalizePlan } from "../llm/planner.js";
import { PlatformPlanner, type PlanRequest, type PromptProvider, type LlmProcessor } from "./contracts.js";

/** The title travels separately on the plan, so drop the heading line it was inferred from. */
function stripTitleHeading(body: string, title: string | undefined): string {
  if (!title) {
    return body;
  }
  const match = body.match(/^#[ \t]+(.+?)[ \t]*$/m);
  if (!match || match[1]?.trim() !== title) {
    return body;
  }
  const index = body.indexOf(match[0]);
  const stripped = body.slice(0, index) + body.slice(index + match[0].length);
  return stripped.replace(/\n{3,}/g, "\n\n").trim();
}

export function rawPlan(input: PipelineInput): PlatformPlan {
  return {
    title: input.title,
    units: [
      {
        text: stripTitleHeading(input.body, input.title),
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
