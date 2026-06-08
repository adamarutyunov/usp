import path from "node:path";

import { resolveSecret } from "../util/secrets.js";
import { dryRunResult, getReferencedMedia, type PublishContext } from "./common.js";

function getBotToken(context: PublishContext) {
  const account = context.config.accounts?.telegram?.[context.target.account];
  if (!account) {
    throw new Error(`Missing Telegram account "${context.target.account}".`);
  }
  return resolveSecret(account.botToken, "Telegram bot token");
}

async function callTelegram(botToken: string, method: string, body: FormData | Record<string, unknown>) {
  const isFormData = body instanceof FormData;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: isFormData ? undefined : { "content-type": "application/json" },
    body: isFormData ? body : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${data?.description ?? JSON.stringify(data)}`);
  }
  return data;
}

function appendFile(form: FormData, field: string, item: { data?: Buffer; mime?: string; resolvedPath: string }) {
  if (!item.data) {
    throw new Error(`Telegram adapter requires loaded local image data: ${item.resolvedPath}`);
  }
  const blob = new Blob([new Uint8Array(item.data)], {
    type: item.mime ?? "application/octet-stream",
  });
  form.append(field, blob, path.basename(item.resolvedPath));
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
  const posts = [];

  for (const unit of context.plan.units) {
    const media = getReferencedMedia(context.media, unit.mediaRefs);

    if (media.length === 0) {
      const data = await callTelegram(botToken, "sendMessage", {
        chat_id: chatId,
        text: unit.text,
        disable_web_page_preview: false,
      });
      posts.push({ id: String(data.result?.message_id ?? ""), text: unit.text });
      continue;
    }

    if (media.length === 1) {
      const item = media[0]!;
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("caption", unit.text);
      if (item.isRemote) {
        form.set("photo", item.rawPath);
      } else {
        appendFile(form, "photo", item);
      }
      const data = await callTelegram(botToken, "sendPhoto", form);
      posts.push({ id: String(data.result?.message_id ?? ""), text: unit.text });
      continue;
    }

    const form = new FormData();
    form.set("chat_id", chatId);
    const mediaPayload = media.map((item, index) => {
      if (item.isRemote) {
        return {
          type: "photo",
          media: item.rawPath,
          caption: index === 0 ? unit.text : undefined,
        };
      }
      const field = `file${index}`;
      appendFile(form, field, item);
      return {
        type: "photo",
        media: `attach://${field}`,
        caption: index === 0 ? unit.text : undefined,
      };
    });
    form.set("media", JSON.stringify(mediaPayload));
    const data = await callTelegram(botToken, "sendMediaGroup", form);
    posts.push({ id: String(data.result?.message_id ?? ""), text: unit.text });
  }

  return {
    target: context.targetId,
    platform: "telegram" as const,
    account: context.target.account,
    dryRun: false,
    posts,
  };
}
