# Ultimate Social Poster

**Write once in Markdown. Post everywhere.**

`usp` takes a single Markdown file and publishes it to X, LinkedIn, Reddit, Telegram, Bluesky, Mastodon, Discord, Aegea, and Threads. Each destination can be posted **as-is** or rewritten by an LLM to fit the platform's length and style — you choose per target, every time.

- **One source, many platforms.** Markdown in, native posts out, with images and threads preserved.
- **With or without AI.** Post the raw text untouched, or let an LLM tailor it per platform.
- **Pick as you go.** An interactive picker lets you flip each target off / as-is / LLM before publishing.
- **Preview first.** Generate and inspect the text for every platform before anything goes live.
- **Scriptable.** Run it from your terminal, a pipe, or a GitHub Action.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/adamarutyunov/usp/main/install.sh | sh
```

Pin a version:

```sh
VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/adamarutyunov/usp/main/install.sh | sh
```

Or with npm:

```sh
npm install -g usp
npx playwright install chromium
```

The installer also sets up Playwright Chromium for browser-based posting. Install Google Chrome too if you don't have it — it's the default browser for `usp login`.

<!-- SCREENSHOT: drop a screenshot/gif of the interactive target picker here, between Install and Getting Started. -->

## Getting Started

### 1. Configure

```sh
usp setup
```

A guided wizard that lets you:

- pick your **LLM provider** and model (Anthropic, OpenAI, or Gemini),
- add **targets** (a platform + account, e.g. `x-main`),
- set **default posting** behavior and per-platform **prompts**.

Credentials are saved under `~/.config/usp/social-auth/`; your targets and routing live in a project `.usp.yml`.

### 2. Log in (only for browser-based platforms)

Most destinations post through their **native API** and need nothing more than the credentials you entered in setup. A few use **browser automation** (Playwright) and need a one-time signed-in session:

```sh
usp login x
```

This opens your real Google Chrome with a dedicated profile. Sign in, then press Enter — `usp` verifies and saves the session for reuse. Today browser posting is used for **X**; API platforms (LinkedIn, Reddit, Telegram, Bluesky, Mastodon, Discord, Aegea, Threads) don't need `usp login`.

### 3. Publish

```sh
usp publish ./post.md
```

## Usage

### Publish

```sh
usp publish ./post.md
```

When you don't pass `--target`, `usp` opens an interactive picker. Each target has three states — cycle with **space**, move with **↑/↓**, confirm with **enter**:

- **off** — skip this target
- **as-is** — post the raw Markdown, no LLM
- **LLM** — rewrite for the platform

The first time you publish, `usp` offers to save your selection as the default for next time. You can change those defaults later under **Default posting** in `usp setup`.

To skip the picker, name targets explicitly:

```sh
usp publish ./post.md --target x-main --target bluesky-main
```

### Preview

Generate the per-platform text and save it, without posting:

```sh
usp preview ./post.md
```

Preview uses the same target picker. Re-running reuses saved text (or regenerates it on request), so you can iterate before publishing.

### Input

Read from a file, a string, or stdin:

```sh
usp publish ./post.md
usp publish --input "# Title\n\nPost body"
cat post.md | usp publish --stdin
```

Markdown images use normal syntax and keep their position — text before an image and text after it can become separate posts in a thread:

```markdown
Text for the first post.

![Chart alt text](./chart.png)

Text for the next post.
```

## Supported Destinations

Legend: ✅ supported, 🚧 WIP, ❌ not supported, — not applicable.

| Destination | Text | Images | Thread | Link output | API | Browser | Setup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [X](https://x.com/) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | [Developer portal](https://developer.x.com/en/portal/dashboard) |
| [LinkedIn](https://www.linkedin.com/) | ✅ | ✅ | 🚧 | ✅ | ✅ | — | [Developer apps](https://www.linkedin.com/developers/apps) |
| [Reddit](https://www.reddit.com/) | ✅ | ❌ | — | ✅ | ✅ | — | [OAuth apps](https://www.reddit.com/prefs/apps) |
| [Telegram](https://telegram.org/) | ✅ | ✅ | ✅ | — | ✅ | — | [BotFather](https://t.me/BotFather) |
| [Bluesky](https://bsky.app/) | ✅ | ✅ | ✅ | ✅ | ✅ | — | [App passwords](https://bsky.app/settings/app-passwords) |
| [Mastodon](https://mastodon.social/) | ✅ | ✅ | ✅ | ✅ | ✅ | — | [New application](https://mastodon.social/settings/applications/new) |
| [Discord](https://discord.com/) | ✅ | ✅ | ✅ | ✅ | ✅ | — | Channel webhook |
| [Aegea](https://blogengine.me/) | ✅ | ✅ | — | ✅ | ✅ | — | Author password |
| [Threads](https://www.threads.net/) | ✅ | ✅ | ✅ | ✅ | ✅ | — | [Meta app](https://developers.facebook.com/) |

Reddit image posting is not supported: the OAuth submit path creates self-posts, so local images are referenced in the body with a warning.

## Configuration

`usp` merges configuration from several places, later sources winning:

```text
~/.config/usp/config.yml          # global, applies to every project
./.usp.yml (or usp.config.yml)     # project: targets, profiles, routing
~/.config/usp/social-auth/*.yml    # credentials saved by setup (always wins)
--set key.path=value               # one-off override on the command line
```

You rarely edit these by hand — `usp setup` writes them — but everything is plain YAML.

### Global vs. project vs. target

- **Global** (`~/.config/usp/config.yml`): defaults shared across all projects, e.g. your LLM provider or default posting states.
- **Project** (`.usp.yml`): the targets and profiles for one repo or campaign.
- **Target**: per-destination settings (account, subreddit, chat id, a target-specific prompt).

Example `.usp.yml`:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5

profiles:
  default:
    targets: [x-main, bluesky-main, mastodon-main, discord-main]

targets:
  x-main:
    platform: x
    account: main
  reddit-release:
    platform: reddit
    account: main
    subreddit: reddit_api_test     # target-level setting
  telegram-channel:
    platform: telegram
    account: main
    chatId: "@your_channel"
```

A **profile** is just a named set of targets. `--profile release` selects a different set; `--target` overrides both.

### LLM

Set the provider and model (managed by `usp setup`, or edit directly):

```yaml
llm:
  provider: anthropic   # anthropic | openai | gemini
  model: claude-sonnet-4-5
  apiKey: ...           # or authToken for a Claude setup-token
```

### Prompts

Each platform's prompt is built in three layers:

1. **Base guidance** — a hidden, shared instruction (the task and quality bar).
2. **Per-platform rules** — length limits, threading, hashtag policy. This is what you see and edit.
3. **Your override** — optional, either **append** (added after 1 + 2) or **replace** (used on its own).

Set an override per platform in config:

```yaml
prompts:
  x:
    mode: append          # append | replace
    text: Use a dry, factual tone.
```

Or per run on the command line (repeatable):

```sh
usp publish post.md --prompt 'x:append:End with a concrete question.'
usp publish post.md --prompt 'reddit:replace:Write a practical self-post.'
usp publish post.md --prompt 'linkedin:Keep it to two sentences.'   # shorthand = replace
```

A target can also carry its own `prompt:` (a full replacement for that target).

### Default posting

Per-target defaults for the publish picker (off / as-is / LLM), managed under **Default posting** in `usp setup`:

```yaml
postingDefaults:
  x-main: llm
  bluesky-main: as-is
  reddit-release: off
```

### Environment variables

Any credential left blank in config is filled from the environment, by convention. This is what makes CI work: set the env vars (from secrets) and you don't have to commit anything sensitive. Real values in config always win; env is only a fallback.

- **Accounts:** `PLATFORM_FIELD` — e.g. `X_CONSUMER_KEY`, `X_ACCESS_TOKEN_SECRET`, `TELEGRAM_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `BLUESKY_APP_PASSWORD`, `MASTODON_INSTANCE_URL`, `REDDIT_CLIENT_ID`.
- **LLM:** `PROVIDER_API_KEY` or `PROVIDER_AUTH_TOKEN` — e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`.

| Platform | Environment variables |
| --- | --- |
| LLM | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| X | `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |
| LinkedIn | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR` |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_SUBREDDIT` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Aegea | `AEGEA_BASE_URL`, `AEGEA_PASSWORD` |
| Bluesky | `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` |
| Mastodon | `MASTODON_INSTANCE_URL`, `MASTODON_ACCESS_TOKEN` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Threads | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |

The name is just `PLATFORM` + the config field in `UPPER_SNAKE_CASE`, so any account field follows the same rule (e.g. `DISCORD_THREAD_ID`). The env value applies to every account of that platform that left the field blank — which is exactly the single-account case you have in CI.

## Platform Notes

### X

Media uploads require OAuth 1.0a credentials:

```yaml
accounts:
  x:
    main:
      consumerKey: ...
      consumerSecret: ...
      accessToken: ...
      accessTokenSecret: ...
```

`POST /2/tweets` can fail with billing/credit errors even when credentials are valid. X is also the one platform that supports browser posting (`usp login x`).

### LinkedIn

Personal posting needs `w_member_social`, an access token, and a person URN:

```yaml
accounts:
  linkedin:
    me:
      accessToken: ...
      author: urn:li:person:...
      version: "202602"
```

LinkedIn setup is fiddly; this walkthrough helps: https://marcusnoble.co.uk/2025-02-02-posting-to-linkedin-via-the-api/

### Reddit

Uses OAuth self-posts. Local images are referenced in the body with a warning (no native local image upload). Set a `subreddit` on the target or account.

### Telegram

Needs a bot token and a `chatId` (a channel `@handle`, group, or private chat).

### Aegea

Uses the author password flow over HTTP. Markdown images are uploaded and rendered in order.

```yaml
accounts:
  aegea:
    main:
      baseUrl: http://localhost/
      password: ...
```

### Bluesky

App password + AT Protocol. Multiple plan units become a reply thread; images upload as blobs.

```yaml
accounts:
  bluesky:
    main:
      identifier: you.bsky.social
      appPassword: ...
      pdsUrl: https://bsky.social
```

### Mastodon

Instance URL + access token with `read:statuses`, `write:statuses`, `write:media`. Multiple units become a reply chain.

```yaml
accounts:
  mastodon:
    main:
      instanceUrl: https://mastodon.social
      accessToken: ...
      visibility: public
```

### Discord

Incoming webhook (one channel, no bot token). Each unit becomes one message; images attach to the message that references them.

```yaml
accounts:
  discord:
    main:
      webhookUrl: https://discord.com/api/webhooks/...
      username: Ultimate Social Poster
```

### Threads

Meta Graph API with `threads_basic` and `threads_content_publish`. Remote media only — local-only files are skipped.

```yaml
accounts:
  threads:
    main:
      accessToken: ...
      userId: me
      replyControl: everyone
```

## CLI Reference

All publishing commands share these options:

| Option | Description |
| --- | --- |
| `-c, --config <path>` | Config file path (defaults to `.usp.yml` / `usp.config.yml` in the cwd). |
| `-p, --profile <name>` | Profile to select targets from. Default: `default`. |
| `-t, --target <id>` | Target id; repeatable. Skips the interactive picker. |
| `--set <key.path=value>` | One-off config override; repeatable. |
| `--prompt <platform[:append\|replace]:text>` | Prompt override; repeatable. Bare `platform:text` means replace. |
| `--input <markdown>` | Use inline Markdown instead of a file. |
| `--stdin` | Read Markdown from stdin. |

Commands:

```sh
usp init                       # write a starter .usp.yml
  -o, --output <path>          #   output path (default .usp.yml)

usp setup                      # guided wizard (targets, LLM, prompts, default posting)
  --platform <platform>        #   scripted: configure one platform non-interactively
  --account <name>             #   account id for scripted setup (default main)
  -v, --value <key=value>      #   account field; repeatable

usp accounts                   # print configured social accounts

usp account:set <platform> <name>   # set account fields directly
  -v, --value <key=value>      #   account field; repeatable

usp login [platform]           # save a signed-in browser profile (x, linkedin, reddit, telegram)
  --account <name>             #   browser account id
  --browser <chrome|chromium|msedge>   # default chrome
  --controlled                 #   use a Playwright-controlled browser
  --headless                   #   no visible window (only after sign-in exists)
  --profile-dir <path>         #   override profile directory
  --url <url>                  #   override login URL

usp plan [markdown]            # print the platform posting plan as JSON, no publishing
usp preview [markdown]         # generate and save per-platform text, no publishing
usp publish [markdown]         # generate and publish
usp browser:post [markdown]    # experimental deterministic browser posting
```

Examples:

```sh
usp plan ./post.md --profile default
usp preview ./post.md --target x-main --target bluesky-main
usp publish --stdin --target telegram-channel
usp publish --input "# Title\n\nBody" --prompt 'x:replace:One dry tweet.'
```

## GitHub Action

Publish from CI with the bundled composite action.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `markdown` | yes | — | Markdown file to publish. |
| `config` | no | `.usp.yml` | Config path the action reads. |
| `profile` | no | `default` | Profile whose targets to publish. |

The action checks out, builds `usp`, and runs `usp publish <markdown> --config <config> --profile <profile>`.

Publish a release announcement when you cut a GitHub Release:

```yaml
name: Announce Release

on:
  release:
    types: [published]

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Write the post
        run: |
          cat > release-post.md <<'MARKDOWN'
          # ${{ github.event.repository.name }} ${{ github.event.release.tag_name }}

          ${{ github.event.release.body }}

          ${{ github.event.release.html_url }}
          MARKDOWN

      - uses: adamarutyunov/usp@v0.1.0
        with:
          markdown: release-post.md
          config: .usp.yml
          profile: release
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          X_CONSUMER_KEY: ${{ secrets.X_CONSUMER_KEY }}
          X_CONSUMER_SECRET: ${{ secrets.X_CONSUMER_SECRET }}
          X_ACCESS_TOKEN: ${{ secrets.X_ACCESS_TOKEN }}
          X_ACCESS_TOKEN_SECRET: ${{ secrets.X_ACCESS_TOKEN_SECRET }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

Commit a `.usp.yml` with your targets and **no secrets** — credentials come from the `env:` block (see [Environment variables](#environment-variables)). Add each value under your repo's **Settings → Secrets and variables → Actions**, then reference it as `${{ secrets.NAME }}`.

You can use any workflow trigger (`push`, `schedule`, `workflow_dispatch`, …) and any profile, so the same action can post changelogs, scheduled digests, or one-off announcements.

## From Source

```sh
git clone https://github.com/adamarutyunov/usp
cd usp
npm install
npm run build
npm link
npx playwright install chromium
usp --help
```

## License

MIT
