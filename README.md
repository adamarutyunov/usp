# usp

Ultimate Social Poster is a Node.js CLI for turning one Markdown draft into platform-specific posts for X, LinkedIn, Reddit, and Telegram.

It uses an LLM to generate an ordered posting plan per platform, preserves inline Markdown image order, uploads local images where the official API supports it, and returns human-readable or JSON publish results.

## Install

```bash
npm install -g usp
```

From this repository, install the local CLI globally:

```bash
cd ~/code/usp
npm install
npm run build
npm link
usp --help
```

Or run it without linking:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Quick Start

```bash
usp setup
usp publish ./post.md --dry-run
usp publish ./post.md --json
```

`usp setup` writes `.usp.yml` first when the current directory does not already have `.usp.yml` or `usp.config.yml`, then opens a guided terminal wizard. The top-level setup menu is a loop: configure one section, return to the menu, then choose another section or Save and exit. It uses internal account names automatically (`main` for X/Reddit/Telegram, `me` for LinkedIn), shows official links for each key/token, stores social credentials under `~/.config/usp/social-auth/`, and stores project routing values such as subreddit and Telegram `chat_id` in `.usp.yml`.

Scripted setup is also available:

```bash
usp setup --platform telegram --account main -v botToken=123:abc
usp setup --platform x --account main \
  -v consumerKey=... \
  -v consumerSecret=... \
  -v accessToken=... \
  -v accessTokenSecret=...
```

Markdown images are extracted with normal syntax:

```markdown
Text for the first part.

![Chart showing the change](./chart.png)

Text that may become the next tweet or message.
```

The LLM receives stable media IDs such as `img1`, and the generated plan attaches those IDs to exact post units.

## Configuration

`usp` merges global config from `~/.config/usp/config.yml`, social auth files from `~/.config/usp/social-auth/*.yml`, and project config from `.usp.yml` or `usp.config.yml`. Project config wins.

Social credentials should live in `~/.config/usp/social-auth/` when saved by the wizard or `account:set`. They can also be provided through `*_Env` fields, environment variables, or CLI overrides:

```bash
usp account:set telegram main -v botToken=123:abc
usp publish post.md --set accounts.telegram.main.botToken=123:abc
```

Example `.usp.yml`:

```yaml
llm:
  provider: gemini
  model: gemini-2.5-flash-lite
  apiKeyEnv: GEMINI_API_KEY

profiles:
  default:
    targets: [x-main, linkedin-me, reddit-release, telegram-channel]

targets:
  x-main:
    platform: x
    account: main
  linkedin-me:
    platform: linkedin
    account: me
  reddit-release:
    platform: reddit
    account: main
    subreddit: reddit_api_test
  telegram-channel:
    platform: telegram
    account: main
    chatId: $TELEGRAM_CHAT_ID
```

## LLM Providers

LLM credentials are required. Supported providers:

- `gemini`, default env `GEMINI_API_KEY`
- `openai`, default env `OPENAI_API_KEY`, or Codex browser login via `~/.codex/auth.json`
- `anthropic`, default env `ANTHROPIC_API_KEY`, or Claude Code token via `ANTHROPIC_AUTH_TOKEN`

OpenAI with Codex browser login:

```bash
codex login
usp setup
```

In the LLM section, choose OpenAI, then “Use Codex browser login”. The project config will use:

```yaml
llm:
  provider: openai
  model: gpt-5.4-mini
  authSource: codex
```

Anthropic setup:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5
  apiKeyEnv: ANTHROPIC_API_KEY
```

Claude Code token setup:

```bash
claude setup-token
export ANTHROPIC_AUTH_TOKEN=<result>
usp setup
```

In the LLM section, choose Anthropic, then “Use ANTHROPIC_AUTH_TOKEN” or “Paste Claude setup-token result”.

Then run:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
usp publish ./post.md --dry-run
```

Or point the generated config at Anthropic:

```bash
usp publish ./post.md --dry-run \
  --set llm.provider=anthropic \
  --set llm.model=claude-sonnet-4-5 \
  --set llm.apiKeyEnv=ANTHROPIC_API_KEY
```

Custom prompts can be configured globally per platform:

```yaml
prompts:
  x: |
    Return JSON only. Create a restrained X thread under 280 chars per unit.
    Attach mediaRefs to the exact tweet that needs the image.
```

Or per target:

```yaml
targets:
  x-main:
    platform: x
    account: main
    prompt: |
      Return JSON only. Write in the maintainer's voice.
```

## Platform Credentials

### X

Recommended for media posts:

```yaml
accounts:
  x:
    main:
      consumerKeyEnv: X_CONSUMER_KEY
      consumerSecretEnv: X_CONSUMER_SECRET
      accessTokenEnv: X_ACCESS_TOKEN
      accessTokenSecretEnv: X_ACCESS_TOKEN_SECRET
```

OAuth2 user access token is supported for text-only posts:

```yaml
oauth2AccessTokenEnv: X_OAUTH2_ACCESS_TOKEN
```

### LinkedIn

Personal profile posting requires an access token with write permission and the profile author URN:

```yaml
accounts:
  linkedin:
    me:
      accessTokenEnv: LINKEDIN_ACCESS_TOKEN
      author: urn:li:person:YOUR_PERSON_ID
      version: "202602"
```

### Reddit

Use OAuth credentials with the `submit` scope. A refresh token is preferred for CI.

```yaml
accounts:
  reddit:
    main:
      clientIdEnv: REDDIT_CLIENT_ID
      clientSecretEnv: REDDIT_CLIENT_SECRET
      refreshTokenEnv: REDDIT_REFRESH_TOKEN
      userAgent: usp/0.1.0 by YOUR_REDDIT_USERNAME
```

Reddit publishing uses the stable OAuth `/api/submit` self-post flow. Local image files are referenced in the body with a warning because native local image upload is not exposed as a stable standard submit API. Public image URLs remain as Markdown image links.

### Telegram

```yaml
accounts:
  telegram:
    main:
      botTokenEnv: TELEGRAM_BOT_TOKEN
```

The target `chatId` may be a channel, group, private chat, or an env reference like `$TELEGRAM_CHAT_ID`.

## Commands

```bash
usp init
usp setup
usp setup --platform telegram --account main -v botToken=123:abc
usp account:set <platform> <name> -v key=value
usp plan <post.md> --profile default
usp publish <post.md> --profile default --dry-run
usp publish <post.md> --target x-main --json
```

Use `usp init` when you only want to create `.usp.yml`. Use `usp setup` for the normal first run; it creates `.usp.yml` if needed and then configures credentials.

## GitHub Action

This repository includes a composite action. In another workflow:

```yaml
- uses: adamarutyunov/usp@v0.1.0
  with:
    markdown: ./post.md
    config: .usp.yml
    profile: default
    json: "true"
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    X_CONSUMER_KEY: ${{ secrets.X_CONSUMER_KEY }}
    X_CONSUMER_SECRET: ${{ secrets.X_CONSUMER_SECRET }}
    X_ACCESS_TOKEN: ${{ secrets.X_ACCESS_TOKEN }}
    X_ACCESS_TOKEN_SECRET: ${{ secrets.X_ACCESS_TOKEN_SECRET }}
```

For release automation, Homer should compose or write the release Markdown and then call `usp` as the publishing CLI. See [examples/homer-release.yml](examples/homer-release.yml).
