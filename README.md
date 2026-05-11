# Ultimate Social Poster

Ultimate Social Poster (`usp`) turns Markdown into platform-specific posts for X, LinkedIn, Reddit, and Telegram.

The code is organized as a four-stage pipeline:

```text
Input -> Prompt -> LLM -> Posting
```

Each stage has a small interface so new sources, prompt strategies, model providers, and social integrations can be added without changing the whole CLI.

## Install

Use the install script:

```sh
curl -fsSL https://raw.githubusercontent.com/adamarutyunov/usp/main/install.sh | sh
```

Or install a specific ref:

```sh
VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/adamarutyunov/usp/main/install.sh | sh
```

The script installs the CLI globally and installs Playwright Chromium as a fallback browser. `usp login` uses your installed Google Chrome by default because some providers reject bundled automation browsers during sign-in.

Package install:

```bash
npm install -g usp
npx playwright install chromium
```

Install Google Chrome too if you do not already have it. It is the default browser for `usp login`.

Local development:

```bash
cd ~/code/usp
npm install
npm run build
npm link
npx playwright install chromium
usp --help
```

## Quick Start

```bash
usp setup
usp login x
usp publish ./post.md --dry-run
usp publish ./post.md
```

`usp setup` creates `.usp.yml` if needed, then opens a guided terminal wizard. It stores social credentials under `~/.config/usp/social-auth/` and keeps project routing, such as targets and subreddit/chat IDs, in `.usp.yml`.

`usp login` opens the normal Google Chrome app using a dedicated persistent profile. Sign in once, keep the window open, and press Enter in the terminal after `x.com/home` shows your logged-in account. The command verifies the logged-in UI, closes Chrome, and future browser-based posting methods can reuse that saved session.

By default, login uses production Google Chrome with a separate usp profile:

```bash
usp login x
usp login linkedin
```

Use the bundled Playwright Chromium only when you want the fallback browser:

```bash
usp login x --browser chromium
```

Use Playwright-controlled Chrome only for debugging:

```bash
usp login x --controlled
```

Headless mode is available for already-authenticated profiles, but first-time login should use normal headed Chrome so you can complete 2FA and anti-abuse checks:

```bash
usp login x --headless
```

Browser posting defaults to headless after login. Use `--headed` only when debugging browser posting:

```bash
usp browser:post x --text "Testing Ultimate Social Poster browser posting." --dry-run --headed
```

## Pipeline Layers

### 1. Input

Input is normalized into one internal Markdown document with ordered media references.

Supported sources:

```bash
usp publish ./post.md
usp publish --input "# Title\n\nPost body"
cat post.md | usp publish --stdin
```

Markdown images use normal syntax and keep their position:

```markdown
Text for the first post.

![Chart alt text](./chart.png)

Text for the next post.
```

Implementation entry points:

- `InputSource`
- `MarkdownFileInputSource`
- `MarkdownTextInputSource`
- `StdinMarkdownInputSource`

### 2. Prompt

Prompts are resolved per platform from defaults, config, target config, and CLI overrides.

Config-level prompts:

```yaml
prompts:
  x: |
    Return JSON only. Make this terse and factual.
```

Target-level prompt:

```yaml
targets:
  x-main:
    platform: x
    account: main
    prompt: |
      Return JSON only. Use the maintainer's voice.
```

CLI overrides:

```bash
usp publish post.md --prompt 'x:replace:Return JSON only. Write one dry tweet.'
usp publish post.md --prompt 'linkedin:append:End with a concrete question.'
usp publish post.md --prompt 'reddit:Write a practical self-post.'
```

Syntax:

```text
--prompt platform:replace:text
--prompt platform:append:text
--prompt platform:text
```

`platform:text` is shorthand for replacing that platform prompt.

Implementation entry points:

- `PromptProvider`
- `ConfigPromptProvider`
- `DEFAULT_PLATFORM_PROMPTS`

### 3. LLM

The LLM stage receives the final prompt and returns parsed JSON for a platform plan.

Supported providers:

- `gemini`
- `openai`
- `anthropic`

Example:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5
  apiKeyEnv: ANTHROPIC_API_KEY
```

OpenAI can use Codex browser login:

```bash
codex login
usp setup
```

Choose OpenAI, then Codex browser login. The project config uses:

```yaml
llm:
  provider: openai
  model: gpt-5.4-mini
  authSource: codex
```

Claude setup-token can be pasted in the wizard:

```bash
claude setup-token
usp setup
```

Implementation entry points:

- `LlmProcessor`
- `JsonLlmProcessor`
- `createLlmClient`

### 4. Posting

The posting stage receives a platform plan and publishes through an isolated adapter.

Current posters:

- X
- LinkedIn personal profile
- Reddit self-post
- Telegram chat/channel/group

One platform failing does not stop the rest. The CLI shows progress:

```text
Preparing text for X...
X text:
...
Posting to X...
Error posting to X: ...
Preparing text for Telegram...
...
Successfully posted to Telegram
```

Implementation entry points:

- `Poster`
- `AdapterPoster`
- `src/adapters/x.ts`
- `src/adapters/linkedin.ts`
- `src/adapters/reddit.ts`
- `src/adapters/telegram.ts`

Browser-based posting methods use Playwright persistent profiles saved outside the project:

```bash
usp login x
usp login linkedin
usp login reddit
```

If Playwright has not installed a browser yet, run:

```bash
npx playwright install chromium
```

`usp login` defaults to the normal Google Chrome app, not a Playwright-controlled Chrome window, because Google and some social login flows can reject controlled automation browsers with messages such as “This browser or app may not be secure.” Playwright Chromium remains available as `--browser chromium`, and controlled Chrome as `--controlled`.

Default profile locations:

```text
~/.config/usp/browser-auth/x/main/
~/.config/usp/browser-auth/linkedin/me/
~/.config/usp/browser-auth/reddit/main/
```

Metadata for those profiles is saved in:

```text
~/.config/usp/social-auth/browser.yml
```

The intended posting cascade is configurable per platform. X can prefer deterministic browser automation first because it avoids paid API limits, while API-first platforms can try API before browser fallbacks:

```yaml
posting:
  x:
    methods: [browser-deterministic, api, browser-ai]
  linkedin:
    methods: [api, browser-deterministic, browser-ai]
  reddit:
    methods: [api, browser-deterministic, browser-ai]
  telegram:
    methods: [api]
```

The browser posting model is deliberately closer to projects like `profullstack/social-poster`: login through a browser once, persist session state, then reuse that state for posting. `usp` stores a full persistent browser profile per platform/account instead of only a JSON cookie dump, because modern social sites often rely on cookies, local storage, IndexedDB, device checks, and session continuity.

## Configuration

`usp` merges config in this order:

```text
~/.config/usp/config.yml
.usp.yml or usp.config.yml
~/.config/usp/social-auth/*.yml
--set key=value
```

Social auth wins over project config so generated project placeholders cannot override real saved tokens.

Example `.usp.yml`:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5
  apiKeyEnv: ANTHROPIC_API_KEY

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

Credentials saved by `usp setup` or `usp account:set` live in files like:

```text
~/.config/usp/social-auth/x.yml
~/.config/usp/social-auth/linkedin.yml
~/.config/usp/social-auth/llm.yml
```

## Setup

Interactive setup:

```bash
usp setup
```

Scripted setup:

```bash
usp setup --platform telegram -v botToken=123:abc
usp setup --platform x \
  -v consumerKey=... \
  -v consumerSecret=... \
  -v accessToken=... \
  -v accessTokenSecret=...
```

Direct account edit:

```bash
usp account:set telegram main -v botToken=123:abc
```

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

`POST /2/tweets` can fail with X billing/credit errors even when credentials are valid.

### LinkedIn

Personal profile posting requires `w_member_social`, an access token, and a person URN:

```yaml
accounts:
  linkedin:
    me:
      accessToken: ...
      author: urn:li:person:...
      version: "202602"
```

LinkedIn setup is painful; this walkthrough is useful:

https://marcusnoble.co.uk/2025-02-02-posting-to-linkedin-via-the-api/

### Reddit

Reddit uses OAuth `/api/submit` self-posts. Local image files are referenced in the body with a warning because native local image upload is not exposed as a stable standard submit API.

### Telegram

Telegram needs a bot token and `chatId`. The chat can be a channel, group, or private chat.

## Commands

```bash
usp init
usp setup
usp login [x|linkedin|reddit|telegram]
usp plan [post.md] --profile default
usp publish [post.md] --profile default --dry-run
usp publish --stdin --target telegram-channel
usp publish --input "# Title\n\nPost body" --json
```

## GitHub Action

```yaml
- uses: adamarutyunov/usp@v0.1.0
  with:
    markdown: ./post.md
    config: .usp.yml
    profile: default
    json: "true"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    X_CONSUMER_KEY: ${{ secrets.X_CONSUMER_KEY }}
    X_CONSUMER_SECRET: ${{ secrets.X_CONSUMER_SECRET }}
    X_ACCESS_TOKEN: ${{ secrets.X_ACCESS_TOKEN }}
    X_ACCESS_TOKEN_SECRET: ${{ secrets.X_ACCESS_TOKEN_SECRET }}
```

For release automation, Homer should compose or write the release Markdown and then call `usp` as the publishing CLI. See [examples/homer-release.yml](examples/homer-release.yml).
