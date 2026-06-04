export type Platform =
  | "x"
  | "linkedin"
  | "reddit"
  | "telegram"
  | "aegea"
  | "bluesky"
  | "mastodon"
  | "discord"
  | "threads";

export type LlmProvider = "gemini" | "openai" | "anthropic";

export type PostMode = "off" | "as-is" | "llm";

export type JsonObject = Record<string, unknown>;

export type SecretValue = string | undefined;

export type LlmConfig = {
  provider?: LlmProvider;
  model?: string;
  apiKey?: SecretValue;
  authToken?: SecretValue;
};

export type XAccount = {
  consumerKey?: SecretValue;
  consumerSecret?: SecretValue;
  accessToken?: SecretValue;
  accessTokenSecret?: SecretValue;
};

export type LinkedInAccount = {
  accessToken?: SecretValue;
  author: string;
  version?: string;
};

export type RedditAccount = {
  clientId?: SecretValue;
  clientSecret?: SecretValue;
  refreshToken?: SecretValue;
  username?: SecretValue;
  password?: SecretValue;
  userAgent?: string;
  subreddit?: string;
};

export type TelegramAccount = {
  botToken?: SecretValue;
  chatId?: string;
};

export type AegeaAccount = {
  baseUrl?: string;
  password?: SecretValue;
};

export type BlueskyAccount = {
  identifier?: string;
  appPassword?: SecretValue;
  pdsUrl?: string;
};

export type MastodonAccount = {
  instanceUrl?: string;
  accessToken?: SecretValue;
  visibility?: "public" | "unlisted" | "private" | "direct";
};

export type DiscordAccount = {
  webhookUrl?: SecretValue;
  threadId?: string;
  username?: string;
  avatarUrl?: string;
};

export type ThreadsAccount = {
  accessToken?: SecretValue;
  userId?: string;
  username?: string;
  replyControl?: "everyone" | "followers" | "mentioned_only";
};

export type AccountsConfig = {
  x?: Record<string, XAccount>;
  linkedin?: Record<string, LinkedInAccount>;
  reddit?: Record<string, RedditAccount>;
  telegram?: Record<string, TelegramAccount>;
  aegea?: Record<string, AegeaAccount>;
  bluesky?: Record<string, BlueskyAccount>;
  mastodon?: Record<string, MastodonAccount>;
  discord?: Record<string, DiscordAccount>;
  threads?: Record<string, ThreadsAccount>;
};

export type BrowserAuthProfile = {
  profileDir: string;
  engine: "playwright";
  browser: "chromium" | "chrome" | "msedge";
  headless?: boolean;
  loginUrl: string;
  lastLoginAt: string;
};

export type BrowserAuthConfig = Partial<Record<Platform, Record<string, BrowserAuthProfile>>>;

export type TargetConfig = {
  platform: Platform;
  account: string;
  prompt?: string;
  subreddit?: string;
  chatId?: string;
  threadId?: string;
  mode?: "api";
};

export type ProfileConfig = {
  targets: string[];
};

/** Layer 3: a user override that appends to or replaces the built-in prompt layers. */
export type PromptLayer = {
  mode: "append" | "replace";
  text: string;
};

export type UspConfig = {
  llm?: LlmConfig;
  accounts?: AccountsConfig;
  browserAuth?: BrowserAuthConfig;
  targets?: Record<string, TargetConfig>;
  profiles?: Record<string, ProfileConfig>;
  prompts?: Partial<Record<Platform, PromptLayer>>;
  postingDefaults?: Record<string, PostMode>;
};

export type SourceMedia = {
  id: string;
  alt: string;
  rawPath: string;
  resolvedPath: string;
  isRemote: boolean;
  mime?: string;
  size?: number;
  data?: Buffer;
};

export type MarkdownInput = {
  inputPath: string;
  title?: string;
  body: string;
  bodyWithMediaPlaceholders: string;
  media: SourceMedia[];
};

export type PlanUnit = {
  text: string;
  mediaRefs?: string[];
};

export type PlatformPlan = {
  title?: string;
  units: PlanUnit[];
};

export type PublishPlan = {
  source: {
    inputPath: string;
    title?: string;
  };
  media: Array<Pick<SourceMedia, "id" | "alt" | "rawPath" | "mime" | "size">>;
  platforms: Partial<Record<Platform, PlatformPlan>>;
  targets?: Record<string, PlatformPlan>;
};

export type PublishTargetResult = {
  target: string;
  platform: Platform;
  account: string;
  dryRun: boolean;
  ok?: boolean;
  error?: string;
  posts: Array<{
    id?: string;
    url?: string;
    text?: string;
  }>;
  warnings?: string[];
};
