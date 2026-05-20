import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";
import type { SourceMedia, ThreadsAccount } from "../types.js";
import { resolveSecret } from "../util/secrets.js";

const API_BASE = "https://graph.threads.net/v1.0";

type ThreadsContainerResponse = {
  id?: string;
  error?: { message?: string };
};

type ThreadsPublishResponse = {
  id?: string;
  permalink?: string;
  error?: { message?: string };
};

function getAccount(context: PublishContext): ThreadsAccount {
  const account = context.config.accounts?.threads?.[context.target.account];
  if (!account) {
    throw new Error(`Missing Threads account "${context.target.account}".`);
  }
  return account;
}

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

async function callThreads<T>(path: string, params: URLSearchParams): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || data?.error) {
    throw new Error(`Threads API failed (${response.status}): ${data?.error?.message ?? JSON.stringify(data)}`);
  }
  return data as T;
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

  const data = await callThreads<ThreadsContainerResponse>(`/${encodeURIComponent(userId)}/threads`, params);
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
  const data = await callThreads<ThreadsPublishResponse>(`/${encodeURIComponent(userId)}/threads_publish`, params);
  if (!data.id) {
    throw new Error(`Threads did not return a post id: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function publishToThreads(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = getAccount(context);
  const accessToken = resolveSecret(account.accessToken, "Threads access token");
  const userId = account.userId || "me";
  const posts = [];
  let replyToId: string | undefined;

  for (const unit of context.plan.units) {
    const containerId = await createContainer({
      userId,
      accessToken,
      text: unit.text,
      media: getReferencedMedia(context.media, unit.mediaRefs),
      replyToId,
      replyControl: account.replyControl,
    });
    const published = await publishContainer(userId, accessToken, containerId);
    replyToId = published.id;
    posts.push({
      id: published.id,
      url: published.permalink,
      text: unit.text,
    });
  }

  return {
    target: context.targetId,
    platform: "threads" as const,
    account: context.target.account,
    dryRun: false,
    posts,
  };
}
