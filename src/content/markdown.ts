import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mime from "mime";
import type { MarkdownInput, SourceMedia } from "../types.js";
import { fetchWithTimeout } from "../util/http.js";

// The path group accepts spaces (e.g. "Screenshot 2026-06-12 at 10.png" — macOS names
// screenshots that way) by matching lazily up to an optional "title" and the closing paren,
// while still supporting an explicit <bracketed path>.
const IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)]*?)(?:\s+"[^"]*")?\s*\)/g;
const REMOTE_IMAGE_TIMEOUT_MS = 30_000;
const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_LOAD_CONCURRENCY = 4;
const MAX_REMOTE_REDIRECTS = 5;

function isRemotePath(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve a local image reference to an absolute filesystem path. Handles `file:` URLs
 * (e.g. a dragged-in screenshot) and percent-encoding (`%20`, `%C2%A0`) that Markdown
 * editors emit — both of which path.resolve would otherwise mangle.
 */
export function localFsPath(rawPath: string, baseDir: string): string {
  if (/^file:/i.test(rawPath)) {
    try {
      return fileURLToPath(new URL(rawPath));
    } catch {
      // Not a well-formed file URL — fall through and treat it as a plain path.
    }
  }
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding (a literal "%"): use the path as written.
  }
  return path.resolve(baseDir, decoded);
}

/** Pull Markdown images out of a block of text, returning the text without them and their alt/path. */
export function extractImages(text: string): { text: string; images: Array<{ alt: string; path: string }> } {
  const images: Array<{ alt: string; path: string }> = [];
  const stripped = text.replace(IMAGE_PATTERN, (_full, alt: string, rawPath: string) => {
    images.push({ alt: alt.trim(), path: rawPath.replace(/^<|>$/g, "") });
    return "";
  });
  return { text: stripped.replace(/\n{3,}/g, "\n\n").trim(), images };
}

/**
 * Reject obvious SSRF targets (loopback, link-local, private ranges, cloud metadata)
 * before fetching a remote image. Hostnames are resolved before every request and
 * redirect target so a public-looking name cannot resolve to a private address.
 */
async function assertFetchableUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid remote image URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported remote image URL protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`Remote image host did not resolve: ${host}`);
  }
  for (const { address } of addresses) {
    assertPublicAddress(host, address);
  }
}

function assertPublicAddress(host: string, address: string) {
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    address === "0.0.0.0" ||
    address === "::1" ||
    /^127\./.test(address) ||
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    /^169\.254\./.test(address) ||
    /^fe80:/i.test(address) ||
    /^f[cd][0-9a-f]{2}:/i.test(address);
  if (blocked) {
    throw new Error(`Refusing to fetch remote image from a private or link-local host: ${host}`);
  }
}

function inferTitle(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}

export async function loadMedia(media: SourceMedia): Promise<SourceMedia> {
  if (media.isRemote) {
    const response = await fetchRemoteImage(media.resolvedPath);
    if (!response.ok) {
      throw new Error(`Failed to load remote image ${media.resolvedPath} (${response.status}).`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`Remote image ${media.resolvedPath} is too large (${declaredLength} bytes).`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`Remote image ${media.resolvedPath} exceeds the ${MAX_REMOTE_IMAGE_BYTES}-byte limit.`);
    }
    const data = Buffer.from(arrayBuffer);
    return {
      ...media,
      data,
      size: data.byteLength,
      mime:
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        mime.getType(media.resolvedPath) ||
        "application/octet-stream",
    };
  }

  const data = await fs.readFile(media.resolvedPath);
  return {
    ...media,
    data,
    size: data.byteLength,
    mime: mime.getType(media.resolvedPath) ?? "application/octet-stream",
  };
}

async function fetchRemoteImage(url: string) {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REMOTE_REDIRECTS; redirects += 1) {
    await assertFetchableUrl(current);
    const response = await fetchWithTimeout(
      current,
      { redirect: "manual" },
      { timeoutMs: REMOTE_IMAGE_TIMEOUT_MS }
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    current = new URL(location, current).toString();
  }
  throw new Error(`Remote image exceeded ${MAX_REMOTE_REDIRECTS} redirects: ${url}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function parseMarkdownInput({
  body,
  inputPath,
  baseDir,
}: {
  body: string;
  inputPath: string;
  baseDir: string;
}): Promise<MarkdownInput> {
  const media: SourceMedia[] = [];
  let index = 0;

  const bodyWithMediaPlaceholders = body.replace(IMAGE_PATTERN, (_full, alt: string, rawPath: string) => {
    index += 1;
    const id = `img${index}`;
    const decodedPath = rawPath.replace(/^<|>$/g, "");
    const isRemote = isRemotePath(decodedPath);
    const resolvedPath = isRemote ? decodedPath : localFsPath(decodedPath, baseDir);
    media.push({
      id,
      alt: alt.trim(),
      rawPath: decodedPath,
      resolvedPath,
      isRemote,
      mime: isRemote ? undefined : mime.getType(resolvedPath) ?? undefined,
    });
    return `[media:${id}${alt.trim() ? ` alt="${alt.trim().replaceAll('"', '\\"')}"` : ""}]`;
  });

  // Note: media bytes are NOT read here. Parsing only builds the in-memory catalog
  // (id, path, alt) so the LLM can reference images by id and place them per post.
  // The actual file/network read is deferred to publish time (loadAllSourceMedia),
  // so `preview` and `plan` never touch the bytes.
  return {
    inputPath,
    title: inferTitle(body),
    body,
    bodyWithMediaPlaceholders,
    media,
  };
}

/** Read bytes for any not-yet-loaded media. Deferred from parse to the publish path. */
export function loadAllSourceMedia(media: SourceMedia[]): Promise<SourceMedia[]> {
  return mapWithConcurrency(media, MAX_MEDIA_LOAD_CONCURRENCY, (item) =>
    item.data ? Promise.resolve(item) : loadMedia(item)
  );
}

export async function readMarkdownInput(filePath: string): Promise<MarkdownInput> {
  const inputPath = path.resolve(process.cwd(), filePath);
  return parseMarkdownInput({
    inputPath,
    baseDir: path.dirname(inputPath),
    body: await fs.readFile(inputPath, "utf8"),
  });
}

export async function readMarkdownText(text: string, inputPath: string, baseDir: string): Promise<MarkdownInput> {
  return parseMarkdownInput({
    inputPath,
    baseDir,
    body: text,
  });
}
