# Telegram Deep-Link Documentation

A crawler and Telegram publisher for the official Telegram deep-link reference.

## Source and scope

The only source is Telegram's official deep-link documentation at https://core.telegram.org/api/links (including its machine-readable Markdown endpoint).

The parser preserves the page structure instead of treating it as a list of URL strings. It extracts:
- Section and subsection headings
- Every documented deep-link format in code samples
- Parameter tables, including required/optional status and descriptions
- Enumerated values and supported paths
- Settings paths and other documented option lists

No Android source scraping, inferred routes, or undocumented handler names are included.

## Generated data

- `data/documented-links.json` — normalized list of documented formats.
- `data/documentation-catalog.json` — structured sections, formats, parameters, and documented option values.
- `data/publication-inventory.json` — flat change-detection inventory.
- `data/summary.json` — source fingerprint and extraction counts.

## Telegram publishing

Posts are sent to the maintainer's private chat `1314643983` while formatting is being tested. The channel is not used.

Post style:
- Clean, plain-text format lists using hyphen bullets.
- Ready-made example links.
- Parameter definitions and supported values inside expandable blockquotes.
- Monospace is used only inside expandable details.
- No source URLs, repository links, parser notes, or placeholder boilerplate in posts.

Long sections are split into multiple messages to respect Telegram's message limit without dropping formats or options.

## Configuration

Required GitHub Actions secret:
- `TELEGRAM_BOT_TOKEN`

The private test destination is configured in `.github/workflows/crawl.yml`. Do not switch to the channel until the private-chat output is approved.

## Local commands

```sh
npm install
npm run check
npm run crawl
npm run publish
```

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `PUBLISH_FULL_INVENTORY=true` to test publication.
