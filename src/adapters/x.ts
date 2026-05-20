import { TwitterApi } from "twitter-api-v2";
import type { XAccount } from "../types.js";
import { resolveSecret } from "../util/secrets.js";
import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";

function getAccount(context: PublishContext): XAccount {
  const account = context.config.accounts?.x?.[context.target.account];
  if (!account) {
    throw new Error(`Missing X account "${context.target.account}".`);
  }
  return account;
}

function createClient(account: XAccount) {
  return new TwitterApi({
    appKey: resolveSecret(account.consumerKey, "X consumer key"),
    appSecret: resolveSecret(account.consumerSecret, "X consumer secret"),
    accessToken: resolveSecret(account.accessToken, "X access token"),
    accessSecret: resolveSecret(account.accessTokenSecret, "X access token secret"),
  });
}

export async function publishToX(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = getAccount(context);
  const client = createClient(account);
  const posts = [];
  let previousTweetId: string | undefined;

  for (const unit of context.plan.units) {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    const mediaIds: string[] = [];
    for (const item of media) {
      const uploadable = item.data ?? item.resolvedPath;
      const mediaId = await client.v1.uploadMedia(uploadable, {
        mimeType: item.mime,
        target: "tweet",
      });
      if (item.alt) {
        await client.v1.createMediaMetadata(mediaId, {
          alt_text: { text: item.alt },
        });
      }
      mediaIds.push(mediaId);
    }

    const payload: Record<string, unknown> = { text: unit.text };
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds };
    }
    if (previousTweetId) {
      payload.reply = { in_reply_to_tweet_id: previousTweetId };
    }

    const response = await client.v2.tweet(payload as never);
    const id = response.data.id;
    previousTweetId = id;
    posts.push({
      id,
      url: `https://x.com/i/web/status/${id}`,
      text: unit.text,
    });
  }

  return {
    target: context.targetId,
    platform: "x" as const,
    account: context.target.account,
    dryRun: false,
    posts,
  };
}
