import { describe, expect, it, vi } from "vitest";
import type { SourceMedia } from "../types.js";
import { uploadTempMedia } from "./temp-host.js";

const media: SourceMedia = {
  id: "img1",
  alt: "a",
  rawPath: "./a.png",
  resolvedPath: "/x/a.png",
  isRemote: false,
  mime: "image/png",
  data: Buffer.from("bytes"),
};

describe("uploadTempMedia", () => {
  it("uploads to litterbox and returns the public URL", async () => {
    const original = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("https://litter.catbox.moe/abc.png", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const url = await uploadTempMedia(media);
      expect(url).toBe("https://litter.catbox.moe/abc.png");
      expect(String(fetchMock.mock.calls[0]![0])).toContain("litterbox.catbox.moe");
      expect(fetchMock.mock.calls[0]![1]?.method).toBe("POST");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("throws when the host does not return a URL", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("error: file too large", { status: 200 })) as typeof fetch;
    try {
      await expect(uploadTempMedia(media)).rejects.toThrow(/Temporary image host/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
