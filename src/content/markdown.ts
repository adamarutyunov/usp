import fs from "node:fs/promises";
import path from "node:path";

import mime from "mime";
import type { MarkdownInput, SourceMedia } from "../types.js";
import { fetchWithTimeout } from "../util/http.js";

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REMOTE_IMAGE_TIMEOUT_MS = 30_000;
const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;

function isRemotePath(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * Reject obvious SSRF targets (loopback, link-local, private ranges, cloud metadata)
 * before fetching a remote image. This is a best-effort literal-host check — it does
 * not resolve DNS, so a hostname pointing at a private IP can still slip through; it
 * exists to stop the common `![x](http://169.254.169.254/...)` style of abuse when the
 * Markdown comes from an untrusted source.
 */
function assertFetchableHost(url: string) {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    throw new Error(`Invalid remote image URL: ${url}`);
  }
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fe80:/i.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host);
  if (blocked) {
    throw new Error(`Refusing to fetch remote image from a private or link-local host: ${host}`);
  }
}

function inferTitle(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}

async function loadMedia(media: SourceMedia) {
  if (media.isRemote) {
    assertFetchableHost(media.resolvedPath);
    const response = await fetchWithTimeout(media.resolvedPath, {}, { timeoutMs: REMOTE_IMAGE_TIMEOUT_MS });
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
    const resolvedPath = isRemote ? decodedPath : path.resolve(baseDir, decodedPath);
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

  return {
    inputPath,
    title: inferTitle(body),
    body,
    bodyWithMediaPlaceholders,
    media: await Promise.all(media.map(loadMedia)),
  };
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
