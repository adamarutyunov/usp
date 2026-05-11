import { chromium, type BrowserContext } from "playwright";

import { assertBrowserProfileAvailable, withBrowserProfileLock, type BrowserKind } from "./profile.js";
import { withSystemChromeSession } from "./system-chrome.js";

export type BrowserSessionOptions = {
  profileDir: string;
  browser: BrowserKind;
  headless: boolean;
};

function launchOptions(browser: BrowserKind) {
  return browser === "chromium" ? {} : { channel: browser };
}

function browserInstallHint(error: unknown, browser: BrowserKind) {
  const message = (error as Error).message ?? String(error);
  if (message.includes("Executable doesn't exist") || message.includes("Please run the following command")) {
    return browser === "chrome"
      ? `${message}\n\nInstall Google Chrome, or use --browser chromium after running:\n  npx playwright install chromium`
      : `${message}\n\nInstall Playwright Chromium with:\n  npx playwright install chromium`;
  }
  return message;
}

export async function withBrowserSession<T>(
  options: BrowserSessionOptions,
  fn: (context: BrowserContext) => Promise<T>
): Promise<T> {
  if (options.browser === "chrome") {
    return withSystemChromeSession(
      {
        profileDir: options.profileDir,
        headless: options.headless,
      },
      fn
    );
  }

  return withBrowserProfileLock(options.profileDir, async () => {
    let context: BrowserContext | undefined;
    try {
      await assertBrowserProfileAvailable(options.profileDir);
      context = await chromium.launchPersistentContext(options.profileDir, {
        ...launchOptions(options.browser),
        headless: options.headless,
        viewport: { width: 1280, height: 900 },
      });
      return await fn(context);
    } catch (error) {
      throw new Error(browserInstallHint(error, options.browser));
    } finally {
      await context?.close().catch(() => undefined);
    }
  });
}
