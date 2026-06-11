import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import type { MarkdownInput, SourceMedia } from "../types.js";
import { PreviewStore } from "./store.js";

function input(dir: string, media: SourceMedia[] = []): MarkdownInput {
  return {
    inputPath: path.join(dir, "post.md"),
    title: "Source",
    body: "",
    bodyWithMediaPlaceholders: "",
    media,
  };
}

const target = { id: "reddit/main/blog", config: { platform: "reddit" as const, account: "main" } };

describe("PreviewStore Markdown round-trip", () => {
  it("writes a .md file in a sibling <name>.usp-preview folder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-store-"));
    const session = new PreviewStore().open(input(dir));
    await session.write(target, { units: [{ text: "hello" }] });

    expect(session.dir).toBe(path.join(dir, "post.usp-preview"));
    await expect(fs.readdir(session.dir)).resolves.toEqual(["reddit-main-blog.md"]);
  });

  it("round-trips title, multiple posts, and inline media", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-store-"));
    const media: SourceMedia[] = [
      {
        id: "img1",
        alt: "chart",
        rawPath: "./chart.png",
        resolvedPath: "/x/chart.png",
        isRemote: false,
        data: Buffer.from("chart-bytes"),
      },
    ];
    const session = new PreviewStore().open(input(dir, media));
    await session.write(target, {
      title: "My Title",
      units: [
        { text: "para one", mediaRefs: ["img1"] },
        { text: "para two", mediaRefs: [] },
      ],
    });

    const back = await session.read(target);
    expect(back?.plan.title).toBe("My Title");
    expect(back?.plan.units).toEqual([
      { text: "para one", mediaRefs: ["img1"] },
      { text: "para two", mediaRefs: [] },
    ]);
    // The source image keeps its already-loaded bytes.
    expect(back?.media.find((item) => item.id === "img1")?.data?.toString()).toBe("chart-bytes");
  });

  it("strips HTML comments and reads a hand-edited leading-# title", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-store-"));
    const session = new PreviewStore().open(input(dir));
    await fs.mkdir(session.dir, { recursive: true });
    await fs.writeFile(
      session.filePath(target),
      "<!-- usp note: dashes ---------- inside a comment are ignored -->\n\n# Hand Title\n\nfirst\n\n----------\n\nsecond\n"
    );

    const back = await session.read(target);
    expect(back?.plan.title).toBe("Hand Title");
    expect(back?.plan.units.map((unit) => unit.text)).toEqual(["first", "second"]);
  });

  it("does not duplicate an image already inline in the post text (as-is)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-store-"));
    const media: SourceMedia[] = [
      { id: "img1", alt: "pic", rawPath: "./a.png", resolvedPath: "/x/a.png", isRemote: false, data: Buffer.from("x") },
    ];
    const session = new PreviewStore().open(input(dir, media));
    // as-is style: the body text already contains the image, and mediaRefs also references it.
    await session.write(target, { units: [{ text: "body\n\n![pic](./a.png)", mediaRefs: ["img1"] }] });

    const raw = await fs.readFile(session.filePath(target), "utf8");
    expect(raw.match(/!\[pic\]\(\.\/a\.png\)/g) ?? []).toHaveLength(1);
  });

  it("loads a new local image added in the edited preview", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-store-"));
    await fs.writeFile(path.join(dir, "extra.png"), Buffer.from("new-image-bytes"));
    const session = new PreviewStore().open(input(dir));
    await fs.mkdir(session.dir, { recursive: true });
    await fs.writeFile(session.filePath(target), "a post\n\n![new pic](./extra.png)\n");

    const back = await session.read(target);
    expect(back?.plan.units[0]?.text).toBe("a post");
    expect(back?.plan.units[0]?.mediaRefs).toHaveLength(1);
    const added = back?.media[0];
    expect(added?.data?.toString()).toBe("new-image-bytes");
    expect(added?.id).toBe(back?.plan.units[0]?.mediaRefs[0]);
  });
});
