import { describe, expect, it } from "vitest";

import type { UspConfig } from "../types.js";
import { LlmProcessor, PromptProvider, type PipelineInput, type PromptRequest } from "./contracts.js";
import { LlmPlatformPlanner, rawPlan } from "./planner.js";

class StaticPromptProvider extends PromptProvider {
  build(_request: PromptRequest) {
    return "prompt";
  }
}

class ThrowingLlm extends LlmProcessor {
  generateJson(): Promise<unknown> {
    throw new Error("LLM should not be called for as-is targets");
  }
}

function input(): PipelineInput {
  return {
    inputPath: "/tmp/post.md",
    title: "Title",
    body: "# Title\n\nVerbatim body",
    bodyWithMediaPlaceholders: "# Title\n\nVerbatim body",
    media: [
      { id: "img1", alt: "", rawPath: "a.png", resolvedPath: "/a.png", isRemote: false },
    ],
  };
}

const config: UspConfig = {};

describe("LlmPlatformPlanner as-is mode", () => {
  it("returns the raw body without calling the LLM", async () => {
    const planner = new LlmPlatformPlanner(new StaticPromptProvider(), new ThrowingLlm());
    const plan = await planner.plan({
      input: input(),
      target: { id: "x-main", config: { platform: "x", account: "main" }, postMode: "as-is" },
      config,
    });

    expect(plan).toEqual(rawPlan(input()));
    expect(plan.title).toBe("Title");
    expect(plan.units).toEqual([{ text: "# Title\n\nVerbatim body", mediaRefs: ["img1"] }]);
  });
});
