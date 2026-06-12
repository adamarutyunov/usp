import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { loadAllSourceMedia, localFsPath, readMarkdownInput, readMarkdownText } from "./markdown.js";

describe("localFsPath", () => {
  it("converts a file: URL and percent-encoding to a filesystem path", () => {
    expect(localFsPath("file:///Users/x/a%20b/Screenshot%20.png", "/base")).toBe("/Users/x/a b/Screenshot .png");
  });

  it("handles a single-slash file: URL", () => {
    expect(localFsPath("file:/Users/x/c.png", "/base")).toBe("/Users/x/c.png");
  });

  it("percent-decodes a relative local path against the base dir", () => {
    expect(localFsPath("./sub%20dir/c.png", "/base")).toBe("/base/sub dir/c.png");
  });

  it("leaves a literal percent intact when decoding would fail", () => {
    expect(localFsPath("./50%off.png", "/base")).toBe("/base/50%off.png");
  });
});

describe("readMarkdownInput", () => {
  it("extracts markdown images in source order without reading bytes; loads them on demand", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usp-md-"));
    const imagePath = path.join(dir, "image.png");
    const markdownPath = path.join(dir, "post.md");
    await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(
      markdownPath,
      ["# Title", "", "Before", "", "![Alt text](./image.png)", "", "After"].join("\n")
    );

    const input = await readMarkdownInput(markdownPath);

    expect(input.title).toBe("Title");
    expect(input.media).toHaveLength(1);
    expect(input.media[0]?.id).toBe("img1");
    expect(input.media[0]?.alt).toBe("Alt text");
    // Parsing builds the catalog only — bytes are NOT read until publish time.
    expect(input.media[0]?.data).toBeUndefined();
    expect(input.bodyWithMediaPlaceholders).toContain('[media:img1 alt="Alt text"]');

    // loadAllSourceMedia reads the file bytes when a real publish needs them.
    const loaded = await loadAllSourceMedia(input.media);
    expect(loaded[0]?.data?.byteLength).toBe(4);
  });

  it("supports direct markdown text input", async () => {
    const input = await readMarkdownText("# Direct\n\nBody", "<text>", process.cwd());

    expect(input.inputPath).toBe("<text>");
    expect(input.title).toBe("Direct");
    expect(input.body).toContain("Body");
  });

  it("rejects private remote image hosts when bytes are loaded", async () => {
    // Parsing no longer fetches, so the SSRF guard fires at load time (publish), not parse.
    const input = await readMarkdownText("![private](http://127.0.0.1/image.png)", "<text>", process.cwd());
    await expect(loadAllSourceMedia(input.media)).rejects.toThrow("private or link-local host");
  });
});
