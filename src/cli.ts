#!/usr/bin/env node
import { Command } from "commander";
import { accountSetCommand } from "./commands/account.js";
import { browserPostCommand } from "./commands/browser-post.js";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { planCommand, publishCommand } from "./commands/publish.js";
import { setupCommand } from "./commands/setup.js";
import type { Platform } from "./types.js";

const program = new Command();

program
  .name("usp")
  .description("Ultimate Social Poster: publish Markdown to X, LinkedIn, Reddit, and Telegram.")
  .version("0.1.0");

program
  .command("init")
  .description("Write a starter .usp.yml project config.")
  .option("-o, --output <path>", "Output config path", ".usp.yml")
  .action((options) => run(() => initCommand(options)));

program
  .command("setup")
  .description("Open the guided terminal setup wizard.")
  .option("--platform <platform>", "x, linkedin, reddit, or telegram")
  .option("--account <name>", "Internal account id for scripted setup", "main")
  .option("-v, --value <key=value>", "Account field value. Repeatable.", collect, [])
  .action((options) => run(() => setupCommand(options)));

program
  .command("account:set")
  .description("Set account fields in the global config.")
  .argument("<platform>", "x, linkedin, reddit, or telegram")
  .argument("<name>", "Account name")
  .option("-v, --value <key=value>", "Account field value. Repeatable.", collect, [])
  .action((platform: Platform, name: string, options) => run(() => accountSetCommand(platform, name, options)));

program
  .command("login")
  .description("Open a persistent browser profile and save its signed-in session.")
  .argument("[platform]", "x, linkedin, reddit, or telegram")
  .option("--account <name>", "Internal browser account id")
  .option("--browser <browser>", "chrome, chromium, or msedge", "chrome")
  .option("--controlled", "Use Playwright-controlled browser for login instead of normal Chrome.")
  .option("--headless", "Run the browser without a visible window. Only useful after sign-in already exists.")
  .option("--profile-dir <path>", "Override browser profile directory")
  .option("--url <url>", "Override login URL")
  .action((platform, options) => run(() => loginCommand(platform, options)));

program
  .command("browser:post")
  .description("Experimental deterministic browser posting.")
  .argument("[platform]", "x", "x")
  .option("--account <name>", "Internal browser account id")
  .option("--browser <browser>", "chrome, chromium, or msedge")
  .option("--headless", "Run the browser without a visible window. Default for browser posting.")
  .option("--headed", "Run the browser with a visible window.")
  .option("--profile-dir <path>", "Override browser profile directory")
  .option("--text <text>", "Text to post")
  .option("--thread <text>", "Thread unit text. Repeatable.", collect, [])
  .option("--media <path>", "Attach media file to the first post. Repeatable.", collect, [])
  .option("--dry-run", "Open compose and fill text without publishing")
  .option("--yes", "Confirm publishing a real post")
  .option("--json", "Print result as JSON")
  .action((platform, options) => run(() => browserPostCommand(platform, options)));

program
  .command("plan")
  .description("Generate and print the platform posting plan without publishing.")
  .argument("[markdown]", "Markdown input file")
  .option("-c, --config <path>", "Config file path")
  .option("-p, --profile <name>", "Profile name", "default")
  .option("-t, --target <id>", "Target id. Repeatable.", collect, [])
  .option("--set <key=value>", "Config override. Repeatable.", collect, [])
  .option("--prompt <platform[:append|replace]:text>", "Prompt override. Repeatable. Defaults to replace.", collect, [])
  .option("--input <markdown>", "Markdown input text")
  .option("--stdin", "Read Markdown input from stdin")
  .action((file, options) => run(() => planCommand(file, options)));

program
  .command("publish")
  .description("Generate platform posts and publish them.")
  .argument("[markdown]", "Markdown input file")
  .option("-c, --config <path>", "Config file path")
  .option("-p, --profile <name>", "Profile name", "default")
  .option("-t, --target <id>", "Target id. Repeatable.", collect, [])
  .option("--set <key=value>", "Config override. Repeatable.", collect, [])
  .option("--prompt <platform[:append|replace]:text>", "Prompt override. Repeatable. Defaults to replace.", collect, [])
  .option("--input <markdown>", "Markdown input text")
  .option("--stdin", "Read Markdown input from stdin")
  .option("--dry-run", "Print what would be posted without calling platform APIs")
  .option("--json", "Print plan and results as JSON")
  .action((file, options) => run(() => publishCommand(file, options)));

function collect(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

async function run(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

program.parseAsync();
