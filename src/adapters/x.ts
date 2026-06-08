import { TwitterApi, type SendTweetV2Params } from "twitter-api-v2";
import type { XAccount } from "../types.js";
import { resolveSecret } from "../util/secrets.js";
import {
  dryRunResult,
  getReferencedMedia,
  publishResult,
  publishThread,
  requireAccount,
  type PublishContext,
} from "./common.js";

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

  const account = requireAccount(context.config.accounts?.x?.[context.target.account], "x", context.target.account);
  const client = createClient(account);
  let previousTweetId: string | undefined;

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    // Upload independent media concurrently; Promise.all preserves order for media_ids.
    const mediaIds = await Promise.all(
      media.map(async (item) => {
        const mediaId = await client.v1.uploadMedia(item.data ?? item.resolvedPath, {
          mimeType: item.mime,
          target: "tweet",
        });
        if (item.alt) {
          await client.v1.createMediaMetadata(mediaId, { alt_text: { text: item.alt } });
        }
        return mediaId;
      })
    );

    const payload: SendTweetV2Params = { text: unit.text };
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds as NonNullable<SendTweetV2Params["media"]>["media_ids"] };
    }
    if (previousTweetId) {
      payload.reply = { in_reply_to_tweet_id: previousTweetId };
    }

    const response = await client.v2.tweet(payload);
    const id = response.data.id;
    previousTweetId = id;
    return { id, url: `https://x.com/i/web/status/${id}`, text: unit.text };
  });

  return publishResult(context, posts);
}
