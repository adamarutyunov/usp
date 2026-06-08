import path from "node:path";

import type { SourceMedia } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../util/http.js";
import { resolveSecret } from "../util/secrets.js";
import {
  dryRunResult,
  getReferencedMedia,
  publishResult,
  publishThread,
  requireAccount,
  requireMediaData,
  type PublishContext,
} from "./common.js";

type BlueskySession = {
  accessJwt?: string;
  did?: string;
  handle?: string;
};

type BlueskyBlobResponse = {
  blob?: unknown;
};

type BlueskyRecordResponse = {
  uri?: string;
  cid?: string;
};

type BlueskyPostRef = {
  uri: string;
  cid: string;
};

function normalizePdsUrl(value: string | undefined) {
  return (value ?? "https://bsky.social").replace(/\/+$/, "");
}

function postUrl(handleOrDid: string, uri: string | undefined) {
  const rkey = uri?.split("/").pop();
  return rkey ? `https://bsky.app/profile/${encodeURIComponent(handleOrDid)}/post/${encodeURIComponent(rkey)}` : undefined;
}

async function callBluesky<T>({
  pdsUrl,
  method,
  body,
  accessJwt,
  contentType = "application/json",
}: {
  pdsUrl: string;
  method: string;
  body: BodyInit | Record<string, unknown>;
  accessJwt?: string;
  contentType?: string;
}) {
  const headers: Record<string, string> = {
    "content-type": contentType,
  };
  if (accessJwt) {
    headers.authorization = `Bearer ${accessJwt}`;
  }

  const response = await fetchWithTimeout(`${pdsUrl}/xrpc/${method}`, {
    method: "POST",
    headers,
    body: contentType === "application/json" ? JSON.stringify(body) : (body as BodyInit),
  });
  const { ok, status, data, text } = await readJsonResponse<T>(response);
  if (!ok) {
    throw new Error(`Bluesky ${method} failed (${status}): ${text}`);
  }
  return data ?? ({} as T);
}

async function createSession(pdsUrl: string, identifier: string, password: string) {
  const session = await callBluesky<BlueskySession>({
    pdsUrl,
    method: "com.atproto.server.createSession",
    body: { identifier, password },
  });
  if (!session.accessJwt || !session.did) {
    throw new Error(`Bluesky session response did not include accessJwt or did.`);
  }
  return session as Required<Pick<BlueskySession, "accessJwt" | "did">> & Pick<BlueskySession, "handle">;
}

async function uploadBlob({
  pdsUrl,
  accessJwt,
  item,
}: {
  pdsUrl: string;
  accessJwt: string;
  item: SourceMedia;
}) {
  const data = requireMediaData(item, "bluesky");
  const result = await callBluesky<BlueskyBlobResponse>({
    pdsUrl,
    method: "com.atproto.repo.uploadBlob",
    accessJwt,
    contentType: item.mime ?? "application/octet-stream",
    body: new Uint8Array(data),
  });
  if (!result.blob) {
    throw new Error(`Bluesky uploadBlob response did not include blob for ${path.basename(item.resolvedPath)}.`);
  }
  return result.blob;
}

function makeRecord({
  text,
  blobs,
  reply,
}: {
  text: string;
  blobs: Array<{ alt: string; blob: unknown }>;
  reply?: { root: BlueskyPostRef; parent: BlueskyPostRef };
}) {
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  };
  if (blobs.length > 0) {
    record.embed = {
      $type: "app.bsky.embed.images",
      images: blobs.map((item) => ({
        alt: item.alt,
        image: item.blob,
      })),
    };
  }
  if (reply) {
    record.reply = reply;
  }
  return record;
}

export async function publishToBluesky(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = requireAccount(
    context.config.accounts?.bluesky?.[context.target.account],
    "bluesky",
    context.target.account
  );

  const pdsUrl = normalizePdsUrl(account.pdsUrl);
  const identifier = resolveSecret(account.identifier, "Bluesky identifier");
  const appPassword = resolveSecret(account.appPassword, "Bluesky app password");
  const session = await createSession(pdsUrl, identifier, appPassword);
  const handleOrDid = (session.handle || identifier).replace(/^@/, "");
  let root: BlueskyPostRef | undefined;
  let parent: BlueskyPostRef | undefined;

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    if (media.length > 4) {
      throw new Error(`Bluesky supports up to 4 images per post; target "${context.targetId}" has ${media.length}.`);
    }

    const blobs = await Promise.all(
      media.map(async (item) => ({
        alt: item.alt,
        blob: await uploadBlob({ pdsUrl, accessJwt: session.accessJwt, item }),
      }))
    );

    const response = await callBluesky<BlueskyRecordResponse>({
      pdsUrl,
      method: "com.atproto.repo.createRecord",
      accessJwt: session.accessJwt,
      body: {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: makeRecord({
          text: unit.text,
          blobs,
          reply: root && parent ? { root, parent } : undefined,
        }),
      },
    });
    if (!response.uri || !response.cid) {
      throw new Error(`Bluesky createRecord response did not include uri or cid.`);
    }

    const ref = { uri: response.uri, cid: response.cid };
    root ??= ref;
    parent = ref;
    return { id: response.uri, url: postUrl(handleOrDid, response.uri), text: unit.text };
  });

  return publishResult(context, posts);
}
