export type Platform =
  | "x"
  | "linkedin"
  | "reddit"
  | "telegram"
  | "aegea"
  | "bluesky"
  | "mastodon"
  | "discord";

export type LlmProvider = "gemini" | "openai" | "anthropic";

export type JsonObject = Record<string, unknown>;

export type SecretValue = string | undefined;

export type LlmConfig = {
  provider?: LlmProvider;
  model?: string;
  apiKey?: SecretValue;
  apiKeyEnv?: string;
  authToken?: SecretValue;
  authTokenEnv?: string;
  authSource?: "api-key" | "codex" | "anthropic-auth-token";
};

export type XAccount = {
  consumerKey?: SecretValue;
  consumerKeyEnv?: string;
  consumerSecret?: SecretValue;
  consumerSecretEnv?: string;
  accessToken?: SecretValue;
  accessTokenEnv?: string;
  accessTokenSecret?: SecretValue;
  accessTokenSecretEnv?: string;
  oauth2AccessToken?: SecretValue;
  oauth2AccessTokenEnv?: string;
};

export type LinkedInAccount = {
  accessToken?: SecretValue;
  accessTokenEnv?: string;
  author: string;
  version?: string;
};

export type RedditAccount = {
  clientId?: SecretValue;
  clientIdEnv?: string;
  clientSecret?: SecretValue;
  clientSecretEnv?: string;
  refreshToken?: SecretValue;
  refreshTokenEnv?: string;
  username?: SecretValue;
  usernameEnv?: string;
  password?: SecretValue;
  passwordEnv?: string;
  userAgent?: string;
  subreddit?: string;
};

export type TelegramAccount = {
  botToken?: SecretValue;
  botTokenEnv?: string;
  chatId?: string;
};

export type AegeaAccount = {
  baseUrl?: string;
  password?: SecretValue;
  passwordEnv?: string;
};

export type BlueskyAccount = {
  identifier?: string;
  identifierEnv?: string;
  appPassword?: SecretValue;
  appPasswordEnv?: string;
  pdsUrl?: string;
};

export type MastodonAccount = {
  instanceUrl?: string;
  accessToken?: SecretValue;
  accessTokenEnv?: string;
  visibility?: "public" | "unlisted" | "private" | "direct";
};

export type DiscordAccount = {
  webhookUrl?: SecretValue;
  webhookUrlEnv?: string;
  threadId?: string;
  username?: string;
  avatarUrl?: string;
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

export type UspConfig = {
  llm?: LlmConfig;
  accounts?: AccountsConfig;
  browserAuth?: BrowserAuthConfig;
  targets?: Record<string, TargetConfig>;
  profiles?: Record<string, ProfileConfig>;
  prompts?: Partial<Record<Platform, string>>;
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
