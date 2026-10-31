# Telegram Deep Link Watcher

A small, reliable watcher for Telegram's official deep-link documentation.

## Sources

- HTML: https://corefork.telegram.org/api/links
- Markdown: https://corefork.telegram.org/api/links.md

Every run fetches both sources, extracts documented deep-link formats independently, and checks that their inventories substantially agree. A failed fetch, incomplete response, or source mismatch stops the run before publishing. Link families and their structured options are also cross-checked between HTML and Markdown before delivery.

## Behaviour

- The first successful run creates a baseline and does not flood the test chat with old entries.
- The initial full catalogue is delivered once, grouped by documentation family using Telegram Rich Messages.
- Each family message preserves its complete official description, syntax, parameter table, and lists.
- Rich messages are kept below 30,000 characters; oversized families are split in source order with the family heading repeated.
- Later runs publish only newly documented formats or changed family documentation.
- Existing formats are not reposted when unrelated documentation changes.
- The state is updated after each successful Telegram delivery so interrupted catalogue delivery resumes without repeating completed families.
- Failed runs leave undispatched entries available for the next run.
- Telegram destination is configured in the workflow and currently points to the private test chat.

## GitHub Actions secrets

- `TELEGRAM_BOT_TOKEN`: bot token with permission to send messages to the test chat.

The test chat ID is configured as a workflow variable, not a secret. Change it only when deliberately switching to production.

## Local use

Requires Node.js 20+.

```sh
npm install
npm run check
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=1314643983 npm run watch
```

## Workflow

GitHub Actions checks every 15 minutes and can also be started manually. It commits the verified catalogue and watcher state back to `main`.

No undocumented links are inferred or scraped from third-party sources.
