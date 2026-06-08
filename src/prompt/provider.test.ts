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

  it("appends CLI prompt text after the base and platform layers", () => {
    const provider = new ConfigPromptProvider([parsePromptOverride("x:append:Use a dry tone.")]);
    const prompt = provider.build({
      input,
      platform: "x",
      target: { platform: "x", account: "main" },
      config: {},
    });

    // Layer 1 (base), layer 2 (platform rules), and layer 3 (override) are all present.
    expect(prompt).toContain("tailor a post for a specific social media platform");
    expect(prompt).toContain("280 characters");
    expect(prompt).toContain("Use a dry tone.");
    // Output contract is always present.
    expect(prompt).toContain("Return only valid JSON");
  });

  it("replace drops the base and platform layers but keeps the output contract", () => {
    const provider = new ConfigPromptProvider([parsePromptOverride("x:replace:Only my words.")]);
    const prompt = provider.build({
      input,
      platform: "x",
      target: { platform: "x", account: "main" },
      config: {},
    });

    expect(prompt).toContain("Only my words.");
    expect(prompt).not.toContain("280 characters");
    expect(prompt).not.toContain("tailor a post for a specific social media platform");
    expect(prompt).toContain("Return only valid JSON");
  });

  it("appends the global prompt to the base guidance", () => {
    const provider = new ConfigPromptProvider();
    const prompt = provider.build({
      input,
      platform: "x",
      target: { platform: "x", account: "main" },
      config: { globalPrompt: "Always write in British English." },
    });
    expect(prompt).toContain("# Custom Global Prompt");
    expect(prompt).toContain("Always write in British English.");
    expect(prompt).toContain("280 characters"); // platform rules still present
  });

  it("drops the global prompt when a target replaces the guidance", () => {
    const provider = new ConfigPromptProvider();
    const prompt = provider.build({
      input,
      platform: "x",
      target: { platform: "x", account: "main", prompt: { mode: "replace", text: "Only this." } },
      config: { globalPrompt: "Always write in British English." },
    });
    expect(prompt).toContain("Only this.");
    expect(prompt).not.toContain("British English");
  });

  it("uses a configured layer-3 override when no CLI override is given", () => {
    const provider = new ConfigPromptProvider();
    const prompt = provider.build({
      input,
      platform: "x",
      target: { platform: "x", account: "main" },
      config: { prompts: { x: { mode: "replace", text: "Configured only." } } },
    });

    expect(prompt).toContain("Configured only.");
    expect(prompt).not.toContain("280 characters");
  });
});
