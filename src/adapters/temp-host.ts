import path from "node:path";

import type { SourceMedia } from "../types.js";
import { fetchWithTimeout } from "../util/http.js";

// Litterbox (catbox.moe) — anonymous, no account or key. Files auto-expire; 1h is far
// longer than the few seconds a platform needs to fetch the image once.
const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
const UPLOAD_TIMEOUT_MS = 60_000;
const EXPIRY = "1h";

/**
 * Upload a loaded local media file to a temporary public host and return its URL.
 * Lets URL-only platforms (Threads, Reddit self-posts) use locally-referenced images
 * without the user hosting them. Opt-in via config — the bytes transit a third party.
 */
export async function uploadTempMedia(item: SourceMedia): Promise<string> {
  if (!item.data) {
    throw new Error(`Cannot host ${item.resolvedPath}: media bytes are not loaded.`);
  }
  const form = new FormData();
  form.set("reqtype", "fileupload");
  form.set("time", EXPIRY);
  form.append(
    "fileToUpload",
    new Blob([new Uint8Array(item.data)], { type: item.mime ?? "application/octet-stream" }),
    path.basename(item.resolvedPath)
  );

  const response = await fetchWithTimeout(LITTERBOX_API, { method: "POST", body: form }, { timeoutMs: UPLOAD_TIMEOUT_MS });
  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`Temporary image host upload failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return text;
}
