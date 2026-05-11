import path from "node:path";

import { resolveSecret } from "../util/secrets.js";
import { getReferencedMedia, type PublishContext } from "./common.js";

type AegeaUploadResponse = {
  success?: boolean;
  data?: {
    "new-name"?: string;
    "original-href"?: string;
  };
  error?: {
    message?: string;
  };
};

type AegeaResponse = {
  body: string;
  url: string;
};

class CookieJar {
  private readonly cookies = new Map<string, string>();

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  store(headers: Headers) {
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const values = getSetCookie?.call(headers) ?? splitSetCookie(headers.get("set-cookie"));
    for (const value of values) {
      const firstPart = value.split(";")[0];
      const separator = firstPart?.indexOf("=") ?? -1;
      if (!firstPart || separator <= 0) {
        continue;
      }
      this.cookies.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
    }
  }
}

function splitSetCookie(value: string | null) {
  if (!value) {
    return [];
  }
  return value.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim());
}

function absoluteUrl(baseUrl: string, href: string) {
  return new URL(href, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function inputValue(html: string, nameOrId: string) {
  const escaped = nameOrId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<input\\b(?=[^>]*(?:name|id)=["']${escaped}["'])[^>]*\\bvalue=["']([^"']*)["'][^>]*>`, "is"),
    new RegExp(`<meta\\b(?=[^>]*name=["']${escaped}["'])[^>]*\\bcontent=["']([^"']*)["'][^>]*>`, "is"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlAttribute(match[1]);
    }
  }
  return undefined;
}

function elementHref(html: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<a\\b(?=[^>]*id=["']${escaped}["'])[^>]*\\bhref=["']([^"']+)["']`, "is"));
  return match?.[1] ? decodeHtmlAttribute(match[1]) : undefined;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function requireValue(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`Aegea response did not contain ${label}.`);
  }
  return value;
}

function sanitizeAegeaLine(value: string) {
  return value.replace(/\r/g, "").replace(/\n+/g, " ").trim();
}

function renderAegeaText(context: PublishContext, uploadedNamesByMediaId: Map<string, string>) {
  const parts: string[] = [];

  for (const unit of context.plan.units) {
    if (unit.text.trim()) {
      parts.push(unit.text.trim());
    }

    const media = getReferencedMedia(context.media, unit.mediaRefs);
    for (const item of media) {
      const uploadedName = uploadedNamesByMediaId.get(item.id);
      if (!uploadedName) {
        continue;
      }
      parts.push([uploadedName, sanitizeAegeaLine(item.alt)].filter(Boolean).join(" "));
    }
  }

  return parts.join("\n\n");
}

class AegeaClient {
  private readonly jar = new CookieJar();

  constructor(
    private readonly baseUrl: string,
    private readonly password: string
  ) {}

  async request(input: string, init: RequestInit = {}, redirects = 0): Promise<AegeaResponse> {
    const headers = new Headers(init.headers);
    const cookie = this.jar.header();
    if (cookie) {
      headers.set("cookie", cookie);
    }

    const response = await fetch(absoluteUrl(this.baseUrl, input), {
      ...init,
      headers,
      redirect: "manual",
    });
    this.jar.store(response.headers);

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirects > 8) {
        throw new Error("Aegea redirect loop.");
      }
      return this.request(response.headers.get("location")!, { method: "GET" }, redirects + 1);
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Aegea request failed (${response.status}): ${body.slice(0, 500)}`);
    }
    return { body, url: response.url };
  }

  async login() {
    const body = new URLSearchParams({
      password: this.password,
      is_public_pc: "1",
    });
    await this.request("/@actions/sign-in/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  async newPostForm() {
    const response = await this.request("/new/");
    const token = requireValue(inputValue(response.body, "token") ?? inputValue(response.body, "csrf-token"), "CSRF token");
    const uploadAction = elementHref(response.body, "e2-file-upload-action") ?? "/@ajax/file-upload/";
    const saveAction = response.body.match(/<form\b(?=[^>]*id=["']form-note["'])[^>]*\baction=["']([^"']+)["']/is)?.[1] ?? "/@actions/note-process/";
    return { token, uploadAction, saveAction };
  }

  async uploadImage(uploadAction: string, token: string, item: { id: string; data?: Buffer; mime?: string; resolvedPath: string }) {
    if (!item.data) {
      throw new Error(`Aegea adapter requires loaded local image data: ${item.resolvedPath}`);
    }

    const form = new FormData();
    form.set("token", token);
    form.set(
      "file",
      new Blob([new Uint8Array(item.data)], { type: item.mime ?? "application/octet-stream" }),
      path.basename(item.resolvedPath)
    );

    const url = new URL(absoluteUrl(this.baseUrl, uploadAction));
    url.searchParams.set("entity", "note");
    url.searchParams.set("entity-id", "new");

    const response = await this.request(url.toString(), {
      method: "POST",
      body: form,
    });
    const data = JSON.parse(response.body) as AegeaUploadResponse;
    if (!data.success || !data.data?.["new-name"]) {
      throw new Error(`Aegea image upload failed: ${data.error?.message ?? response.body}`);
    }
    return data.data["new-name"];
  }

  async saveDraft(saveAction: string, token: string, title: string, text: string) {
    const body = new URLSearchParams({
      token,
      "note-id": "new",
      title,
      text,
      "old-tags-hash": "d41d8cd98f00b204e9800998ecf8427e",
      "browser-offset": "0",
    });
    return this.request(saveAction, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  async publishDraft(draftHtml: string) {
    const token = requireValue(inputValue(draftHtml, "token") ?? inputValue(draftHtml, "csrf-token"), "publish token");
    const noteId = requireValue(inputValue(draftHtml, "note-id"), "draft note id");
    const publishAction =
      draftHtml.match(/<form\b(?=[^>]*id=["']form-note-publish["'])[^>]*\baction=["']([^"']+)["']/is)?.[1] ??
      "/@actions/note-publish/";
    const body = new URLSearchParams({
      token,
      "note-id": noteId,
      "browser-offset": "0",
    });
    const response = await this.request(publishAction, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    return { ...response, noteId };
  }
}

export async function publishToAegea(context: PublishContext) {
  const account = context.config.accounts?.aegea?.[context.target.account];
  if (!account) {
    throw new Error(`Missing Aegea account "${context.target.account}".`);
  }

  const title = (context.plan.title || context.plan.units[0]?.text.split("\n")[0] || "Post").trim().slice(0, 255);
  const baseUrl = account.baseUrl ?? process.env.AEGEA_BASE_URL ?? "http://localhost/";
  const uploadedNamesByMediaId = new Map<string, string>();

  if (context.dryRun) {
    for (const unit of context.plan.units) {
      for (const item of getReferencedMedia(context.media, unit.mediaRefs)) {
        uploadedNamesByMediaId.set(item.id, path.basename(item.resolvedPath));
      }
    }
    return {
      target: context.targetId,
      platform: "aegea" as const,
      account: context.target.account,
      dryRun: true,
      posts: [{ text: renderAegeaText(context, uploadedNamesByMediaId) }],
    };
  }

  const password = resolveSecret(account.password, account.passwordEnv, "Aegea password", "AEGEA_PASSWORD");
  const client = new AegeaClient(baseUrl, password);
  await client.login();
  const form = await client.newPostForm();

  for (const unit of context.plan.units) {
    for (const item of getReferencedMedia(context.media, unit.mediaRefs)) {
      if (uploadedNamesByMediaId.has(item.id)) {
        continue;
      }
      uploadedNamesByMediaId.set(item.id, await client.uploadImage(form.uploadAction, form.token, item));
    }
  }

  const text = renderAegeaText(context, uploadedNamesByMediaId);
  const draft = await client.saveDraft(form.saveAction, form.token, title, text);
  const published = await client.publishDraft(draft.body);

  return {
    target: context.targetId,
    platform: "aegea" as const,
    account: context.target.account,
    dryRun: false,
    posts: [
      {
        id: published.noteId,
        url: published.url,
        text,
      },
    ],
  };
}
