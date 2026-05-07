import { describe, expect, it, vi } from "vitest";
import { createLlmClient } from "./client.js";

describe("createLlmClient", () => {
  it("creates an Anthropic client using ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
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
      const client = createLlmClient({ provider: "anthropic" });
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
      vi.unstubAllEnvs();
    }
  });

  it("creates an Anthropic client using ANTHROPIC_AUTH_TOKEN", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "setup-token");
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
        authSource: "anthropic-auth-token",
        authTokenEnv: "ANTHROPIC_AUTH_TOKEN",
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
      vi.unstubAllEnvs();
    }
  });
});
