import { beforeEach, describe, expect, it, vi } from "vitest";

const createMessage = vi.fn();
const constructorArgs: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: createMessage };
    constructor(options: Record<string, unknown>) {
      constructorArgs.push(options);
    }
  }
  return { default: MockAnthropic };
});

import { createLlmClient } from "./client.js";

describe("createLlmClient (anthropic)", () => {
  beforeEach(() => {
    createMessage.mockReset();
    constructorArgs.length = 0;
    createMessage.mockResolvedValue({
      content: [
        { type: "text", text: "{\"units\":[{\"text\":" },
        { type: "text", text: "\"ok\"}]}" },
      ],
    });
  });

  it("uses a configured API key and returns the joined text content", async () => {
    const client = createLlmClient({ provider: "anthropic", apiKey: "test-key" });
    const text = await client.generate("prompt");

    expect(client.model).toBe("claude-sonnet-4-5");
    expect(text).toBe("{\"units\":[{\"text\":\"ok\"}]}");
    expect(constructorArgs[0]).toMatchObject({ apiKey: "test-key" });
    expect(constructorArgs[0]).not.toHaveProperty("authToken");
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "prompt" }],
      })
    );
    // temperature must not be sent — it is rejected by current Opus models.
    expect(createMessage.mock.calls[0]![0]).not.toHaveProperty("temperature");
  });

  it("uses a configured auth token", async () => {
    const client = createLlmClient({ provider: "anthropic", authToken: "setup-token" });
    await client.generate("prompt");

    expect(constructorArgs[0]).toMatchObject({ authToken: "setup-token" });
    expect(constructorArgs[0]).not.toHaveProperty("apiKey");
  });

  it("throws when neither key nor token is configured", () => {
    expect(() => createLlmClient({ provider: "anthropic" })).toThrow(/Anthropic API key or auth token/);
  });
});
