import { TwitterApi } from "twitter-api-v2";
import type { XAccount } from "../types.js";
import { optionalSecret, resolveSecret } from "../util/secrets.js";
import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";

function getAccount(context: PublishContext): XAccount {
  const account = context.config.accounts?.x?.[context.target.account];
  if (!account) {
    throw new Error(`Missing X account "${context.target.account}".`);
  }
  return account;
}

function createClient(account: XAccount) {
  const consumerKey = optionalSecret(account.consumerKey, account.consumerKeyEnv, "X_CONSUMER_KEY");
  const consumerSecret = optionalSecret(account.consumerSecret, account.consumerSecretEnv, "X_CONSUMER_SECRET");
  const accessToken = optionalSecret(account.accessToken, account.accessTokenEnv, "X_ACCESS_TOKEN");
  const accessTokenSecret = optionalSecret(
    account.accessTokenSecret,
    account.accessTokenSecretEnv,
    "X_ACCESS_TOKEN_SECRET"
  );
  const oauth2AccessToken = optionalSecret(
    account.oauth2AccessToken,
    account.oauth2AccessTokenEnv,
    "X_OAUTH2_ACCESS_TOKEN"
  );

  if (consumerKey && consumerSecret && accessToken && accessTokenSecret) {
    return {
      client: new TwitterApi({
        appKey: consumerKey,
        appSecret: consumerSecret,
        accessToken,
        accessSecret: accessTokenSecret,
      }),
      canUploadMedia: true,
    };
  }

  if (oauth2AccessToken) {
    return {
      client: new TwitterApi(oauth2AccessToken),
      canUploadMedia: false,
    };
  }

  throw new Error(
    "X posting requires OAuth 1.0a credentials, or X_OAUTH2_ACCESS_TOKEN for text-only posting."
  );
}

export async function publishToX(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = getAccount(context);
  const { client, canUploadMedia } = createClient(account);
  const posts = [];
  let previousTweetId: string | undefined;

  for (const unit of context.plan.units) {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    if (media.length > 0 && !canUploadMedia) {
      throw new Error("X media uploads require OAuth 1.0a credentials.");
    }

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
