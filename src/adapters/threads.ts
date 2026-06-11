import type { SourceMedia, ThreadsAccount } from "../types.js";
import { pollUntil } from "../util/async.js";
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
import { uploadTempMedia } from "./temp-host.js";

const API_BASE = "https://graph.threads.net/v1.0";
const CONTAINER_POLL_ATTEMPTS = 20;
const CONTAINER_POLL_DELAY_MS = 2_000;
// A just-published parent post isn't immediately referenceable, so a reply that points
// at it can 400 with "does not exist". Wait until it's retrievable, then retry as a guard.
const PARENT_POLL_ATTEMPTS = 20;
const PARENT_POLL_DELAY_MS = 3_000;
const REPLY_RETRY_ATTEMPTS = 8;
const REPLY_RETRY_DELAY_MS = 3_000;

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
  const ready = await pollUntil({
    attempts: CONTAINER_POLL_ATTEMPTS,
    delayMs: CONTAINER_POLL_DELAY_MS,
    async poll() {
      const params = new URLSearchParams({ fields: "status,error_message", access_token: accessToken });
      const response = await fetchWithTimeout(`${API_BASE}/${encodeURIComponent(containerId)}?${params.toString()}`);
      const { ok, status, data, text } = await readJsonResponse<ThreadsStatusResponse>(response);
      if (!ok) {
        throw new Error(`Threads container status check failed (${status}): ${text}`);
      }
      return data;
    },
    isDone(data) {
      return data?.status === "FINISHED";
    },
    onPending(data) {
      if (data?.status === "ERROR" || data?.status === "EXPIRED") {
        throw new Error(`Threads media processing failed: ${data.error_message ?? data.status}`);
      }
    },
  });
  if (ready?.status === "FINISHED") {
    return;
  }
  throw new Error(`Threads container ${containerId} did not finish processing in time.`);
}

/** Fetch the public permalink for a published post (threads_publish only returns the id). */
async function getPostPermalink(accessToken: string, postId: string): Promise<string | undefined> {
  const params = new URLSearchParams({ fields: "permalink", access_token: accessToken });
  const response = await fetchWithTimeout(`${API_BASE}/${encodeURIComponent(postId)}?${params.toString()}`);
  const { ok, data } = await readJsonResponse<{ permalink?: string }>(response);
  return ok ? data?.permalink ?? undefined : undefined;
}

/** Poll until a just-published post is retrievable, so it can be referenced as a reply parent. */
async function waitForPostAvailable(accessToken: string, postId: string) {
  await pollUntil({
    attempts: PARENT_POLL_ATTEMPTS,
    delayMs: PARENT_POLL_DELAY_MS,
    async poll() {
      const params = new URLSearchParams({ fields: "id", access_token: accessToken });
      const response = await fetchWithTimeout(`${API_BASE}/${encodeURIComponent(postId)}?${params.toString()}`);
      return response.ok;
    },
    isDone: (ok) => ok,
  });
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

  let data: ThreadsContainerResponse;
  try {
    data = await postThreads<ThreadsContainerResponse>(`/${encodeURIComponent(userId)}/threads`, params);
  } catch (error) {
    // "does not exist" doesn't say which resource — name what we sent so it's diagnosable.
    const sent = [replyToId ? `reply_to_id=${replyToId}` : null, media[0] ? `image_url=${media[0].rawPath}` : null]
      .filter(Boolean)
      .join(", ");
    throw new Error(`${error instanceof Error ? error.message : String(error)}${sent ? ` (sent ${sent})` : ""}`);
  }
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
  return { id: data.id, permalink: data.permalink };
}

/** Retry a reply-container creation while the just-published parent post settles. */
async function retryWhileParentSettles(create: () => Promise<string>): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await create();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= REPLY_RETRY_ATTEMPTS || !/does not exist/i.test(message)) {
        throw error;
      }
      await sleep(REPLY_RETRY_DELAY_MS);
    }
  }
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
  const warnings: string[] = [];

  const posts = await publishThread(context.plan.units, async (unit) => {
    const referenced = getReferencedMedia(context.media, unit.mediaRefs);
    // Threads only accepts public image/video URLs. With uploadLocalMedia, host local
    // files temporarily and use the URL; otherwise skip them with a warning.
    const media: SourceMedia[] = [];
    for (const item of referenced) {
      if (item.isRemote) {
        media.push(item);
      } else if (context.config.uploadLocalMedia) {
        const url = await uploadTempMedia(item);
        media.push({ ...item, rawPath: url, resolvedPath: url, isRemote: true });
      } else {
        warnings.push(
          "Skipped local image(s) on Threads — enable 'Media hosting' in `usp setup`, or use a public https URL."
        );
      }
    }
    // A reply references the previous post; wait until that post is actually retrievable.
    if (replyToId) {
      await waitForPostAvailable(accessToken, replyToId);
    }
    const makeContainer = () =>
      createContainer({
        userId,
        accessToken,
        text: unit.text,
        media,
        replyToId,
        replyControl: account.replyControl,
      });
    // Final guard in case it's still settling right after becoming retrievable.
    const containerId = replyToId ? await retryWhileParentSettles(makeContainer) : await makeContainer();
    // The container's status reaching FINISHED is the reliable "ready to publish" signal —
    // always wait for it (text and media, root and reply) before publishing.
    await waitForContainer(userId, accessToken, containerId);
    const published = await publishContainer(userId, accessToken, containerId);
    replyToId = published.id;
    const permalink = published.permalink ?? (await getPostPermalink(accessToken, published.id));
    return { id: published.id, url: permalink, text: unit.text };
  });

  return publishResult(context, posts, warnings);
}
