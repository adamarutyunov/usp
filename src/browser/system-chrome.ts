import fs from "node:fs";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";

import { chromium, type Browser, type BrowserContext } from "playwright";

import { assertBrowserProfileAvailable, ensureBrowserProfileDir, withBrowserProfileLock } from "./profile.js";

type SystemChromeLoginOptions = {
  profileDir: string;
  url: string;
};

type SystemChromeSessionOptions = {
  profileDir: string;
  headless: boolean;
};

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function chromeCommand() {
  if (process.platform === "darwin" && fs.existsSync(MAC_CHROME)) {
    return { command: MAC_CHROME, args: [] };
  }

  const candidates =
    process.platform === "win32"
      ? [
          `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ["google-chrome", "google-chrome-stable", "chrome"];

  for (const candidate of candidates) {
    if (candidate && (candidate.includes("/") || candidate.includes("\\")) && fs.existsSync(candidate)) {
      return { command: candidate, args: [] };
    }
  }

  return { command: candidates[candidates.length - 1] ?? "google-chrome", args: [] };
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolve(address.port);
        } else {
          reject(new Error("Could not allocate a local Chrome debugging port."));
        }
      });
    });
  });
}

async function waitForChromeEndpoint(port: number, timeoutMs = 15_000) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        return endpoint;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Chrome remote debugging at ${endpoint}: ${String(lastError)}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs),
  ]);
}

async function closeChrome(browser: Browser | undefined, child: ChildProcess) {
  if (browser) {
    const close = browser.close().catch(() => undefined);
    await Promise.race([close, delay(1_500)]);
  }

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await waitForExit(child, 2_000);
  }

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child, 1_000);
  }
}

export async function openSystemChromeForLogin(options: SystemChromeLoginOptions) {
  await ensureBrowserProfileDir(options.profileDir);
  const chrome = chromeCommand();
  const child = spawn(
    chrome.command,
    [
      ...chrome.args,
      `--user-data-dir=${options.profileDir}`,
      "--no-first-run",
      "--new-window",
      options.url,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );

  child.on("error", (error) => {
    throw new Error(`Failed to open Google Chrome: ${error.message}`);
  });
  child.unref();
}

export async function withSystemChromeSession<T>(
  options: SystemChromeSessionOptions,
  fn: (context: BrowserContext) => Promise<T>
): Promise<T> {
  return withBrowserProfileLock(options.profileDir, async () => {
    await ensureBrowserProfileDir(options.profileDir);
    await assertBrowserProfileAvailable(options.profileDir);

    const chrome = chromeCommand();
    const port = await getFreePort();
    const child = spawn(
      chrome.command,
      [
        ...chrome.args,
        `--user-data-dir=${options.profileDir}`,
        `--remote-debugging-port=${port}`,
        "--no-first-run",
        "--disable-search-engine-choice-screen",
        ...(options.headless ? ["--headless=new"] : ["--new-window"]),
        "about:blank",
      ],
      {
        detached: false,
        stdio: "ignore",
      }
    );

    let browser: Browser | undefined;

    try {
      child.once("error", (error) => {
        throw new Error(`Failed to open Google Chrome: ${error.message}`);
      });
      const endpoint = await waitForChromeEndpoint(port);
      browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0];
      if (!context) {
        throw new Error("Could not attach to the Chrome browser context.");
      }
      return await fn(context);
    } finally {
      await closeChrome(browser, child);
    }
  });
}
