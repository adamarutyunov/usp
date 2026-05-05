export type Platform = "x" | "linkedin" | "reddit" | "telegram";

export type LlmProvider = "gemini" | "openai";

export type JsonObject = Record<string, unknown>;

export type SecretValue = string | undefined;

export type LlmConfig = {
  provider?: LlmProvider;
  model?: string;
  apiKey?: SecretValue;
  apiKeyEnv?: string;
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
};

export type TelegramAccount = {
  botToken?: SecretValue;
  botTokenEnv?: string;
};

export type AccountsConfig = {
  x?: Record<string, XAccount>;
  linkedin?: Record<string, LinkedInAccount>;
  reddit?: Record<string, RedditAccount>;
  telegram?: Record<string, TelegramAccount>;
};

export type TargetConfig = {
  platform: Platform;
  account: string;
  prompt?: string;
  subreddit?: string;
  chatId?: string;
  mode?: "api";
};

export type ProfileConfig = {
  targets: string[];
};

export type UspConfig = {
  llm?: LlmConfig;
  accounts?: AccountsConfig;
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
  posts: Array<{
    id?: string;
    url?: string;
    text?: string;
  }>;
  warnings?: string[];
};
