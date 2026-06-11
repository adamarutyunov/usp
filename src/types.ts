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

/** Layer 3: a user override that appends to or replaces the built-in prompt layers. */
export type PromptLayer = {
  mode: "append" | "replace";
  text: string;
};

/**
 * A concrete posting destination under an account: routing fields plus an optional
 * prompt override. Authored nested under `accounts.<platform>.<account>.targets`.
 */
export type TargetRouting = {
  subreddit?: string;
  chatId?: string;
  threadId?: string;
  prompt?: PromptLayer;
};

/** Mixed into every account type so accounts can hold their nested targets. */
export type AccountTargets = {
  targets?: Record<string, TargetRouting>;
};

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
};

export type TelegramAccount = {
  botToken?: SecretValue;
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
  username?: string;
  avatarUrl?: string;
};

export type ThreadsAccount = {
  accessToken?: SecretValue;
  /** ISO timestamp when accessToken expires; set when usp exchanges/refreshes a long-lived token. */
  accessTokenExpiresAt?: string;
  userId?: string;
  username?: string;
  replyControl?: "everyone" | "followers" | "mentioned_only";
};

export type AccountsConfig = {
  x?: Record<string, XAccount & AccountTargets>;
  linkedin?: Record<string, LinkedInAccount & AccountTargets>;
  reddit?: Record<string, RedditAccount & AccountTargets>;
  telegram?: Record<string, TelegramAccount & AccountTargets>;
  aegea?: Record<string, AegeaAccount & AccountTargets>;
  bluesky?: Record<string, BlueskyAccount & AccountTargets>;
  mastodon?: Record<string, MastodonAccount & AccountTargets>;
  discord?: Record<string, DiscordAccount & AccountTargets>;
  threads?: Record<string, ThreadsAccount & AccountTargets>;
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

/**
 * A target resolved for the runtime pipeline. Built by normalizing the nested
 * `accounts.<platform>.<account>.targets` into a flat map keyed by `platform/account/name`.
 */
export type TargetConfig = {
  platform: Platform;
  account: string;
  prompt?: PromptLayer;
  subreddit?: string;
  chatId?: string;
  threadId?: string;
  mode?: "api";
};

export type ProfileConfig = {
  targets: string[];
};

export type UspConfig = {
  llm?: LlmConfig;
  accounts?: AccountsConfig;
  browserAuth?: BrowserAuthConfig;
  targets?: Record<string, TargetConfig>;
  profiles?: Record<string, ProfileConfig>;
  /** Layer 1 addition: user's global rules, appended to the built-in base guidance (append-only). */
  globalPrompt?: string;
  /** Layer 2 overrides, one per platform. */
  prompts?: Partial<Record<Platform, PromptLayer>>;
  postingDefaults?: Record<string, PostMode>;
  /**
   * When true, local images for URL-only platforms (Threads, Reddit self-posts) are
   * uploaded to a temporary public host so those platforms can fetch them. Opt-in: the
   * image bytes briefly transit a third-party host.
   */
  uploadLocalMedia?: boolean;
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
