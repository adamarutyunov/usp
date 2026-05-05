import fs from "node:fs/promises";
import path from "node:path";

import mime from "mime";
import type { MarkdownInput, SourceMedia } from "../types.js";

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isRemotePath(value: string) {
  return /^https?:\/\//i.test(value);
}

function inferTitle(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}

async function loadMedia(media: SourceMedia) {
  if (media.isRemote) {
    const response = await fetch(media.resolvedPath);
    if (!response.ok) {
      throw new Error(`Failed to load remote image ${media.resolvedPath} (${response.status}).`);
    }
    const arrayBuffer = await response.arrayBuffer();
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

export async function readMarkdownInput(filePath: string): Promise<MarkdownInput> {
  const inputPath = path.resolve(process.cwd(), filePath);
  const baseDir = path.dirname(inputPath);
  const body = await fs.readFile(inputPath, "utf8");
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
