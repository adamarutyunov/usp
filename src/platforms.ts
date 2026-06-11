import type { Platform, TargetRouting } from "./types.js";

export type RoutingField = {
  key: keyof Pick<TargetRouting, "subreddit" | "chatId" | "threadId">;
  label: string;
  placeholder: string;
  required: boolean;
};

export type PlatformMetadata = {
  label: string;
  setupHint: string;
  defaultAccount: string;
  accountEnvFields: string[];
  routing?: RoutingField;
};

export const PLATFORMS = [
  "x",
  "linkedin",
  "reddit",
  "telegram",
  "aegea",
  "bluesky",
  "mastodon",
  "discord",
  "threads",
] as const satisfies readonly Platform[];

export const PLATFORM_METADATA: Record<Platform, PlatformMetadata> = {
  x: {
    label: "X",
    setupHint: "API posting with media",
    defaultAccount: "main",
    accountEnvFields: ["consumerKey", "consumerSecret", "accessToken", "accessTokenSecret"],
  },
  linkedin: {
    label: "LinkedIn",
    setupHint: "Personal profile posts",
    defaultAccount: "me",
    accountEnvFields: ["accessToken", "author", "version"],
  },
  reddit: {
    label: "Reddit",
    setupHint: "One subreddit target",
    defaultAccount: "main",
    accountEnvFields: ["clientId", "clientSecret", "refreshToken", "username", "password", "userAgent"],
    routing: { key: "subreddit", label: "Subreddit", placeholder: "reddit_api_test", required: true },
  },
  telegram: {
    label: "Telegram",
    setupHint: "Channel, group, or chat",
    defaultAccount: "main",
    accountEnvFields: ["botToken"],
    routing: { key: "chatId", label: "Chat id", placeholder: "@my_channel", required: true },
  },
  aegea: {
    label: "Aegea",
    setupHint: "Blog post via password login",
    defaultAccount: "main",
    accountEnvFields: ["baseUrl", "password"],
  },
  bluesky: {
    label: "Bluesky",
    setupHint: "API posts and threads",
    defaultAccount: "main",
    accountEnvFields: ["identifier", "appPassword", "pdsUrl"],
  },
  mastodon: {
    label: "Mastodon",
    setupHint: "Instance API posts and threads",
    defaultAccount: "main",
    accountEnvFields: ["instanceUrl", "accessToken", "visibility"],
  },
  discord: {
    label: "Discord",
    setupHint: "Incoming webhook",
    defaultAccount: "main",
    accountEnvFields: ["webhookUrl", "username", "avatarUrl"],
    routing: { key: "threadId", label: "Thread id", placeholder: "(optional)", required: false },
  },
  threads: {
    label: "Threads",
    setupHint: "API posts and reply chains",
    defaultAccount: "main",
    accountEnvFields: ["accessToken", "userId", "username", "replyControl"],
  },
};

// Platforms that publish a multi-post reply chain (a thread). Used both for the LLM
// thread rules and for showing only the first post's link in the publish summary.
export const THREAD_PLATFORMS: ReadonlySet<Platform> = new Set(["x", "bluesky", "mastodon", "threads"]);

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function platformLabel(platform: Platform) {
  return PLATFORM_METADATA[platform].label;
}
