import { fetchWithTimeout, readJsonResponse } from "../util/http.js";
import { optionalSecret, resolveSecret } from "../util/secrets.js";
import {
  dryRunResult,
  getReferencedMedia,
  publishResult,
  requireAccount,
  type PublishContext,
} from "./common.js";

async function getAccessToken(context: PublishContext) {
  const account = requireAccount(
    context.config.accounts?.reddit?.[context.target.account],
    "reddit",
    context.target.account
  );

  const clientId = resolveSecret(account.clientId, "Reddit client id");
  const clientSecret = resolveSecret(account.clientSecret, "Reddit client secret");
  const refreshToken = optionalSecret(account.refreshToken);
  const userAgent = account.userAgent ?? "usp/0.1.0";
  const body = new URLSearchParams();

  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
  } else {
    body.set("grant_type", "password");
    body.set("username", resolveSecret(account.username, "Reddit username"));
    body.set("password", resolveSecret(account.password, "Reddit password"));
  }

  const response = await fetchWithTimeout("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body,
  });
  const { ok, status, data, text } = await readJsonResponse<{ access_token?: string; error?: string }>(response);
  if (!ok || !data?.access_token) {
    throw new Error(`Reddit OAuth failed (${status}): ${data?.error ?? text}`);
  }
  return { accessToken: data.access_token, userAgent };
}

/** Escape Markdown link-breaking characters in alt text. */
function escapeLinkText(value: string) {
  return value.replace(/[[\]]/g, "\\$&");
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
      const alt = escapeLinkText(item.alt);
      if (item.isRemote) {
        return `![${alt}](${item.rawPath})`;
      }
      warnings.push(
        `Reddit public OAuth submit does not support stable native local image uploads; referenced ${item.rawPath} in the post body.`
      );
      return alt ? `[${alt}](${item.rawPath})` : item.rawPath;
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

  const response = await fetchWithTimeout("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body,
  });
  const { ok, status, data } = await readJsonResponse<{
    json?: { data?: { id?: string; url?: string }; errors?: unknown[] };
  }>(response);
  if (!ok || (data?.json?.errors && data.json.errors.length > 0)) {
    throw new Error(`Reddit submit failed (${status}): ${JSON.stringify(data)}`);
  }

  return publishResult(
    context,
    [{ id: data?.json?.data?.id, url: data?.json?.data?.url, text }],
    warnings
  );
}
