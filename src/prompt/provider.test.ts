import { describe, expect, it } from "vitest";
import { ConfigPromptProvider, parsePromptOverride } from "./provider.js";
import type { MarkdownInput } from "../types.js";

const input: MarkdownInput = {
  inputPath: "<text>",
  title: "Title",
  body: "Body",
  bodyWithMediaPlaceholders: "Body",
  media: [],
};

describe("prompt provider", () => {
  it("parses replace and append prompt overrides", () => {
    expect(parsePromptOverride("x:replace:Only this")).toEqual({
      platform: "x",
      mode: "replace",
      text: "Only this",
    });
    expect(parsePromptOverride("linkedin:append:Add this")).toEqual({
      platform: "linkedin",
      mode: "append",
      text: "Add this",
    });
    expect(parsePromptOverride("reddit:Only this")).toEqual({
      platform: "reddit",
      mode: "replace",
      text: "Only this",
    });
    expect(parsePromptOverride("aegea:Only this")).toEqual({
      platform: "aegea",
      mode: "replace",
      text: "Only this",
    });
    expect(parsePromptOverride("bluesky:Only this")).toEqual({
      platform: "bluesky",
      mode: "replace",
      text: "Only this",
    });
    expect(parsePromptOverride("mastodon:Only this")).toEqual({
      platform: "mastodon",
      mode: "replace",
      text: "Only this",
    });
    expect(parsePromptOverride("discord:Only this")).toEqual({
      platform: "discord",
      mode: "replace",
      text: "Only this",
    });
  });

  it("appends CLI prompt text to the default prompt", () => {
    const provider = new ConfigPromptProvider([parsePromptOverride("x:append:Use a dry tone.")]);
    const prompt = provider.build({
      input,
      platform: "x",
      target: { platform: "x", account: "main" },
      config: {},
    });

    expect(prompt).toContain("Platform: X.");
    expect(prompt).toContain("Use a dry tone.");
  });
});
