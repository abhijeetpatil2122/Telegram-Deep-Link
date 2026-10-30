import { readFile, writeFile } from 'node:fs/promises';

const INVENTORY_PATH = 'data/publication-inventory.json';
const STATE_PATH = 'data/documentation-notification-state.json';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1314643983';
const REPO_URL = 'https://github.com/abhijeetpatil2122/Telegram-Deep-Link';
const RUN_NUMBER = process.env.GITHUB_RUN_NUMBER || 'unknown';

function stableView(item) {
  return JSON.stringify({ template: item.template, category: item.category, group: item.group, placeholders: item.placeholders, options: item.options });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(message) {
  const response = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram crawl report failed: ' + (result.description || response.status));
}

async function saveState(items) {
  await writeFile(STATE_PATH, JSON.stringify({
    notifiedAt: new Date().toISOString(),
    inventory: items.map(item => ({
      id: item.id, template: item.template, category: item.category,
      group: item.group, placeholders: item.placeholders, options: item.options
    }))
  }, null, 2) + '\n', 'utf8');
}

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  const current = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
  const summary = JSON.parse(await readFile('data/summary.json', 'utf8'));
  let previous = null;
  try { previous = JSON.parse(await readFile(STATE_PATH, 'utf8')).inventory; } catch {}

  if (!previous) {
    await sendTelegram([
      '<b>Crawl #' + escapeHtml(RUN_NUMBER) + ' completed</b>', '',
      'Status: <b>Success</b>',
      'Tracking baseline initialized for the official Telegram documentation website.',
      'Current catalog: <b>' + summary.counts.documentedTemplates + '</b> documented formats across <b>' + summary.counts.documentationGroups + '</b> groups.',
      '',
      'Android source candidates and undocumented routes are excluded from this project scope.',
      '<a href="' + REPO_URL + '/blob/main/data/documentation-catalog.json">Open documentation catalog</a>'
    ].join('\n'));
    await saveState(current);
    console.log('Documentation crawl baseline report sent.');
    return;
  }

  const before = new Map(previous.map(item => [item.id, item]));
  const after = new Map(current.map(item => [item.id, item]));
  const added = current.filter(item => !before.has(item.id));
  const removed = previous.filter(item => !after.has(item.id));
  const changed = current.filter(item => before.has(item.id) && stableView(item) !== stableView(before.get(item.id)));

  const lines = [
    '<b>Crawl #' + escapeHtml(RUN_NUMBER) + ' completed</b>', '',
    'Status: <b>Success</b>',
    'Official documented formats: <b>' + summary.counts.documentedTemplates + '</b> · Groups: <b>' + summary.counts.documentationGroups + '</b>',
    '',
    'Changes: <b>' + added.length + '</b> new · <b>' + changed.length + '</b> updated · <b>' + removed.length + '</b> removed.'
  ];
  const entries = [
    ...added.map(item => ({ label: 'NEW', item })),
    ...changed.map(item => ({ label: 'UPDATED', item })),
    ...removed.map(item => ({ label: 'REMOVED', item }))
  ].slice(0, 12);

  if (!entries.length) lines.push('', 'No documented-link changes detected in this crawl.');
  else {
    lines.push('');
    for (const { label, item } of entries) {
      lines.push('• <b>' + label + '</b> <code>' + escapeHtml(item.template) + '</code>');
      lines.push('  <i>' + escapeHtml(item.category || 'Telegram links') + (item.group ? ' · ' + escapeHtml(item.group) : '') + '</i>');
    }
    const total = added.length + changed.length + removed.length;
    if (total > entries.length) lines.push('…and ' + (total - entries.length) + ' more changes.');
  }
  lines.push('', '<a href="' + REPO_URL + '/blob/main/data/documentation-catalog.json">Documentation catalog</a> · <a href="' + REPO_URL + '/actions">Crawl history</a>');
  await sendTelegram(lines.join('\n'));
  await saveState(current);
  console.log('Crawl #' + RUN_NUMBER + ' report sent. New=' + added.length + ', changed=' + changed.length + ', removed=' + removed.length + '.');
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
