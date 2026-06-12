# Ultimate Social Poster

**Write once in Markdown. Post everywhere.**

`usp` publishes one Markdown file to X, LinkedIn, Reddit, Telegram, Bluesky, Mastodon, Discord, Aegea, and Threads — each target posted **as-is** or rewritten by an LLM to fit the platform.

<img width="1624" height="975" alt="Screenshot 2026-06-12 at 10 32 59" src="https://github.com/user-attachments/assets/425d46e2-a4b9-4e09-93cb-1ec56b26b615" />

- **One source, many platforms** — images and threads preserved.
- **With or without AI** — raw text, or LLM-tailored per platform.
- **Preview** the generated text for every platform before anything goes live.
- **Scriptable** — terminal, pipe, or GitHub Action.

## Supported Destinations

Legend: ✅ supported, 🚧 WIP, ❌ not supported, — n/a.

| Destination | Text | Images | Thread | API | Browser | Setup |
| --- | --- | --- | --- | --- | --- | --- |
| [X](https://x.com/) | ✅ | ✅ | ✅ | ✅ | ✅ | [Developer portal](https://developer.x.com/en/portal/dashboard) |
| [LinkedIn](https://www.linkedin.com/) | ✅ | ✅ | 🚧 | ✅ | — | [Developer apps](https://www.linkedin.com/developers/apps) |
| [Reddit](https://www.reddit.com/) | ✅ | ❌ | — | ✅ | — | [OAuth apps](https://www.reddit.com/prefs/apps) |
| [Telegram](https://telegram.org/) | ✅ | ✅ | ✅ | ✅ | — | [BotFather](https://t.me/BotFather) |
| [Bluesky](https://bsky.app/) | ✅ | ✅ | ✅ | ✅ | — | [App passwords](https://bsky.app/settings/app-passwords) |
| [Mastodon](https://mastodon.social/) | ✅ | ✅ | ✅ | ✅ | — | [New application](https://mastodon.social/settings/applications/new) |
| [Discord](https://discord.com/) | ✅ | ✅ | ✅ | ✅ | — | Channel webhook |
| [Aegea](https://blogengine.me/) | ✅ | ✅ | — | ✅ | — | Author password |
| [Threads](https://www.threads.net/) | ✅ | ✅ | ✅ | ✅ | — | [Meta app](https://developers.facebook.com/) |

Reddit posts via the OAuth submit endpoint (self-posts), so local images are linked in the body rather than uploaded. Browser posting (Playwright) currently backs X; everything else is native API.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/adamarutyunov/usp/main/install.sh | sh   # VERSION=v0.1.0 to pin
```

Or `pnpm add -g usp && pnpx playwright install chromium`. The installer also pulls Playwright Chromium; install Google Chrome for `usp login`.

<!-- SCREENSHOT: interactive target tree -->

## Quickstart

```sh
usp setup              # provider/model, accounts, targets, prompts, defaults
usp login x            # only for browser-backed platforms (X today); API platforms skip this
usp publish ./post.md
```

`usp setup` writes credentials to `~/.config/usp/social-auth/` and routing to `~/.usp.yml`.

## Usage

```sh
usp publish ./post.md          # publish
usp preview ./post.md          # generate + save per-platform text, no posting
usp publish --input "# Title\n\nBody"
cat post.md | usp publish --stdin
```

Without `--target`, `usp` opens an interactive tree to set each target to **off**, **as-is** (raw Markdown), or **LLM** (rewritten). The first publish offers to save that selection as the default. Pass `--target platform/account/name` (repeatable) to skip the tree.

### Editable previews

`usp preview ./post.md` writes one Markdown file per target into a sibling `post.usp-preview/` folder (e.g. `post.usp-preview/x-main-default.md`), with posts separated by a line of dashes:

```markdown
First tweet of the thread.
----------
Second tweet, with an image.

![alt](./chart.png)
```

Edit those files freely — rewrite text, move images, or add/remove dash lines to split or merge posts. The dash lines and post lengths are yours to manage; `usp` does not re-split edited previews. On the next `usp publish ./post.md` it finds the folder and offers to **reuse** your edited text or **regenerate** from source. Re-running `usp preview` overwrites the folder (after a confirm).

Markdown images keep their position — text around an image splits into separate posts in a thread:

```markdown
First post.

![alt](./chart.png)

Next post.
```

## Configuration

Merged in order, later wins:

```text
~/.config/usp/config.yml          # global
~/.usp.yml (or ~/usp.config.yml)   # project: accounts, targets, profiles
~/.config/usp/social-auth/*.yml    # credentials (setup writes these)
--set key.path=value               # per-invocation override
```

Auto-discovery only looks in your home directory — never the current working directory. Pass `--config <path>` to point at a file explicitly (resolved relative to cwd).

### Platform → account → target

- **Platform** — built-in; owns the per-platform prompt rules.
- **Account** — credentials for one identity (a login, bot, or webhook). Many per platform.
- **Target** — where an account posts, plus an optional prompt. Addressed as `platform/account/target`.

Reddit (`subreddit`), Telegram (`chatId`), and Discord (`threadId`) route to multiple destinations per account. The rest post to the account's own feed, so their extra targets just carry different prompts.

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-6

accounts:
  x:
    main:
      targets:
        default: {}
        es: { prompt: { mode: replace, text: "Escribe un solo tuit en español." } }
  telegram:
    newsbot:
      targets:
        en: { chatId: "@news" }
        ru: { chatId: "@news_ru", prompt: { mode: append, text: "Write in Russian." } }

profiles:
  default: { targets: [x/main/default, telegram/newsbot/en] }
```

A profile is a named set of target ids; `--profile` selects one, `--target` overrides both.

### Prompts

Three layers, top to bottom: a fixed **base** you can only append to (`globalPrompt`), **per-platform rules** (append/replace), and a **per-target override** (append/replace). A target `replace` takes full control; otherwise the layers stack. Edit them in the `usp setup` tree, or per run with `--prompt`.

```yaml
globalPrompt: Always write in British English.   # global config; appended to every prompt

prompts:
  x: { mode: append, text: Dry, factual tone. }   # per-platform

accounts:
  x:
    main:
      targets:
        es: { prompt: { mode: replace, text: "..." } }   # per-target
```

```sh
usp publish post.md --prompt 'x:append:End with a question.'   # per-run; bare platform:text = replace
```

### Default posting

```yaml
postingDefaults:                # off | as-is | llm, per target
  x/main/default: llm
  telegram/newsbot/en: as-is
```

### Local media on URL-only platforms

X, Telegram, Bluesky, Mastodon, Discord, and Aegea upload local image files directly. **Threads and Reddit** can't — they only accept a public URL — so local images are skipped there by default. Enable hosting (in `usp setup` → **Media hosting**, or `uploadLocalMedia: true`) and `usp` uploads each local image to a temporary anonymous host ([litterbox](https://litterbox.catbox.moe/), ~1h expiry, no account) and uses that URL, so images work on Threads and in Reddit posts. The image bytes briefly transit that third-party host.

```yaml
uploadLocalMedia: true          # host local images for Threads / Reddit
```

### Environment variables

Blank credentials fall back to env vars by convention; config values win. Accounts use `PLATFORM_FIELD` (`PLATFORM_ACCOUNT_FIELD` takes precedence for multi-account), the LLM uses `PROVIDER_API_KEY` / `PROVIDER_AUTH_TOKEN`.

| Platform | Variables |
| --- | --- |
| LLM | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| X | `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |
| LinkedIn | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR` |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN` |
| Telegram | `TELEGRAM_BOT_TOKEN` |
| Aegea | `AEGEA_BASE_URL`, `AEGEA_PASSWORD` |
| Bluesky | `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` |
| Mastodon | `MASTODON_INSTANCE_URL`, `MASTODON_ACCESS_TOKEN` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Threads | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |

Any field follows the rule — `PLATFORM` + the config key in `UPPER_SNAKE_CASE` (e.g. `DISCORD_THREAD_ID`).

## Platform Notes

### X
OAuth 1.0a (`consumerKey`/`consumerSecret`/`accessToken`/`accessTokenSecret`); needed for media. `POST /2/tweets` can return billing errors with valid credentials. Also supports browser posting (`usp login x`).

### LinkedIn
`w_member_social`, an access token, and a person URN (`author: urn:li:person:...`), plus an API `version`. [Walkthrough](https://marcusnoble.co.uk/2025-02-02-posting-to-linkedin-via-the-api/).

### Reddit
OAuth self-posts. Local images are linked in the body, not uploaded. `subreddit` is set per target.

### Telegram
Bot token on the account; `chatId` (channel `@handle`, group, or chat) per target.

### Aegea
Author-password flow over HTTP (`baseUrl`, `password`). Images uploaded and rendered in order.

### Bluesky
App password + AT Protocol (`identifier`, `appPassword`, `pdsUrl`). Multi-unit posts become a reply thread.

### Mastodon
`instanceUrl` + access token with `read:statuses`, `write:statuses`, `write:media`. `visibility` is an account default.

### Discord
Incoming webhook (one channel, no bot). One webhook = one account; `threadId` per target. `username`/`avatarUrl` optional.

### Threads
Meta Graph API with `threads_basic`, `threads_content_publish`. Only accepts public media URLs; local images need **Media hosting** enabled (see [Local media on URL-only platforms](#local-media-on-url-only-platforms)). Short-lived tokens are auto-exchanged for long-lived ones at setup and refreshed before publish.

## CLI Reference

Shared by `plan` / `preview` / `publish` / `browser:post`:

| Option | |
| --- | --- |
| `-c, --config <path>` | config file (auto-discovered as `~/.usp.yml`/`~/usp.config.yml`) |
| `-p, --profile <name>` | profile to publish (default `default`) |
| `-t, --target <id>` | target id, repeatable; skips the picker |
| `--set <key.path=value>` | config override, repeatable |
| `--prompt <platform[:append\|replace]:text>` | prompt override, repeatable (bare = replace) |
| `--input <markdown>` / `--stdin` | inline / piped Markdown |

```sh
usp init [-o <path>]                         # write a starter .usp.yml
usp setup [--platform <p> --account <name> -v key=value ...]   # wizard, or scripted
usp accounts                                 # print configured accounts
usp account:set <platform> <name> -v key=value ...
usp login [platform] [--browser chrome|chromium|msedge] [--controlled] [--headless] [--profile-dir <p>] [--url <u>]
usp plan    [markdown]                        # print the plan as JSON
usp preview [markdown]                        # generate + save text
usp publish [markdown]                        # generate + publish
usp browser:post [markdown]                   # experimental deterministic browser posting
```

## GitHub Action

| Input | Default | |
| --- | --- | --- |
| `markdown` | — | file to publish (required) |
| `config` | `.usp.yml` | config path |
| `profile` | `default` | profile to publish |

Commit `.usp.yml` without secrets; pass credentials via `env:` (see [Environment variables](#environment-variables)).

```yaml
on:
  release: { types: [published] }
jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          cat > post.md <<'MD'
          # ${{ github.event.repository.name }} ${{ github.event.release.tag_name }}
          ${{ github.event.release.body }}
          ${{ github.event.release.html_url }}
          MD
      - uses: adamarutyunov/usp@v0.1.0
        with: { markdown: post.md, profile: release }
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          X_CONSUMER_KEY: ${{ secrets.X_CONSUMER_KEY }}
          X_CONSUMER_SECRET: ${{ secrets.X_CONSUMER_SECRET }}
          X_ACCESS_TOKEN: ${{ secrets.X_ACCESS_TOKEN }}
          X_ACCESS_TOKEN_SECRET: ${{ secrets.X_ACCESS_TOKEN_SECRET }}
```

## From Source

```sh
git clone https://github.com/adamarutyunov/usp && cd usp
pnpm install && pnpm build && pnpm link --global
pnpm exec playwright install chromium
```

## License

MIT
