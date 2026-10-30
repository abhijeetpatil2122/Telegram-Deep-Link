# Telegram Deep-Link Documentation

A structured crawler and Rich Message publisher for Telegram's official deep-link reference.

## Source

The project reads only the official Telegram deep-link documentation:
- https://core.telegram.org/api/links
- Its machine-readable Markdown representation.

## Extraction

The crawler preserves the documentation hierarchy and extracts:
- Section and subsection headings
- Deep-link formats and examples
- Parameter names, required/optional status, types and descriptions
- Enumerated values and supported paths
- Inline documentation references and links

No Android source scraping, inferred routes, or undocumented handlers are included.

## Rich Message publishing

Documentation is sent with Telegram Bot API `sendRichMessage` using structured `InputRichMessage.blocks`.

- Original documentation section title as the heading; no numbered post counters.
- Introductory descriptions rendered as rich paragraphs.
- Format and example links shown in a compact table.
- Example URLs are displayed as their actual full URLs, not generic “Open example” labels.
- Parameter definitions rendered in expandable tables.
- Supported paths and enumerated values rendered in expandable lists.
- Internal documentation links are normalized to canonical `https://core.telegram.org/...` URLs.
- Telegram links are normalized to HTTPS where appropriate; `tg://` and TON schemes are preserved.
- No source footer, repository footer, placeholder boilerplate, or generic publication summary.

Long sections are split only when required by Telegram Rich Message limits. No format or parameter is intentionally truncated.

## Crawl notifications

Crawl reports are also sent using Rich Message blocks and tables. They summarize totals and list added, updated, and removed formats.

## Destination

All current tests target private chat `1314643983`. The publication workflow does not send to the channel until the private-chat output is approved.

## Configuration

Required GitHub Actions secret:
- `TELEGRAM_BOT_TOKEN`

The workflow uses the Bot API `sendRichMessage` method. The bot must have access to this method in its configured Bot API environment.

## Local commands

```sh
npm install
npm run check
npm run crawl
npm run publish
npm run notify
```

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `PUBLISH_FULL_INVENTORY=true` to test full publication.
