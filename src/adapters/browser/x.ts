import type { BrowserContext, Locator, Page, Response } from "playwright";

import { withBrowserSession } from "../../browser/context.js";
import { browserProfileDir, DEFAULT_BROWSER, type BrowserKind } from "../../browser/profile.js";
import { getReferencedMedia } from "../common.js";
import type {
  BrowserAuthProfile,
  PlatformPlan,
  PublishTargetResult,
  SourceMedia,
  TargetConfig,
  UspConfig,
} from "../../types.js";

const X_HOME_URL = "https://x.com/home";
const X_COMPOSE_URL = "https://x.com/compose/post";
const COMPOSE_SELECTOR = '[data-testid^="tweetTextarea_"]';
const POST_BUTTON_SELECTOR = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
const POST_ALL_BUTTON_SELECTOR = '[data-testid="tweetButton"]';
const ADD_POST_BUTTON_SELECTOR = '[data-testid="addButton"]';
const REPLY_BUTTON_SELECTOR = '[data-testid="reply"], [aria-label="Reply"], [aria-label^="Reply"]';
const FILE_INPUT_SELECTOR = 'input[data-testid="fileInput"], input[type="file"]';
const MEDIA_PREVIEW_SELECTOR = '[data-testid="attachments"] img, [data-testid="tweetPhoto"] img, div[aria-label="Image"]';
const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const STATUS_LINK_SELECTOR = 'a[href*="/status/"]';
const LOGGED_IN_SELECTOR = [
  '[data-testid="SideNav_NewTweet_Button"]',
  '[data-testid="SideNav_AccountSwitcher_Button"]',
  '[data-testid="AppTabBar_Profile_Link"]',
].join(", ");
const PROFILE_LINK_SELECTOR = '[data-testid="AppTabBar_Profile_Link"]';

export type XBrowserPostOptions = {
  targetId: string;
  target: TargetConfig;
  config: UspConfig;
  plan: PlatformPlan;
  media?: SourceMedia[];
  dryRun: boolean;
  browser?: BrowserKind;
  headless?: boolean;
  profileDir?: string;
};

type PostedStatus = {
  id?: string;
  url?: string;
};

function browserAuthProfile(config: UspConfig, target: TargetConfig): BrowserAuthProfile | undefined {
  return config.browserAuth?.x?.[target.account];
}

function resolvedBrowserSettings(options: XBrowserPostOptions) {
  const saved = browserAuthProfile(options.config, options.target);
  const browser = options.browser ?? saved?.browser ?? DEFAULT_BROWSER;
  const headless = options.headless ?? true;
  const profileDir = options.profileDir ?? saved?.profileDir ?? browserProfileDir("x", options.target.account);

  return { browser, headless, profileDir };
}

async function firstVisible(locator: Locator, timeout = 15_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        return item;
      }
    }
    await locator.page().waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for visible locator: ${locator.toString()}`);
}

async function hasXAuthCookies(context: BrowserContext) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  return cookies.some((cookie) => cookie.name === "auth_token") && cookies.some((cookie) => cookie.name === "ct0");
}

async function ensureLoggedIn(context: BrowserContext, page: Page) {
  if (await hasXAuthCookies(context)) {
    return;
  }

  await page.goto(X_HOME_URL, { waitUntil: "domcontentloaded" });
  const loggedInSignals = page.locator(LOGGED_IN_SELECTOR);
  if ((await loggedInSignals.count()) > 0 && (await loggedInSignals.first().isVisible().catch(() => false))) {
    return;
  }

  if (page.url().includes("/login") || page.url().includes("/i/flow/login")) {
    throw new Error('X browser session is not logged in. Run "usp login x" first.');
  }

  throw new Error('Could not verify X login state. Run "usp login x" again, then retry.');
}

async function getProfileUrl(page: Page) {
  const href = await page.locator(PROFILE_LINK_SELECTOR).first().getAttribute("href").catch(() => undefined);
  return href ? new URL(href, "https://x.com").toString() : undefined;
}

async function openCompose(page: Page) {
  await page.goto(X_COMPOSE_URL, { waitUntil: "domcontentloaded" });
  const compose = page.locator(COMPOSE_SELECTOR).last();
  await compose.waitFor({ state: "visible", timeout: 20_000 });
  return compose;
}

async function typePostText(page: Page, text: string, index: number) {
  const compose = page.locator(COMPOSE_SELECTOR).nth(index);
  await compose.waitFor({ state: "visible", timeout: 20_000 });
  await compose.click();
  await page.keyboard.insertText(text);
  await page.waitForFunction(
    ({ selector, expected, targetIndex }) => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
      const element = elements[targetIndex];
      return Boolean(element?.innerText.includes(expected));
    },
    { selector: COMPOSE_SELECTOR, expected: text, targetIndex: index },
    { timeout: 10_000 }
  );
}

async function attachMedia(page: Page, media: SourceMedia[], index = 0) {
  if (media.length === 0) {
    return;
  }

  const inputs = page.locator(FILE_INPUT_SELECTOR);
  const count = await inputs.count();
  if (count === 0) {
    throw new Error("Could not find X media upload input.");
  }

  const uploadInput = inputs.nth(Math.min(index, count - 1));
  await uploadInput.setInputFiles(media.map((item) => item.resolvedPath));

  const previewCount = await page.locator(MEDIA_PREVIEW_SELECTOR).count().catch(() => 0);
  await page.waitForTimeout(previewCount > 0 ? 1_000 : 3_000);
}

async function fillSingleComposer(context: BrowserContext, unit: PlatformPlan["units"][number], media: SourceMedia[]) {
  const page = context.pages()[0] ?? (await context.newPage());
  await ensureLoggedIn(context, page);
  const profileUrl = await getProfileUrl(page);
  await openCompose(page);
  await typePostText(page, unit.text, 0);
  await attachMedia(page, media, 0);
  return { page, profileUrl };
}

async function addThreadUnit(page: Page, nextIndex: number) {
  const button = await firstVisible(page.locator(ADD_POST_BUTTON_SELECTOR), 10_000);
  await button.click();
  await page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length >= count,
    { selector: COMPOSE_SELECTOR, count: nextIndex + 1 },
    { timeout: 20_000 }
  );
}

async function clickPost(page: Page) {
  const postAll = page.locator(POST_ALL_BUTTON_SELECTOR).last();
  const button = (await postAll.isVisible().catch(() => false))
    ? postAll
    : await firstVisible(page.locator(POST_BUTTON_SELECTOR));
  await button.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    (element) => !element?.getAttribute("aria-disabled") && !element?.hasAttribute("disabled"),
    await button.elementHandle(),
    { timeout: 20_000 }
  );
  await button.click();
  await page.waitForTimeout(5_000);
}

function getObjectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function idFromTweetResult(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const restId = record.rest_id;
  if (typeof restId === "string" && /^\d+$/.test(restId)) {
    return restId;
  }

  const legacy = record.legacy;
  if (legacy && typeof legacy === "object") {
    const legacyId = (legacy as Record<string, unknown>).id_str;
    if (typeof legacyId === "string" && /^\d+$/.test(legacyId)) {
      return legacyId;
    }
  }

  return undefined;
}

function findCreatedTweetId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const tweetResults = getObjectValue(value, "tweet_results");
  const tweetResultId = idFromTweetResult(getObjectValue(tweetResults, "result"));
  if (tweetResultId) {
    return tweetResultId;
  }

  const createTweet = getObjectValue(value, "create_tweet");
  const createTweetId = findCreatedTweetId(createTweet);
  if (createTweetId) {
    return createTweetId;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.__typename === "string" && record.__typename.toLowerCase().includes("tweet")) {
    const directTweetId = idFromTweetResult(record);
    if (directTweetId) {
      return directTweetId;
    }
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      const nested = findCreatedTweetId(child);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function statusFromId(id: string): PostedStatus {
  return { id, url: `https://x.com/i/web/status/${id}` };
}

function statusIdFromUrl(url: string) {
  return url.match(/\/status\/(\d+)/)?.[1];
}

function createTweetResponseWatcher(page: Page, timeout = 30_000) {
  let done = false;
  let timer: NodeJS.Timeout | undefined;

  const promise = new Promise<PostedStatus>((resolve) => {
    const finish = (status: PostedStatus) => {
      if (done) {
        return;
      }
      done = true;
      if (timer) {
        clearTimeout(timer);
      }
      page.off("response", onResponse);
      resolve(status);
    };

    const onResponse = (response: Response) => {
      const request = response.request();
      const requestBody = request.postData() ?? "";
      const isCreateTweet =
        /CreateTweet|CreateScheduledTweet/.test(response.url()) ||
        /CreateTweet|CreateScheduledTweet/.test(requestBody);

      if (!response.url().includes("/graphql/") || request.method() !== "POST" || !isCreateTweet) {
        return;
      }

      void response
        .json()
        .then((data: unknown) => {
          const id = findCreatedTweetId(data);
          if (id) {
            finish(statusFromId(id));
          }
        })
        .catch(() => undefined);
    };

    page.on("response", onResponse);
    timer = setTimeout(() => finish({}), timeout);
  });

  return promise;
}

async function waitForCreateTweetResponse(page: Page, click: () => Promise<void>): Promise<PostedStatus> {
  const responsePromise = createTweetResponseWatcher(page);
  await click();
  return responsePromise;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

async function findArticleByText(page: Page, text: string, timeout = 20_000) {
  const expected = normalizeText(text);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const articles = page.locator(TWEET_ARTICLE_SELECTOR);
    const count = await articles.count();
    for (let index = 0; index < count; index += 1) {
      const article = articles.nth(index);
      const articleText = normalizeText((await article.innerText().catch(() => "")) ?? "");
      if (articleText.includes(expected)) {
        return article;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for X post text: ${text}`);
}

async function findPostedStatus(page: Page, text: string, profileUrl?: string) {
  const lookupUrls = [profileUrl, X_HOME_URL].filter((item): item is string => Boolean(item));
  const expected = normalizeText(text);
  const deadline = Date.now() + 20_000;
  let lookupIndex = 0;

  await page.goto(lookupUrls[lookupIndex]!, { waitUntil: "domcontentloaded" });

  while (Date.now() < deadline) {
    const articles = page.locator(TWEET_ARTICLE_SELECTOR);
    const count = await articles.count();
    for (let index = 0; index < count; index += 1) {
      const article = articles.nth(index);
      const articleText = normalizeText((await article.innerText().catch(() => "")) ?? "");
      if (!articleText.includes(expected)) {
        continue;
      }

      const links = article.locator(STATUS_LINK_SELECTOR);
      const linkCount = await links.count();
      for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
        const href = await links.nth(linkIndex).getAttribute("href");
        const statusMatch = href?.match(/\/status\/(\d+)/);
        if (href && statusMatch) {
          return {
            id: statusMatch[1],
            url: new URL(href, "https://x.com").toString(),
          };
        }
      }
    }

    lookupIndex = (lookupIndex + 1) % lookupUrls.length;
    await page.goto(lookupUrls[lookupIndex]!, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  return {};
}

async function fillComposer(context: BrowserContext, plan: PlatformPlan, media: SourceMedia[]) {
  const page = context.pages()[0] ?? (await context.newPage());
  await ensureLoggedIn(context, page);
  const profileUrl = await getProfileUrl(page);
  await openCompose(page);

  for (const [index, unit] of plan.units.entries()) {
    if (index > 0) {
      await addThreadUnit(page, index);
    }

    await typePostText(page, unit.text, index);
    await attachMedia(page, getReferencedMedia(media, unit.mediaRefs), index);
  }

  return { page, profileUrl };
}

async function submitComposer(page: Page) {
  const submitted = await waitForCreateTweetResponse(page, () => clickPost(page));
  if (submitted.url) {
    return submitted;
  }
  const url = page.url();
  const id = statusIdFromUrl(url);
  return id ? { id, url } : {};
}

async function postFirstUnit(context: BrowserContext, unit: PlatformPlan["units"][number], media: SourceMedia[]) {
  const { page, profileUrl } = await fillSingleComposer(context, unit, media);
  const submitted = await submitComposer(page);
  const located = submitted.url ? submitted : await findPostedStatus(page, unit.text, profileUrl);
  const firstPost = located.url ? located : submitted;
  if (!firstPost.url) {
    throw new Error("Posted first X thread unit, but could not find its status URL.");
  }

  return {
    ...firstPost,
    text: unit.text,
  };
}

async function openReplyComposer(page: Page, previousStatusUrl: string, previousText: string) {
  await page.goto(previousStatusUrl, { waitUntil: "domcontentloaded" });
  const previousArticle = await findArticleByText(page, previousText);
  const replyButton = await firstVisible(previousArticle.locator(REPLY_BUTTON_SELECTOR), 20_000);
  await replyButton.click();
  await page.locator(COMPOSE_SELECTOR).last().waitFor({ state: "visible", timeout: 20_000 });
}

async function postReplyUnit(
  page: Page,
  previousPost: { text: string; url: string },
  unit: PlatformPlan["units"][number],
  media: SourceMedia[]
) {
  await openReplyComposer(page, previousPost.url, previousPost.text).catch((error) => {
    throw new Error(`Could not open X reply composer for ${previousPost.url}: ${(error as Error).message}`);
  });
  const composeIndex = Math.max((await page.locator(COMPOSE_SELECTOR).count()) - 1, 0);
  await typePostText(page, unit.text, composeIndex);
  await attachMedia(page, media, 0);
  const submitted = await submitComposer(page);
  const located = submitted.url ? submitted : await findPostedStatus(page, unit.text, previousPost.url);
  const replyPost = located.url ? located : submitted;
  if (!replyPost.url) {
    throw new Error(`Posted X reply after ${previousPost.url}, but could not find its status URL.`);
  }

  return {
    ...replyPost,
    text: unit.text,
  };
}

async function verifyThreadPosted(page: Page, firstStatusUrl: string, units: PlatformPlan["units"]) {
  await page.goto(firstStatusUrl, { waitUntil: "domcontentloaded" });
  const missing = new Set(units.map((unit) => normalizeText(unit.text)));
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline && missing.size > 0) {
    const bodyText = normalizeText((await page.locator("body").innerText().catch(() => "")) ?? "");
    for (const expected of [...missing]) {
      if (bodyText.includes(expected)) {
        missing.delete(expected);
      }
    }

    if (missing.size === 0) {
      return;
    }

    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(1_500);
  }

  if (missing.size > 0) {
    throw new Error(`X thread verification failed. Missing posted text: ${[...missing].join(" | ")}`);
  }
}

async function verifyThreadChain(page: Page, posts: Array<{ text: string; url?: string }>) {
  for (let index = 1; index < posts.length; index += 1) {
    const parent = posts[index - 1];
    const child = posts[index];
    if (!child.url) {
      throw new Error(`X thread verification failed. Missing status URL for posted text: ${child.text}`);
    }

    await page.goto(child.url, { waitUntil: "domcontentloaded" });
    await findArticleByText(page, child.text);
    const parentText = normalizeText(parent.text);
    const childText = normalizeText(child.text);
    const articles = page.locator(TWEET_ARTICLE_SELECTOR);
    const count = await articles.count();
    let childIndex = -1;

    for (let articleIndex = 0; articleIndex < count; articleIndex += 1) {
      const articleText = normalizeText((await articles.nth(articleIndex).innerText().catch(() => "")) ?? "");
      if (articleText.includes(childText)) {
        childIndex = articleIndex;
        break;
      }
    }

    if (childIndex < 1) {
      throw new Error(`X thread verification failed. Could not find parent context for posted text: ${child.text}`);
    }

    const previousArticleText = normalizeText((await articles.nth(childIndex - 1).innerText().catch(() => "")) ?? "");
    if (!previousArticleText.includes(parentText)) {
      throw new Error(`X thread verification failed. ${child.text} is not shown as a reply to ${parent.text}`);
    }
  }
}

async function postSequentialThread(context: BrowserContext, plan: PlatformPlan, media: SourceMedia[]) {
  const [firstUnit, ...replyUnits] = plan.units;
  if (!firstUnit) {
    return [];
  }

  const posts: Array<{ text: string; id?: string; url?: string }> = [
    await postFirstUnit(context, firstUnit, getReferencedMedia(media, firstUnit.mediaRefs)),
  ];

  const page = context.pages()[0] ?? (await context.newPage());
  for (const unit of replyUnits) {
    const previousPost = posts[posts.length - 1];
    if (!previousPost?.url) {
      throw new Error("Cannot continue X browser thread without previous status URL.");
    }
    const reply = await postReplyUnit(page, { text: previousPost.text, url: previousPost.url }, unit, getReferencedMedia(media, unit.mediaRefs));
    posts.push(reply);
  }

  if (posts[0].url) {
    await verifyThreadPosted(page, posts[0].url, plan.units);
    await verifyThreadChain(page, posts);
  }

  return posts;
}

export async function publishToXBrowser(options: XBrowserPostOptions): Promise<PublishTargetResult> {
  if (options.target.platform !== "x") {
    throw new Error(`X browser poster cannot publish platform "${options.target.platform}".`);
  }
  const settings = resolvedBrowserSettings(options);
  const media = options.media ?? [];
  const posts = await withBrowserSession(settings, async (context) => {
    if (options.dryRun) {
      await fillComposer(context, options.plan, media);
      return options.plan.units.map((unit) => ({ text: unit.text }));
    }

    if (options.plan.units.length > 1) {
      return postSequentialThread(context, options.plan, media);
    }

    const { page, profileUrl } = await fillComposer(context, options.plan, media);
    const submitted = await submitComposer(page);
    const located: PostedStatus = submitted.url ? submitted : await findPostedStatus(page, options.plan.units[0]?.text ?? "", profileUrl);
    const firstPost = located.url ? located : submitted;
    return options.plan.units.map((unit, index) => ({
      text: unit.text,
      id: index === 0 ? firstPost.id : undefined,
      url: index === 0 ? firstPost.url : undefined,
    }));
  });

  return {
    target: options.targetId,
    platform: "x",
    account: options.target.account,
    dryRun: options.dryRun,
    posts,
  };
}

export const xBrowserPostingSteps = {
  loginUrl: X_HOME_URL,
  composeUrl: X_COMPOSE_URL,
  loggedInSelectors: [
    '[data-testid="SideNav_NewTweet_Button"]',
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Profile_Link"]',
  ],
  composeSelector: COMPOSE_SELECTOR,
  postButtonSelector: POST_BUTTON_SELECTOR,
  addPostButtonSelector: ADD_POST_BUTTON_SELECTOR,
  replyButtonSelector: REPLY_BUTTON_SELECTOR,
  fileInputSelector: FILE_INPUT_SELECTOR,
  mediaPreviewSelector: MEDIA_PREVIEW_SELECTOR,
  tweetArticleSelector: TWEET_ARTICLE_SELECTOR,
  statusLinkSelector: STATUS_LINK_SELECTOR,
  profileLinkSelector: PROFILE_LINK_SELECTOR,
};
