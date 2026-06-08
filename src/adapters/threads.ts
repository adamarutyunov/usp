import type { SourceMedia, ThreadsAccount } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../util/http.js";
import { resolveSecret } from "../util/secrets.js";
import {
  dryRunResult,
  getReferencedMedia,
  publishResult,
  publishThread,
  requireAccount,
  type PublishContext,
} from "./common.js";

const API_BASE = "https://graph.threads.net/v1.0";
const CONTAINER_POLL_ATTEMPTS = 20;
const CONTAINER_POLL_DELAY_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type ThreadsContainerResponse = {
  id?: string;
};

type ThreadsPublishResponse = {
  id?: string;
  permalink?: string;
};

type ThreadsStatusResponse = {
  status?: string;
  error_message?: string;
};

function mediaType(item: SourceMedia) {
  if (item.mime?.startsWith("video/")) {
    return "VIDEO";
  }
  if (item.mime?.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(item.rawPath)) {
    return "IMAGE";
  }
  throw new Error(`Threads only supports image and video media: ${item.rawPath}`);
}

function mediaUrlParam(type: string) {
  return type === "VIDEO" ? "video_url" : "image_url";
}

async function postThreads<T>(path: string, params: URLSearchParams): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const { ok, status, data, text } = await readJsonResponse<T & { error?: { message?: string } }>(response);
  if (!ok || data?.error) {
    throw new Error(`Threads API failed (${status}): ${data?.error?.message ?? text}`);
  }
  if (!data) {
    throw new Error(`Threads API returned an empty response (${status}).`);
  }
  return data;
}

/** Poll a media container until Meta finishes ingesting the remote media; publishing before this fails. */
async function waitForContainer(userId: string, accessToken: string, containerId: string) {
  for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
    const params = new URLSearchParams({ fields: "status,error_message", access_token: accessToken });
    const response = await fetchWithTimeout(`${API_BASE}/${encodeURIComponent(containerId)}?${params.toString()}`);
    const { ok, status, data, text } = await readJsonResponse<ThreadsStatusResponse>(response);
    if (!ok) {
      throw new Error(`Threads container status check failed (${status}): ${text}`);
    }
    if (data?.status === "FINISHED") {
      return;
    }
    if (data?.status === "ERROR" || data?.status === "EXPIRED") {
      throw new Error(`Threads media processing failed: ${data.error_message ?? data.status}`);
    }
    await sleep(CONTAINER_POLL_DELAY_MS);
  }
  throw new Error(`Threads container ${containerId} did not finish processing in time.`);
}

async function createContainer({
  userId,
  accessToken,
  text,
  media,
  replyToId,
  replyControl,
}: {
  userId: string;
  accessToken: string;
  text: string;
  media: SourceMedia[];
  replyToId?: string;
  replyControl?: ThreadsAccount["replyControl"];
}) {
  if (media.some((item) => !item.isRemote)) {
    throw new Error("Threads API requires media URLs that Meta can fetch publicly; local media is not supported yet.");
  }

  if (media.length > 1) {
    throw new Error("Threads carousel publishing is not implemented yet; attach at most one media item per post.");
  }

  const params = new URLSearchParams({
    access_token: accessToken,
    media_type: media.length === 0 ? "TEXT" : mediaType(media[0]!),
    text,
  });
  if (media[0]) {
    params.set(mediaUrlParam(params.get("media_type")!), media[0].rawPath);
  }
  if (replyToId) {
    params.set("reply_to_id", replyToId);
  }
  if (replyControl) {
    params.set("reply_control", replyControl);
  }

  const data = await postThreads<ThreadsContainerResponse>(`/${encodeURIComponent(userId)}/threads`, params);
  if (!data.id) {
    throw new Error(`Threads did not return a container id: ${JSON.stringify(data)}`);
  }
  return data.id;
}

async function publishContainer(userId: string, accessToken: string, creationId: string) {
  const params = new URLSearchParams({
    access_token: accessToken,
    creation_id: creationId,
  });
  const data = await postThreads<ThreadsPublishResponse>(`/${encodeURIComponent(userId)}/threads_publish`, params);
  if (!data.id) {
    throw new Error(`Threads did not return a post id: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function publishToThreads(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = requireAccount(
    context.config.accounts?.threads?.[context.target.account],
    "threads",
    context.target.account
  );
  const accessToken = resolveSecret(account.accessToken, "Threads access token");
  const userId = account.userId || "me";
  let replyToId: string | undefined;

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    const containerId = await createContainer({
      userId,
      accessToken,
      text: unit.text,
      media,
      replyToId,
      replyControl: account.replyControl,
    });
    // Media containers need a moment for Meta to ingest the remote asset before publishing.
    if (media.length > 0) {
      await waitForContainer(userId, accessToken, containerId);
    }
    const published = await publishContainer(userId, accessToken, containerId);
    replyToId = published.id;
    return { id: published.id, url: published.permalink, text: unit.text };
  });

  return publishResult(context, posts);
}
