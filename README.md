# Telegram Deep Link

Crawler for collecting Telegram deep-link templates for the **@TDeepLink** channel.

## Sources

1. **Primary:** [Official Telegram deep-link documentation](https://core.telegram.org/api/links) — fetched from the direct HTML webpage, not the machine-readable `.md` endpoint.
2. **Secondary:** [Telegram Android `LaunchActivity.java`](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/LaunchActivity.java)

The official website is the baseline. Its HTML is converted into a lightweight Markdown-like representation for extraction. Android source is scanned for additional implementation-handled routes and parameters; those candidates are marked for review rather than treated as official documentation.

## What the crawler does

- Fetches and validates the direct official documentation webpage.
- Extracts link templates from code spans, fenced examples, and documented settings paths.
- Scans Android source for literal URI patterns and URL-handler strings.
- Keeps official documentation entries separate from Android-only candidates.
- Stores source URLs, line numbers, hashes, and review status.
- Runs manually, on pushes to `main`, and on a daily GitHub Actions schedule.
- Commits generated inventory files to `data/` when they change.

## Deep-link fallback: `help.getDeepLinkInfo`

Telegram's `help.getDeepLinkInfo` is an MTProto method, not a configuration setting and not itself a deep-link template. Official clients use it when they encounter an unsupported `tg:` link: the client sends the link's **path component** (not the full URL) and Telegram may return a message explaining the link or that an app update is required. The method is user-only; bots cannot invoke it.

- [Official method reference](https://core.telegram.org/method/help.getDeepLinkInfo)
- [Official deep-link behavior and examples](https://core.telegram.org/api/links#unsupported-links)
- [Official `help.DeepLinkInfo` result type](https://core.telegram.org/type/help.DeepLinkInfo)

This is useful context for our project because it describes the fallback behavior for unknown `tg:` schemes. It should be documented as protocol behavior, not added to the URL-template inventory as though it were a link pattern. We can later add a separate protocol-notes inventory if we decide to track methods and client-handling rules alongside templates.

## Android candidate review

Android-derived entries now receive heuristic fields (`candidateType`, `category`, `classification`, `classificationMethod`, and `reviewNote`) to make manual review easier. These labels are not proof that a route is supported or public. In particular, query fragments such as `?disablelogs` and handler tokens such as `new_dialog` must not be published as complete deep links without confirming their calling context. All Android-derived entries remain marked `needs_review`.

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

The crawler does not invent concrete usernames, IDs, tokens, invite hashes, or other required values. Android-only candidates need review before publishing. Telegram channel publishing is not enabled yet; extraction quality should be reviewed first.
