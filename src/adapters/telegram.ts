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
  type PublishPost,
} from "./common.js";

type TelegramResult = { ok?: boolean; result?: { message_id?: number }; description?: string };

// Telegram's legacy Markdown dialect: *bold*, _italic_, `code`, [text](url). The platform
// prompt steers the model to emit this. As-is content (raw CommonMark) won't match and will
// trip the parser — that's fine, the fallback below resends it as plain text.
const PARSE_MODE = "Markdown";

// Legacy Markdown has no escape mechanism, so a stray/unbalanced *, _, ` or [ makes Telegram
// reject the whole message with a 400 "can't parse entities". When that happens, resend the
// exact same text without parse_mode so the post still goes out (just unformatted).
function isParseEntitiesError(error: unknown) {
  return error instanceof Error && /can't parse entities|can't find end|parse entities/i.test(error.message);
}

// Bot API photo/media-group captions are capped at 1024 chars — Premium does NOT raise this
// for bots (it's a client-only perk). Longer text is sent as a separate message instead.
const CAPTION_LIMIT = 1024;

async function sendWithMarkdownFallback(
  send: (useParseMode: boolean) => Promise<TelegramResult>
): Promise<TelegramResult> {
  try {
    return await send(true);
  } catch (error) {
    if (!isParseEntitiesError(error)) {
      throw error;
    }
    return send(false);
  }
}

function getBotToken(context: PublishContext) {
  const account = requireAccount(
    context.config.accounts?.telegram?.[context.target.account],
    "telegram",
    context.target.account
  );
  return resolveSecret(account.botToken, "Telegram bot token");
}

async function callTelegram(botToken: string, method: string, body: FormData | Record<string, unknown>) {
  const isFormData = body instanceof FormData;
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: isFormData ? undefined : { "content-type": "application/json" },
    body: isFormData ? body : JSON.stringify(body),
  });
  const { ok, status, data } = await readJsonResponse<TelegramResult>(response);
  if (!ok || !data?.ok) {
    throw new Error(`Telegram ${method} failed (${status}): ${data?.description ?? JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Build a public message link when possible: `@handle` channels map to
 * t.me/<handle>/<id>, and numeric `-100…` channels/supergroups to t.me/c/<id>/<msg>.
 * Basic groups and private chats have no public link.
 */
function telegramPostUrl(chatId: string, messageId: number | undefined): string | undefined {
  if (messageId === undefined) {
    return undefined;
  }
  const trimmed = chatId.trim();
  const handle = trimmed.replace(/^@/, "");
  if (/^[a-zA-Z][\w]*$/.test(handle)) {
    return `https://t.me/${handle}/${messageId}`;
  }
  const channel = trimmed.match(/^-100(\d+)$/);
  if (channel) {
    return `https://t.me/c/${channel[1]}/${messageId}`;
  }
  return undefined;
}

function postFromResult(data: TelegramResult, text: string, chatId: string): PublishPost {
  const messageId = data.result?.message_id;
  return {
    id: messageId !== undefined ? String(messageId) : "",
    url: telegramPostUrl(chatId, messageId),
    text,
  };
}

function buildPhotoForm(chatId: string, item: SourceMedia, caption: string | undefined, useParseMode: boolean) {
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) {
    form.set("caption", caption);
    if (useParseMode) {
      form.set("parse_mode", PARSE_MODE);
    }
  }
  if (item.isRemote) {
    form.set("photo", item.rawPath);
  } else {
    form.append("photo", mediaBlob(item, "telegram"), path.basename(item.resolvedPath));
  }
  return form;
}

function buildMediaGroupForm(chatId: string, media: SourceMedia[], caption: string | undefined, useParseMode: boolean) {
  const form = new FormData();
  form.set("chat_id", chatId);
  const payload = media.map((item, index) => {
    const itemCaption = index === 0 ? caption : undefined;
    const parseMode = useParseMode && itemCaption ? { parse_mode: PARSE_MODE } : {};
    if (item.isRemote) {
      return { type: "photo", media: item.rawPath, caption: itemCaption, ...parseMode };
    }
    const field = `file${index}`;
    form.append(field, mediaBlob(item, "telegram"), path.basename(item.resolvedPath));
    return { type: "photo", media: `attach://${field}`, caption: itemCaption, ...parseMode };
  });
  form.set("media", JSON.stringify(payload));
  return form;
}

function sendTextMessage(botToken: string, chatId: string, text: string) {
  return sendWithMarkdownFallback((useParseMode) =>
    callTelegram(botToken, "sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
      ...(useParseMode ? { parse_mode: PARSE_MODE } : {}),
    })
  );
}

export async function publishToTelegram(context: PublishContext) {
  if (context.dryRun) {
    return dryRunResult(context);
  }

  const chatId = context.target.chatId;
  if (!chatId) {
    throw new Error(`Telegram target "${context.targetId}" needs a chatId.`);
  }
  const botToken = getBotToken(context);

  const posts = await publishThread(context.plan.units, async (unit) => {
    const media = getReferencedMedia(context.media, unit.mediaRefs);

    if (media.length === 0) {
      const data = await sendTextMessage(botToken, chatId, unit.text);
      return postFromResult(data, unit.text, chatId);
    }

    // A caption is limited to 1024 chars; when the text is longer, post the media
    // uncaptioned and send the full text as its own message so nothing is dropped.
    const captionTooLong = unit.text.length > CAPTION_LIMIT;

    if (media.length === 1) {
      const item = media[0]!;
      if (captionTooLong) {
        await callTelegram(botToken, "sendPhoto", buildPhotoForm(chatId, item, undefined, false));
        const data = await sendTextMessage(botToken, chatId, unit.text);
        return postFromResult(data, unit.text, chatId);
      }
      const data = await sendWithMarkdownFallback((useParseMode) =>
        callTelegram(botToken, "sendPhoto", buildPhotoForm(chatId, item, unit.text, useParseMode))
      );
      return postFromResult(data, unit.text, chatId);
    }

    if (captionTooLong) {
      await callTelegram(botToken, "sendMediaGroup", buildMediaGroupForm(chatId, media, undefined, false));
      const data = await sendTextMessage(botToken, chatId, unit.text);
      return postFromResult(data, unit.text, chatId);
    }
    const data = await sendWithMarkdownFallback((useParseMode) =>
      callTelegram(botToken, "sendMediaGroup", buildMediaGroupForm(chatId, media, unit.text, useParseMode))
    );
    return postFromResult(data, unit.text, chatId);
  });

  return publishResult(context, posts);
}
