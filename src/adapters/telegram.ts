import path from "node:path";

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

function postFromResult(data: TelegramResult, text: string): PublishPost {
  return { id: String(data.result?.message_id ?? ""), text };
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
      const data = await callTelegram(botToken, "sendMessage", {
        chat_id: chatId,
        text: unit.text,
        disable_web_page_preview: false,
      });
      return postFromResult(data, unit.text);
    }

    if (media.length === 1) {
      const item = media[0]!;
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("caption", unit.text);
      if (item.isRemote) {
        form.set("photo", item.rawPath);
      } else {
        form.append("photo", mediaBlob(item, "telegram"), path.basename(item.resolvedPath));
      }
      const data = await callTelegram(botToken, "sendPhoto", form);
      return postFromResult(data, unit.text);
    }

    const form = new FormData();
    form.set("chat_id", chatId);
    const mediaPayload = media.map((item, index) => {
      const caption = index === 0 ? unit.text : undefined;
      if (item.isRemote) {
        return { type: "photo", media: item.rawPath, caption };
      }
      const field = `file${index}`;
      form.append(field, mediaBlob(item, "telegram"), path.basename(item.resolvedPath));
      return { type: "photo", media: `attach://${field}`, caption };
    });
    form.set("media", JSON.stringify(mediaPayload));
    const data = await callTelegram(botToken, "sendMediaGroup", form);
    return postFromResult(data, unit.text);
  });

  return publishResult(context, posts);
}
