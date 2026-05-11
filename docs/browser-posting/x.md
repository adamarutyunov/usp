# X Browser Posting

Status: exploratory deterministic browser method.

This flow uses a dedicated browser profile. It should not use the user's normal Chrome profile.

## Login

```bash
usp login x
```

Default browser: production Google Chrome.

After sign-in, keep the Chrome window open and press Enter in the terminal only after `x.com/home` shows the logged-in account. `usp login` verifies X auth, then closes Chrome. Browser posting will fail if a Chrome window is still using the same profile.

Default profile:

```text
~/.config/usp/browser-auth/x/main/
```

Profile metadata:

```text
~/.config/usp/social-auth/browser.yml
```

## Test Command

Dry run opens compose and fills text without clicking Post:

```bash
usp browser:post x --text "Testing Ultimate Social Poster browser posting." --dry-run
```

Browser posting runs headless by default after login. Use `--headed` when debugging selectors:

```bash
usp browser:post x --text "Testing Ultimate Social Poster browser posting." --dry-run --headed
```

Real post requires explicit confirmation:

```bash
usp browser:post x --text "Testing Ultimate Social Poster browser posting." --yes
```

Thread dry run:

```bash
usp browser:post x \
  --thread "First post" \
  --thread "Second post" \
  --dry-run
```

Media dry run:

```bash
usp browser:post x \
  --text "Post with media" \
  --media ./image.png \
  --dry-run
```

When the number of `--thread` entries equals the number of `--media` entries, the CLI maps them one-to-one:

```bash
usp browser:post x \
  --thread "First post" \
  --thread "Second post" \
  --media ./first.png \
  --media ./second.png \
  --dry-run
```

Headless can be explicit too:

```bash
usp browser:post x --text "Testing Ultimate Social Poster browser posting." --headless --yes
```

## Deterministic Steps

1. Launch normal Google Chrome with the X account profile and a local remote debugging port.
2. Attach Playwright over Chrome DevTools Protocol.
3. Verify X auth by checking for `auth_token` and `ct0` cookies for `x.com`/`twitter.com`.
4. Navigate to `https://x.com/home`.
5. If cookies are missing, verify logged-in state with one of:
   - `[data-testid="SideNav_NewTweet_Button"]`
   - `[data-testid="SideNav_AccountSwitcher_Button"]`
   - `[data-testid="AppTabBar_Profile_Link"]`
6. Navigate to `https://x.com/compose/post`.
7. For each plan unit:
   - Wait for `[data-testid^="tweetTextarea_"]`.
   - Click the textarea for that unit.
   - Insert post text with keyboard input.
   - Verify that textarea contains the inserted text.
   - Attach that unit's media refs through `input[data-testid="fileInput"], input[type="file"]`.
   - If another unit follows, click `[data-testid="addButton"]`.
8. For dry run, stop here and close the browser.
9. For real posting, click one of:
   - `[data-testid="tweetButton"]`
   - `[data-testid="tweetButtonInline"]`
10. Wait briefly for X to accept the post.
11. If X does not navigate to `/status/<id>`, navigate to home and find the newest tweet article containing the first post text, then extract its `/status/<id>` link.

## Known Gaps

- Browser media upload has only been tested as dry run with a local PNG.
- Browser thread posting has only been tested as dry run.
- The current real-post confirmation is CLI-level `--yes`, not an in-browser preview confirmation.
- X may change `data-testid` selectors without notice.
- CDP-attached Chrome can leave stale `Singleton*` profile files after forced shutdown; usp removes stale singleton files when their recorded pid is gone.
