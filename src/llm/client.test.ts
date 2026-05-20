import { describe, expect, it, vi } from "vitest";
import { createLlmClient } from "./client.js";

describe("createLlmClient", () => {
  it("creates an Anthropic client using a configured API key", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "{\"units\":[{\"text\":\"ok\"}]}" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    try {
      const client = createLlmClient({ provider: "anthropic", apiKey: "test-key" });
      const text = await client.generate("prompt");

      expect(client.model).toBe("claude-sonnet-4-5");
      expect(text).toBe("{\"units\":[{\"text\":\"ok\"}]}");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-key": "test-key",
            "anthropic-version": "2023-06-01",
          }),
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates an Anthropic client using a configured auth token", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "{\"units\":[{\"text\":\"ok\"}]}" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    try {
      const client = createLlmClient({
        provider: "anthropic",
        authToken: "setup-token",
      });
      await client.generate("prompt");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer setup-token",
          }),
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
