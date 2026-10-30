# Telegram Deep-Link Documentation

A documentation-only crawler and Telegram publisher for the official Telegram deep-link reference:

- Source: https://core.telegram.org/api/links
- Published channel: @TDeepLink (publication is currently being tested in the maintainer's private chat first)

## Scope

This project tracks only formats and paths explicitly documented on Telegram's official deep-link documentation website.

- No Telegram Android source crawling.
- No guessed or inferred undocumented routes.
- No internal handler tokens or unverified implementation candidates.
- Each record keeps its official documentation section, subsection, source URL, and extracted template.

## Generated data

- `data/documented-links.json` — extracted official documented templates.
- `data/documentation-catalog.json` — templates grouped by documentation category and subsection, including placeholders and query options.
- `data/publication-inventory.json` — flat publication index derived only from official documentation.
- `data/summary.json` — source hash and documentation-only counts.

## Telegram post format

The publisher creates readable posts grouped by the official documentation's own sections and subsections. Each post includes:

1. The documented URL/deep-link format.
2. A ready-made illustrative example with placeholder values filled in.
3. An expandable HTML blockquote listing query options and parameters extracted from the documented formats.
4. A link to the official documentation and the machine-readable catalog.

Examples are illustrative, not live links to real users, bots, chats, or content. Replace the values with your own. Only URL forms present in the official documentation are published; the publisher does not invent alternate schemes.

## Crawl reports

After each successful crawl, the bot sends a numbered report to the admin private chat. It reports new, changed, and removed documented formats, including an explicit no-changes message.

## Configuration

GitHub Actions repository secret:

- `TELEGRAM_BOT_TOKEN`

The current test destination is configured directly in the workflow as private chat ID `1314643983`. The channel destination is intentionally not used until the private-chat post format is approved.

## Run locally

```sh
npm install
npm run check
npm run crawl
npm run publish
```

To publish locally, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `PUBLISH_FULL_INVENTORY=true`.
