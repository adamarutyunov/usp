import { describe, expect, it } from "vitest";
import { buildPublishPlan } from "./planner.js";
import type { LlmClient } from "./client.js";
import type { MarkdownInput, UspConfig } from "../types.js";

describe("buildPublishPlan", () => {
  it("preserves generated media refs and limits X units", async () => {
    const input: MarkdownInput = {
      inputPath: "/tmp/post.md",
      title: "Post",
      body: "Body",
      bodyWithMediaPlaceholders: "Body [media:img1]",
      media: [
        {
          id: "img1",
          alt: "Image",
          rawPath: "./image.png",
          resolvedPath: "/tmp/image.png",
          isRemote: false,
        },
      ],
    };
    const config: UspConfig = {};
    const llm: LlmClient = {
      provider: "gemini",
      model: "test",
      async generate() {
        return JSON.stringify({
          units: [
            {
              text: "Short post",
              mediaRefs: ["img1", "unknown"],
            },
          ],
        });
      },
    };

    const plan = await buildPublishPlan({
      input,
      config,
      targets: [{ id: "x-main", config: { platform: "x", account: "main" } }],
      llm,
    });

    expect(plan.platforms.x?.units[0]).toEqual({
      text: "Short post",
      mediaRefs: ["img1"],
    });
  });
});
