import fs from "node:fs/promises";
import path from "node:path";

import { extractImages, loadMedia } from "../content/markdown.js";
import type { MarkdownInput, PlatformPlan, SourceMedia, TargetConfig } from "../types.js";

export type PreviewPlan = {
  plan: PlatformPlan;
  /** Media referenced by the (possibly edited) preview — source images reused, new ones to be loaded. */
  media: SourceMedia[];
};

type PreviewTarget = {
  id: string;
  config: TargetConfig;
};

/**
 * Line that separates posts in a preview Markdown file. Editing the file — adding or
 * removing a dash line — re-splits the posts on the next publish. Any line of three or
 * more dashes is treated as a boundary; this canonical 10-dash form is what we write.
 */
export const POST_SEPARATOR = "----------";
const SEPARATOR_PATTERN = /^[ \t]*-{3,}[ \t]*$/m;

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "target";
}

/**
 * Preview folder for a source: a sibling directory named after the file with a
 * `.usp-preview` suffix (no hash), e.g. `posts/launch.md` → `posts/launch.usp-preview/`.
 * The suffix keeps it ignorable (`*.usp-preview/`) and clear of real directories.
 * Re-previewing the same file overwrites its folder. Inline/stdin inputs (no real
 * path) fall back to a folder in the cwd.
 */
function previewDirFor(inputPath: string) {
  const baseName = safeSegment(path.basename(inputPath, path.extname(inputPath))) || "preview";
  return path.resolve(path.dirname(inputPath), `${baseName}.usp-preview`);
}

/** Render a plan to editable Markdown: a help comment, an optional `# title`, post text + inline images, posts split by the separator. */
function serializePlan(plan: PlatformPlan, media: SourceMedia[], target: PreviewTarget): string {
  const byId = new Map(media.map((item) => [item.id, item]));
  const header =
    `<!-- usp preview — ${target.config.platform}/${target.config.account}/${target.id}. ` +
    `Edit freely; separate posts with a line of dashes (${POST_SEPARATOR}). ` +
    `A leading "# " line is the optional title. HTML comments are ignored when posting. -->`;
  const blocks = plan.units.map((unit) => {
    const parts: string[] = [];
    if (unit.text.trim()) {
      parts.push(unit.text.trim());
    }
    for (const ref of unit.mediaRefs ?? []) {
      const item = byId.get(ref);
      if (item) {
        parts.push(`![${item.alt}](${item.rawPath})`);
      }
    }
    return parts.join("\n\n");
  });
  const titleLine = plan.title?.trim() ? `# ${plan.title.trim()}\n\n` : "";
  return `${header}\n\n${titleLine}${blocks.join(`\n\n${POST_SEPARATOR}\n\n`)}\n`;
}

function isRemotePath(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * Parse edited preview Markdown back into a plan: strip HTML comments, take a leading
 * `# ` line as the title, split the rest on dash lines, and resolve inline images.
 * Images keep their source bytes when the path matches the original; images the user
 * added (a new local path or a URL) become fresh media descriptors to be loaded.
 * Returns the media set the post should use, so removed images drop out and added
 * ones come along. Relative local paths resolve against the source file's directory.
 */
function parsePlan(markdown: string, sourceMedia: SourceMedia[], baseDir: string): PreviewPlan | undefined {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, "");
  let body = withoutComments.replace(/^\s+/, "");

  let title: string | undefined;
  const titleMatch = body.match(/^#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/);
  if (titleMatch) {
    title = titleMatch[1].trim() || undefined;
    body = body.slice(titleMatch[0].length);
  }

  const sourceByPath = new Map(sourceMedia.map((item) => [item.rawPath, item]));
  const mediaByPath = new Map<string, SourceMedia>();
  let newMediaCount = 0;

  const resolveImage = (image: { alt: string; path: string }): string => {
    const existing = mediaByPath.get(image.path);
    if (existing) {
      return existing.id;
    }
    const fromSource = sourceByPath.get(image.path);
    const item: SourceMedia = fromSource ?? {
      id: `preview-img${(newMediaCount += 1)}`,
      alt: image.alt,
      rawPath: image.path,
      resolvedPath: isRemotePath(image.path) ? image.path : path.resolve(baseDir, image.path),
      isRemote: isRemotePath(image.path),
    };
    mediaByPath.set(image.path, item);
    return item.id;
  };

  const units = body
    .split(SEPARATOR_PATTERN)
    .map((segment) => {
      const { text, images } = extractImages(segment);
      return { text, mediaRefs: images.map(resolveImage) };
    })
    .filter((unit) => unit.text || unit.mediaRefs.length > 0);

  if (units.length === 0) {
    return undefined;
  }
  return { plan: { title, units }, media: [...mediaByPath.values()] };
}

export class PreviewSession {
  constructor(
    readonly dir: string,
    private readonly input: MarkdownInput
  ) {}

  async exists() {
    try {
      const stat = await fs.stat(this.dir);
      return stat.isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  filePath(target: PreviewTarget) {
    const base = safeSegment(`${target.config.platform}-${target.config.account}-${target.id}`);
    return path.join(this.dir, `${base}.md`);
  }

  async read(target: PreviewTarget): Promise<PreviewPlan | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(target), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    const parsed = parsePlan(raw, this.input.media, path.dirname(this.input.inputPath));
    if (!parsed) {
      return undefined;
    }
    // Load any image the user added that wasn't already loaded from the source
    // (a new local file or a URL); source images keep their bytes.
    const media = await Promise.all(parsed.media.map((item) => (item.data ? item : loadMedia(item))));
    return { plan: parsed.plan, media };
  }

  async write(target: PreviewTarget, plan: PlatformPlan) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.filePath(target), serializePlan(plan, this.input.media, target));
  }
}

export class PreviewStore {
  open(input: MarkdownInput) {
    return new PreviewSession(previewDirFor(input.inputPath), input);
  }
}
