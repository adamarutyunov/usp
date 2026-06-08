import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { PreviewStore } from "../preview/store.js";
import type { PlatformPlan, PublishTargetResult, UspConfig } from "../types.js";
import { InputSource, PlatformPlanner, Poster, type PipelineInput, type PlanRequest, type PostRequest } from "./contracts.js";
import { PublishPipeline } from "./pipeline.js";

class StaticInputSource extends InputSource {
  constructor(private readonly input: PipelineInput) {
    super();
  }

  read() {
    return Promise.resolve(this.input);
  }
}

class RecordingPlanner extends PlatformPlanner {
  readonly calls: string[] = [];

  async plan(request: PlanRequest): Promise<PlatformPlan> {
    this.calls.push(request.target.id);
    return {
      units: [{ text: `generated ${request.target.id}` }],
    };
  }
}

class RecordingPoster extends Poster {
  readonly calls: string[] = [];

  async post(request: PostRequest): Promise<PublishTargetResult> {
    this.calls.push(request.targetId);
    const targetPlan = request.plan.targets?.[request.targetId] ?? request.plan.platforms[request.target.platform];
    return {
      target: request.targetId,
      platform: request.target.platform,
      account: request.target.account,
      dryRun: request.dryRun,
      posts: (targetPlan?.units ?? []).map((unit) => ({ text: unit.text })),
    };
  }
}

class ModeAwarePlanner extends PlatformPlanner {
  readonly calls: string[] = [];

  async plan(request: PlanRequest): Promise<PlatformPlan> {
    const mode = request.target.postMode ?? "llm";
    const key = `${request.target.config.platform}:${mode}`;
    this.calls.push(key);
    return { units: [{ text: key }] };
  }
}

function input(): PipelineInput {
  return {
    inputPath: "/tmp/post.md",
    title: "Post",
    body: "# Post\n\nBody",
    bodyWithMediaPlaceholders: "# Post\n\nBody",
    media: [],
  };
}

const config: UspConfig = {};

describe("PublishPipeline preview support", () => {
  it("writes target preview files in preview-only mode without posting", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-preview-"));
    const planner = new RecordingPlanner();
    const poster = new RecordingPoster();
    const pipeline = new PublishPipeline(new StaticInputSource(input()), planner, poster);

    const result = await pipeline.publish({
      config,
      targets: [{ id: "x-main", config: { platform: "x", account: "main" } }],
      dryRun: false,
      preview: {
        store: new PreviewStore(dir),
        previewOnly: true,
      },
    });

    expect(planner.calls).toEqual(["x-main"]);
    expect(poster.calls).toEqual([]);
    expect(result.results[0]?.posts[0]?.text).toBe("generated x-main");
    expect(result.previewDir).toBeTruthy();
    await expect(fs.readdir(result.previewDir!)).resolves.toEqual(["x-main-x-main.json"]);
  });

  it("reuses cached target text and generates missing target previews", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-preview-"));
    const store = new PreviewStore(dir);
    const target = { id: "x-main", config: { platform: "x" as const, account: "main" } };
    await store.open(input()).write(target, { units: [{ text: "cached x-main" }] });

    const planner = new RecordingPlanner();
    const poster = new RecordingPoster();
    const pipeline = new PublishPipeline(new StaticInputSource(input()), planner, poster);

    const result = await pipeline.publish({
      config,
      targets: [
        target,
        { id: "x-alt", config: { platform: "x", account: "alt" } },
      ],
      dryRun: true,
      preview: {
        store,
        previewOnly: false,
        onExistingDirectory: async () => "reuse",
      },
    });

    expect(planner.calls).toEqual(["x-alt"]);
    expect(result.results.map((item) => item.posts[0]?.text)).toEqual(["cached x-main", "generated x-alt"]);
    await expect(fs.readdir(result.previewDir!)).resolves.toEqual(["x-alt-x-alt.json", "x-main-x-main.json"]);
  });

  it("does not reuse previews when the planning fingerprint changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-preview-"));
    const target = { id: "x-main", config: { platform: "x" as const, account: "main" } };
    const staleStore = new PreviewStore(dir);
    await staleStore.open(input(), { fingerprint: () => "old" }).write(target, { units: [{ text: "stale" }] });

    const planner = new RecordingPlanner();
    const poster = new RecordingPoster();
    const pipeline = new PublishPipeline(new StaticInputSource(input()), planner, poster);

    const result = await pipeline.publish({
      config,
      targets: [target],
      dryRun: true,
      preview: {
        store: new PreviewStore(dir),
        previewOnly: false,
        fingerprint: () => "new",
        onExistingDirectory: async () => "reuse",
      },
    });

    expect(planner.calls).toEqual(["x-main"]);
    expect(result.results[0]?.posts[0]?.text).toBe("generated x-main");
  });
});

describe("PublishPipeline mode handling (no preview)", () => {
  it("plans separately per platform+mode and posts per-target plans", async () => {
    const planner = new ModeAwarePlanner();
    const poster = new RecordingPoster();
    const pipeline = new PublishPipeline(new StaticInputSource(input()), planner, poster);

    const result = await pipeline.publish({
      config,
      dryRun: true,
      targets: [
        { id: "x-llm", config: { platform: "x", account: "main" }, postMode: "llm" },
        { id: "x-raw", config: { platform: "x", account: "main" }, postMode: "as-is" },
      ],
    });

    expect(planner.calls).toEqual(["x:llm", "x:as-is"]);
    expect(result.results.map((item) => item.posts[0]?.text)).toEqual(["x:llm", "x:as-is"]);
  });

  it("dedupes planning for same platform and mode", async () => {
    const planner = new ModeAwarePlanner();
    const poster = new RecordingPoster();
    const pipeline = new PublishPipeline(new StaticInputSource(input()), planner, poster);

    const result = await pipeline.publish({
      config,
      dryRun: true,
      targets: [
        { id: "x-main", config: { platform: "x", account: "main" }, postMode: "llm" },
        { id: "x-alt", config: { platform: "x", account: "alt" }, postMode: "llm" },
      ],
    });

    expect(planner.calls).toEqual(["x:llm"]);
    expect(result.results.map((item) => item.posts[0]?.text)).toEqual(["x:llm", "x:llm"]);
  });

  it("planOnly plans every target so target-specific prompts are preserved", async () => {
    const planner = new RecordingPlanner();
    const pipeline = new PublishPipeline(new StaticInputSource(input()), planner, new RecordingPoster());

    const result = await pipeline.planOnly({
      config,
      targets: [
        { id: "x-main", config: { platform: "x", account: "main" } },
        { id: "x-alt", config: { platform: "x", account: "alt", prompt: { mode: "append", text: "Alt." } } },
      ],
    });

    expect(planner.calls).toEqual(["x-main", "x-alt"]);
    expect(Object.keys(result.plan.targets ?? {}).sort()).toEqual(["x-alt", "x-main"]);
    expect(result.plan.platforms.x?.units[0]?.text).toBe("generated x-main");
  });
});
