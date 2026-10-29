# Telegram Deep Link

Crawler for collecting Telegram deep-link templates for the **@TDeepLink** channel.

## Sources

1. **Primary:** [Official Markdown documentation](https://corefork.telegram.org/api/links.md)
2. **Secondary:** [Telegram Android `LaunchActivity.java`](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/LaunchActivity.java)

The official docs are the baseline. Android source is scanned for additional implementation-handled routes and parameters.

## What the crawler does

- Extracts link templates from Markdown code spans, fenced examples, and documented settings paths.
- Scans the Android source for literal URI patterns and URL-handler strings.
- Keeps official documentation entries separate from Android-only candidates.
- Stores source URLs, line numbers, hashes, and review status.
- Runs manually or on a daily GitHub Actions schedule.

## Run locally

Requires Node.js 20 or newer.

```sh
npm run check
npm run crawl
```

Outputs are generated under `data/`:

- `documented-links.json` — official documentation inventory.
- `android-candidates.json` — source-derived candidates; review before publication.
- `summary.json` — source hashes and extraction counts.

The crawler does not invent concrete usernames, IDs, tokens, invite hashes, or other required values. It records templates as documented. Telegram publishing is not enabled yet; we will add it after reviewing extraction quality.
