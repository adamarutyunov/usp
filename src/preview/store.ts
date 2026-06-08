import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { MarkdownInput, PlatformPlan, TargetConfig } from "../types.js";

type PreviewTarget = {
  id: string;
  config: TargetConfig;
};

type PreviewFile = {
  version: 1;
  source: {
    inputPath: string;
    title?: string;
  };
  target: {
    id: string;
    platform: string;
    account: string;
  };
  plan: PlatformPlan;
};

function sourceHash(input: MarkdownInput) {
  return crypto
    .createHash("md5")
    .update(input.body)
    .update("\0")
    .update(input.media.map((item) => `${item.rawPath}:${item.size ?? ""}`).join("\n"))
    .digest("hex");
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "target";
}

function normalizePlan(value: unknown): PlatformPlan | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as { title?: unknown; units?: unknown };
  if (!Array.isArray(raw.units)) {
    return undefined;
  }

  const units = raw.units
    .map((unit) => {
      if (!unit || typeof unit !== "object") {
        return undefined;
      }
      const source = unit as { text?: unknown; mediaRefs?: unknown };
      const text = typeof source.text === "string" ? source.text : "";
      if (!text.trim()) {
        return undefined;
      }
      return {
        text,
        mediaRefs: Array.isArray(source.mediaRefs) ? source.mediaRefs.map(String) : undefined,
      };
    })
    .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));

  if (units.length === 0) {
    return undefined;
  }

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : undefined,
    units,
  };
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
    return path.join(this.dir, `${base}.json`);
  }

  async read(target: PreviewTarget): Promise<PlatformPlan | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(target), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }

    let parsed: Partial<PreviewFile>;
    try {
      parsed = JSON.parse(raw) as Partial<PreviewFile>;
    } catch {
      // A corrupt or hand-edited preview file is a cache miss, not a fatal error.
      return undefined;
    }
    if (
      parsed.version !== 1 ||
      parsed.target?.id !== target.id ||
      parsed.target.platform !== target.config.platform ||
      parsed.target.account !== target.config.account
    ) {
      return undefined;
    }
    return normalizePlan(parsed.plan);
  }

  async write(target: PreviewTarget, plan: PlatformPlan) {
    await fs.mkdir(this.dir, { recursive: true });
    const file: PreviewFile = {
      version: 1,
      source: {
        inputPath: this.input.inputPath,
        title: this.input.title,
      },
      target: {
        id: target.id,
        platform: target.config.platform,
        account: target.config.account,
      },
      plan,
    };
    await fs.writeFile(this.filePath(target), `${JSON.stringify(file, null, 2)}\n`);
  }
}

export class PreviewStore {
  constructor(private readonly rootDir = path.resolve(process.cwd(), ".usp", "previews")) {}

  open(input: MarkdownInput) {
    return new PreviewSession(path.join(this.rootDir, sourceHash(input)), input);
  }
}
