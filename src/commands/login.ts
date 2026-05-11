import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import { cancel, intro, isCancel, note, outro, select } from "@clack/prompts";
import type { BrowserContext, Page } from "playwright";

import {
  browserProfileDir,
  DEFAULT_BROWSER,
  DEFAULT_BROWSER_ACCOUNTS,
  expandHome,
  LOGIN_URLS,
  type BrowserKind,
} from "../browser/profile.js";
import { withBrowserSession } from "../browser/context.js";
import { loadSocialAuthConfig, writeSocialAuthConfig } from "../config/config.js";
import type { Platform, UspConfig } from "../types.js";
import { platformName } from "../util/display.js";

type LoginOptions = {
  account?: string;
  browser?: BrowserKind;
  controlled?: boolean;
  headless?: boolean;
  profileDir?: string;
  url?: string;
};

const PLATFORMS: Platform[] = ["x", "linkedin", "reddit", "telegram"];

function assertNotCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Login cancelled.");
    process.exit(0);
  }
  return value;
}

function assertPlatform(value: string): asserts value is Platform {
  if (!PLATFORMS.includes(value as Platform)) {
    throw new Error(`Unsupported platform: ${value}. Expected x, linkedin, reddit, or telegram.`);
  }
}

function assertBrowser(value: string): asserts value is BrowserKind {
  if (!["chromium", "chrome", "msedge"].includes(value)) {
    throw new Error(`Unsupported browser: ${value}. Expected chromium, chrome, or msedge.`);
  }
}

async function choosePlatform(platform?: string) {
  if (platform) {
    assertPlatform(platform);
    return platform;
  }

  return assertNotCancel(
    await select({
      message: "Choose a platform to sign in to",
      options: [
        { value: "x", label: "X", hint: "Persistent browser profile for browser posting" },
        { value: "linkedin", label: "LinkedIn", hint: "Persistent browser profile for browser posting" },
        { value: "reddit", label: "Reddit", hint: "Persistent browser profile for browser posting" },
        { value: "telegram", label: "Telegram", hint: "Telegram Web profile, usually not needed for bot posting" },
      ],
    })
  ) as Platform;
}

async function saveBrowserAuth(
  platform: Platform,
  account: string,
  profileDir: string,
  browser: BrowserKind,
  headless: boolean,
  loginUrl: string
) {
  const current = await loadSocialAuthConfig();
  const browserAuth = current.browserAuth ?? {};
  browserAuth[platform] ??= {};
  browserAuth[platform]![account] = {
    profileDir,
    engine: "playwright",
    browser,
    headless,
    loginUrl,
    lastLoginAt: new Date().toISOString(),
  };

  await writeSocialAuthConfig("browser.yml", { browserAuth } as UspConfig);
}

async function isXLoggedIn(page: Page) {
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  const loggedInSignals = page.locator(
    [
      '[data-testid="SideNav_NewTweet_Button"]',
      '[data-testid="SideNav_AccountSwitcher_Button"]',
      '[data-testid="AppTabBar_Profile_Link"]',
    ].join(", ")
  );
  return (await loggedInSignals.count()) > 0 && (await loggedInSignals.first().isVisible().catch(() => false));
}

async function hasXAuthCookies(context: BrowserContext) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  return cookies.some((cookie) => cookie.name === "auth_token") && cookies.some((cookie) => cookie.name === "ct0");
}

async function verifyLogin(platform: Platform, context: BrowserContext) {
  const page = context.pages()[0] ?? (await context.newPage());

  if (platform === "x" && !(await hasXAuthCookies(context)) && !(await isXLoggedIn(page))) {
    throw new Error(
      'X login was not verified. Keep the Chrome window open until x.com/home shows your logged-in account, then press Enter.'
    );
  }
}

export async function loginCommand(platformArg?: string, options: LoginOptions = {}) {
  intro("usp login");
  const platform = await choosePlatform(platformArg);
  const account = options.account ?? DEFAULT_BROWSER_ACCOUNTS[platform];
  const browser = options.browser ?? DEFAULT_BROWSER;
  const headless = Boolean(options.headless);
  const controlled = Boolean(options.controlled || headless || browser !== "chrome");
  assertBrowser(browser);

  if (headless) {
    note(
      [
        "Headless is useful for later automated posting with an existing browser profile.",
        "For first-time sign-in, headed Chrome is usually required so you can complete 2FA and anti-abuse checks.",
      ].join("\n"),
      "Headless login"
    );
  }

  const profileDir = options.profileDir
    ? expandHome(options.profileDir)
    : browserProfileDir(platform, account);
  const loginUrl = options.url ?? LOGIN_URLS[platform];
  const loginInstruction = controlled
    ? headless
      ? "This will only work if the profile is already signed in."
      : "Sign in in the browser window, then return to this terminal and press Enter."
    : "Sign in in Chrome, keep the window open, then return to this terminal and press Enter.";

  note(
    [
      `Platform: ${platformName(platform)}`,
      `Account: ${account}`,
      `Browser: ${browser}`,
      `Controlled: ${controlled ? "yes" : "no"}`,
      `Headless: ${headless ? "yes" : "no"}`,
      `Profile: ${profileDir}`,
      `URL: ${loginUrl}`,
      loginInstruction,
    ].join("\n"),
    "Browser login"
  );

  if (!controlled) {
    await withBrowserSession({ profileDir, browser, headless: false }, async (context) => {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
      const rl = readline.createInterface({ input, output });
      try {
        await rl.question("Press Enter after login is complete and x.com/home shows your account...");
      } finally {
        rl.close();
      }
      await verifyLogin(platform, context);
    });
    await saveBrowserAuth(platform, account, profileDir, browser, headless, loginUrl);
    outro(`Saved browser session for ${platformName(platform)} at ${profileDir}`);
    return;
  }

  await withBrowserSession({ profileDir, browser, headless }, async (context) => {
    let closed = false;
    let rl: readline.Interface | undefined;

    try {
      context.once("close", () => {
        closed = true;
      });

      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

      if (headless) {
        await context.close();
        return;
      }

      rl = readline.createInterface({ input, output });
      const pressedEnter = rl.question("Press Enter after login is complete...");
      const browserClosed = new Promise<"closed">((resolve) => context.once("close", () => resolve("closed")));
      const result = await Promise.race([pressedEnter.then(() => "entered" as const), browserClosed]);

      if (result === "entered" && !closed) {
        await context.close();
      }
    } finally {
      rl?.close();
    }
  });

  await saveBrowserAuth(platform, account, profileDir, browser, headless, loginUrl);
  outro(`Saved browser session for ${platformName(platform)} at ${profileDir}`);
}
