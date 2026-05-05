import { optionalSecret, resolveSecret } from "../util/secrets.js";
import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";

async function getAccessToken(context: PublishContext) {
  const account = context.config.accounts?.reddit?.[context.target.account];
  if (!account) {
    throw new Error(`Missing Reddit account "${context.target.account}".`);
  }

  const clientId = resolveSecret(account.clientId, account.clientIdEnv, "Reddit client id", "REDDIT_CLIENT_ID");
  const clientSecret = resolveSecret(
    account.clientSecret,
    account.clientSecretEnv,
    "Reddit client secret",
    "REDDIT_CLIENT_SECRET"
  );
  const refreshToken = optionalSecret(account.refreshToken, account.refreshTokenEnv, "REDDIT_REFRESH_TOKEN");
  const userAgent = account.userAgent ?? process.env.REDDIT_USER_AGENT ?? "usp/0.1.0";
  const body = new URLSearchParams();

  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
  } else {
    body.set("grant_type", "password");
    body.set("username", resolveSecret(account.username, account.usernameEnv, "Reddit username", "REDDIT_USERNAME"));
    body.set("password", resolveSecret(account.password, account.passwordEnv, "Reddit password", "REDDIT_PASSWORD"));
  }

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body,
  });
  const data = (await response.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!response.ok || !data?.access_token) {
    throw new Error(`Reddit OAuth failed (${response.status}): ${data?.error ?? JSON.stringify(data)}`);
  }
  return { accessToken: data.access_token, userAgent };
}

export async function publishToReddit(context: PublishContext) {
  const warnings: string[] = [];
  const subreddit = context.target.subreddit;
  if (!subreddit) {
    throw new Error(`Reddit target "${context.targetId}" needs a subreddit.`);
  }

  const title = (context.plan.title || context.plan.units[0]?.text.split("\n")[0] || "Post").slice(0, 300);
  const textParts = context.plan.units.map((unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    const mediaMarkdown = media.map((item) => {
      if (item.isRemote) {
        return `![${item.alt}](${item.rawPath})`;
      }
      warnings.push(
        `Reddit public OAuth submit does not support stable native local image uploads; referenced ${item.rawPath} in the post body.`
      );
      return item.alt ? `[${item.alt}](${item.rawPath})` : item.rawPath;
    });
    return [unit.text, ...mediaMarkdown].filter(Boolean).join("\n\n");
  });
  const text = textParts.join("\n\n---\n\n");

  if (context.dryRun) {
    return dryRunResult(context, warnings);
  }

  const { accessToken, userAgent } = await getAccessToken(context);
  const body = new URLSearchParams({
    api_type: "json",
    kind: "self",
    sr: subreddit,
    title,
    text,
    sendreplies: "true",
  });

  const response = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body,
  });
  const data = (await response.json().catch(() => null)) as {
    json?: { data?: { id?: string; url?: string }; errors?: unknown[] };
  } | null;
  if (!response.ok || (data?.json?.errors && data.json.errors.length > 0)) {
    throw new Error(`Reddit submit failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return {
    target: context.targetId,
    platform: "reddit" as const,
    account: context.target.account,
    dryRun: false,
    posts: [
      {
        id: data?.json?.data?.id,
        url: data?.json?.data?.url,
        text,
      },
    ],
    warnings,
  };
}
