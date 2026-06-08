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

type DiscordMessage = {
  id?: string;
  channel_id?: string;
  guild_id?: string;
};

function discordMessageUrl(message: DiscordMessage) {
  if (!message.id || !message.channel_id) {
    return undefined;
  }
  return `https://discord.com/channels/${message.guild_id ?? "@me"}/${message.channel_id}/${message.id}`;
}

function mediaFilename(item: { rawPath: string; resolvedPath: string }) {
  if (/^https?:\/\//i.test(item.resolvedPath)) {
    const pathname = new URL(item.resolvedPath).pathname;
    return path.basename(pathname) || "attachment";
  }
  return path.basename(item.resolvedPath || item.rawPath) || "attachment";
}

function webhookEndpoint(webhookUrl: string, threadId: string | undefined) {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  if (threadId) {
    url.searchParams.set("thread_id", threadId);
  }
  return url.toString();
}

async function sendWebhook({
  webhookUrl,
  content,
  media,
  threadId,
  username,
  avatarUrl,
}: {
  webhookUrl: string;
  content: string;
  media: SourceMedia[];
  threadId?: string;
  username?: string;
  avatarUrl?: string;
}) {
  const payload: Record<string, unknown> = {
    content,
    allowed_mentions: { parse: [] },
  };
  if (username) {
    payload.username = username;
  }
  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }

  let body: BodyInit;
  let headers: HeadersInit | undefined;

  if (media.length === 0) {
    headers = { "content-type": "application/json" };
    body = JSON.stringify(payload);
  } else {
    const form = new FormData();
    payload.attachments = media.map((item, index) => ({
      id: index,
      filename: mediaFilename(item),
      description: item.alt || undefined,
    }));
    form.set("payload_json", JSON.stringify(payload));

    for (const [index, item] of media.entries()) {
      form.set(`files[${index}]`, mediaBlob(item, "discord"), mediaFilename(item));
    }
    body = form;
  }

  const response = await fetchWithTimeout(webhookEndpoint(webhookUrl, threadId), {
    method: "POST",
    headers,
    body,
  });
  const { ok, status, data, text } = await readJsonResponse<DiscordMessage>(response);
  if (!ok) {
    throw new Error(`Discord webhook failed (${status}): ${text}`);
  }
  return data ?? {};
}

export async function publishToDiscord(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const account = requireAccount(
    context.config.accounts?.discord?.[context.target.account],
    "discord",
    context.target.account
  );

  const webhookUrl = resolveSecret(account.webhookUrl, "Discord webhook URL");
  const threadId = context.target.threadId;

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);
    if (media.length > 10) {
      throw new Error(`Discord supports up to 10 files per message; target "${context.targetId}" has ${media.length}.`);
    }

    const message = await sendWebhook({
      webhookUrl,
      content: unit.text,
      media,
      threadId,
      username: account.username,
      avatarUrl: account.avatarUrl,
    });
    return { id: message.id, url: discordMessageUrl(message), text: unit.text };
  });

  return publishResult(context, posts);
}
