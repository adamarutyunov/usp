import path from "node:path";

import { resolveSecret } from "../util/secrets.js";
import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";

type MastodonMedia = {
  id?: string;
  url?: string | null;
};

type MastodonStatus = {
  id?: string;
  url?: string;
  uri?: string;
};

function normalizeInstanceUrl(value: string | undefined) {
  const url = value ?? process.env.MASTODON_INSTANCE_URL;
  if (!url) {
    throw new Error(`Missing Mastodon instanceUrl. Provide it in config or MASTODON_INSTANCE_URL.`);
  }
  return url.replace(/\/+$/, "");
}

async function readJson<T>(response: Response) {
  const text = await response.text();
  return {
    text,
    data: text ? (JSON.parse(text) as T) : ({} as T),
  };
}

async function uploadMedia({
  instanceUrl,
  accessToken,
  item,
}: {
  instanceUrl: string;
  accessToken: string;
  item: { data?: Buffer; mime?: string; resolvedPath: string; alt: string };
}) {
  if (!item.data) {
    throw new Error(`Mastodon adapter requires loaded local image data: ${item.resolvedPath}`);
  }

  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(item.data)], { type: item.mime ?? "application/octet-stream" }),
    path.basename(item.resolvedPath)
  );
  if (item.alt) {
    form.set("description", item.alt);
  }

  const response = await fetch(`${instanceUrl}/api/v2/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const { text, data } = await readJson<MastodonMedia>(response);
  if (!response.ok || !data.id) {
    throw new Error(`Mastodon media upload failed (${response.status}): ${text}`);
  }

  if (data.url || response.status !== 202) {
    return data.id;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const poll = await fetch(`${instanceUrl}/api/v1/media/${encodeURIComponent(data.id)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const polled = await readJson<MastodonMedia>(poll);
    if (!poll.ok) {
      throw new Error(`Mastodon media processing check failed (${poll.status}): ${polled.text}`);
    }
    if (polled.data.url) {
      return data.id;
    }
  }

  return data.id;
}

async function publishStatus({
  instanceUrl,
  accessToken,
  status,
  mediaIds,
  visibility,
  inReplyToId,
}: {
  instanceUrl: string;
  accessToken: string;
  status: string;
  mediaIds: string[];
  visibility: string;
  inReplyToId?: string;
}) {
  const body = new URLSearchParams();
  body.set("status", status);
  body.set("visibility", visibility);
  for (const mediaId of mediaIds) {
    body.append("media_ids[]", mediaId);
  }
  if (inReplyToId) {
    body.set("in_reply_to_id", inReplyToId);
  }

  const response = await fetch(`${instanceUrl}/api/v1/statuses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const { text, data } = await readJson<MastodonStatus>(response);
  if (!response.ok || !data.id) {
    throw new Error(`Mastodon status post failed (${response.status}): ${text}`);
  }
  return data;
}

export async function publishToMastodon(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = context.config.accounts?.mastodon?.[context.target.account];
  if (!account) {
    throw new Error(`Missing Mastodon account "${context.target.account}".`);
  }

  const instanceUrl = normalizeInstanceUrl(account.instanceUrl);
  const accessToken = resolveSecret(
    account.accessToken,
    account.accessTokenEnv,
    "Mastodon access token",
    "MASTODON_ACCESS_TOKEN"
  );
  const visibility = account.visibility ?? "public";
  const posts = [];
  let previousStatusId: string | undefined;

  for (const unit of context.plan.units) {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    if (media.length > 4) {
      throw new Error(`Mastodon supports up to 4 media attachments per status; target "${context.targetId}" has ${media.length}.`);
    }

    const mediaIds = [];
    for (const item of media) {
      mediaIds.push(await uploadMedia({ instanceUrl, accessToken, item }));
    }

    const status = await publishStatus({
      instanceUrl,
      accessToken,
      status: unit.text,
      mediaIds,
      visibility,
      inReplyToId: previousStatusId,
    });
    previousStatusId = status.id;
    posts.push({
      id: status.id,
      url: status.url ?? status.uri,
      text: unit.text,
    });
  }

  return {
    target: context.targetId,
    platform: "mastodon" as const,
    account: context.target.account,
    dryRun: false,
    posts,
  };
}
