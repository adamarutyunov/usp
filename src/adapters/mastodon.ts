import path from "node:path";

import type { SourceMedia } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../util/http.js";
import { resolveSecret } from "../util/secrets.js";
import {
  dryRunResult,
  getReferencedMedia,
  mediaBlob,
  publishResult,
  publishThread,
  requireAccount,
  type PublishContext,
} from "./common.js";

type MastodonMedia = {
  id?: string;
  url?: string | null;
};

type MastodonStatus = {
  id?: string;
  url?: string;
  uri?: string;
};

const MEDIA_POLL_ATTEMPTS = 15;
const MEDIA_POLL_MAX_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function normalizeInstanceUrl(value: string | undefined) {
  if (!value) {
    throw new Error("Missing Mastodon instanceUrl. Provide it in config.");
  }
  return value.replace(/\/+$/, "");
}

async function uploadMedia({
  instanceUrl,
  accessToken,
  item,
}: {
  instanceUrl: string;
  accessToken: string;
  item: SourceMedia;
}): Promise<string> {
  const form = new FormData();
  form.set("file", mediaBlob(item, "mastodon"), path.basename(item.resolvedPath));
  if (item.alt) {
    form.set("description", item.alt);
  }

  const response = await fetchWithTimeout(`${instanceUrl}/api/v2/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const { ok, status, data, text } = await readJsonResponse<MastodonMedia>(response);
  if (!ok || !data?.id) {
    throw new Error(`Mastodon media upload failed (${status}): ${text}`);
  }

  // A populated `url` means processing is complete. Otherwise the attachment is
  // still being processed (Mastodon returns 202, or 200 with a null url) and
  // attaching it to a status would be rejected — poll until it is ready.
  if (data.url) {
    return data.id;
  }

  const mediaId = data.id;
  for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt += 1) {
    await sleep(Math.min(1000 * 2 ** attempt, MEDIA_POLL_MAX_DELAY_MS));
    const poll = await fetchWithTimeout(`${instanceUrl}/api/v1/media/${encodeURIComponent(mediaId)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const polled = await readJsonResponse<MastodonMedia>(poll);
    if (!poll.ok) {
      throw new Error(`Mastodon media processing check failed (${poll.status}): ${polled.text}`);
    }
    if (polled.data?.url) {
      return mediaId;
    }
  }

  throw new Error(`Mastodon media ${mediaId} did not finish processing in time.`);
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

  const response = await fetchWithTimeout(`${instanceUrl}/api/v1/statuses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const { ok, status: httpStatus, data, text } = await readJsonResponse<MastodonStatus>(response);
  if (!ok || !data?.id) {
    throw new Error(`Mastodon status post failed (${httpStatus}): ${text}`);
  }
  return data;
}

export async function publishToMastodon(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = requireAccount(
    context.config.accounts?.mastodon?.[context.target.account],
    "mastodon",
    context.target.account
  );

  const instanceUrl = normalizeInstanceUrl(account.instanceUrl);
  const accessToken = resolveSecret(account.accessToken, "Mastodon access token");
  const visibility = account.visibility ?? "public";
  let previousStatusId: string | undefined;

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    if (media.length > 4) {
      throw new Error(`Mastodon supports up to 4 media attachments per status; target "${context.targetId}" has ${media.length}.`);
    }

    const mediaIds = await Promise.all(media.map((item) => uploadMedia({ instanceUrl, accessToken, item })));

    const status = await publishStatus({
      instanceUrl,
      accessToken,
      status: unit.text,
      mediaIds,
      visibility,
      inReplyToId: previousStatusId,
    });
    previousStatusId = status.id;
    return { id: status.id, url: status.url ?? status.uri, text: unit.text };
  });

  return publishResult(context, posts);
}
