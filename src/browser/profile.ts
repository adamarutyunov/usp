import fs from "node:fs/promises";
import path from "node:path";

import { getBrowserAuthDir } from "../config/config.js";
import { PLATFORM_METADATA, PLATFORMS } from "../platforms.js";
import type { Platform } from "../types.js";

export type BrowserKind = "chromium" | "chrome" | "msedge";

export const DEFAULT_BROWSER: BrowserKind = "chrome";

export const DEFAULT_BROWSER_ACCOUNTS = Object.fromEntries(
  PLATFORMS.map((platform) => [platform, PLATFORM_METADATA[platform].defaultAccount])
) as Record<Platform, string>;

export const LOGIN_URLS: Record<Platform, string> = {
  x: "https://x.com/home",
  linkedin: "https://www.linkedin.com/feed/",
  reddit: "https://www.reddit.com/",
  telegram: "https://web.telegram.org/a/",
  aegea: "http://localhost/",
  bluesky: "https://bsky.app/",
  mastodon: "https://mastodon.social/",
  discord: "https://discord.com/channels/@me",
  threads: "https://www.threads.net/",
};

function cleanPathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function browserProfileDir(platform: Platform, account = DEFAULT_BROWSER_ACCOUNTS[platform]) {
  return path.join(getBrowserAuthDir(), platform, cleanPathPart(account));
}

export function expandHome(filePath: string) {
  return filePath === "~" || filePath.startsWith("~/")
    ? path.join(process.env.HOME ?? "", filePath.slice(2))
    : filePath;
}

export async function ensureBrowserProfileDir(profileDir: string) {
  await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function browserProfileLockInfo(profileDir: string) {
  const lockPath = path.join(profileDir, "SingletonLock");

  try {
    const target = await fs.readlink(lockPath);
    const pidMatch = target.match(/-(\d+)$/);
    const pid = pidMatch ? Number(pidMatch[1]) : undefined;
    return {
      lockPath,
      exists: true,
      pid,
      running: pid ? isProcessRunning(pid) : true,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EINVAL") {
      try {
        await fs.access(lockPath);
        return { lockPath, exists: true, running: true };
      } catch {
        return { lockPath, exists: false, running: false };
      }
    }
    throw error;
  }
}

async function removeStaleBrowserSingletons(profileDir: string) {
  await Promise.all(
    ["SingletonLock", "SingletonSocket", "SingletonCookie"].map((name) =>
      fs.rm(path.join(profileDir, name), { force: true })
    )
  );
}

export async function assertBrowserProfileAvailable(profileDir: string) {
  const lock = await browserProfileLockInfo(profileDir);
  if (!lock.exists) {
    return;
  }
  if (lock.pid && !lock.running) {
    await removeStaleBrowserSingletons(profileDir);
    return;
  }

  const suffix = lock.pid ? ` It looks like Chrome pid ${lock.pid} is still running.` : "";
  throw new Error(
    `Browser profile is already open: ${profileDir}.${suffix} Close the Chrome window opened by \`usp login\`, then retry.`
  );
}

export async function withBrowserProfileLock<T>(profileDir: string, fn: () => Promise<T>): Promise<T> {
  await ensureBrowserProfileDir(profileDir);
  const lockPath = path.join(profileDir, ".usp-lock");
  let handle: fs.FileHandle | undefined;

  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Browser profile is already in use: ${profileDir}`);
    }
    throw error;
  }

  try {
    await handle.writeFile(String(process.pid));
    return await fn();
  } finally {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  }
}
