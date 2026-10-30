import { readFile, writeFile } from 'node:fs/promises';

const INVENTORY_PATH = 'data/publication-inventory.json';
const STATE_PATH = 'data/full-publication-state.json';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1314643983';
const REPO_URL = 'https://github.com/abhijeetpatil2122/Telegram-Deep-Link';
const LIMIT = 3400;

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function category(item) {
  if (item.kind === 'official-documented-template' || item.kind === 'documented-template' || item.kind?.includes('documented')) return 'Official documented templates';
  if (item.status === 'user-confirmed-working' || item.kind === 'runtime-supported-action') return 'Maintainer-reported runtime-tested routes';
  return 'Android source candidates and implementation-derived observations';
}

function renderEntry(item) {
  const lines = ['• <code>' + escapeHtml(item.template || '(raw observation)') + '</code>'];
  const meta = [item.status, item.classification].filter(Boolean).join(' · ');
  if (meta) lines.push('  <i>' + escapeHtml(meta) + '</i>');
  if (item.note) lines.push('  ' + escapeHtml(String(item.note).slice(0, 220)));
  if (item.sourceUrl) {
    const url = item.sourceUrl + (item.line ? '#L' + item.line : '');
    lines.push('  <a href="' + escapeHtml(url) + '">Source' + (item.line ? ' · line ' + item.line : '') + '</a>');
  }
  return lines.join('\n');
}

async function sendTelegram(text) {
  const response = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram publication failed: ' + (result.description || response.status));
}

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  if (process.env.PUBLISH_FULL_INVENTORY !== 'true') {
    console.log('Full inventory publication is not enabled for this run.');
    return;
  }

  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    if (state.completed === true) {
      console.log('Full inventory was already published successfully; skipping duplicate publication.');
      return;
    }
  } catch {}

  const inventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
  const groups = [
    'Official documented templates',
    'Maintainer-reported runtime-tested routes',
    'Android source candidates and implementation-derived observations'
  ];
  const messages = [];
  for (const group of groups) {
    const items = inventory.filter(item => category(item) === group);
    if (!items.length) continue;
    let batch = [];
    let body = '';
    for (const item of items) {
      const rendered = renderEntry(item);
      if (body && (body.length + rendered.length + 2 > LIMIT || batch.length >= 7)) {
        messages.push({ group, body, count: batch.length });
        batch = [];
        body = '';
      }
      batch.push(item);
      body += (body ? '\n\n' : '') + rendered;
    }
    if (body) messages.push({ group, body, count: batch.length });
  }

  const counts = {
    official: inventory.filter(item => category(item) === groups[0]).length,
    runtime: inventory.filter(item => category(item) === groups[1]).length,
    android: inventory.filter(item => category(item) === groups[2]).length
  };
  await sendTelegram([
    '<b>Telegram Deep-Link Inventory — Full Publication</b>',
    '',
    'This is the initial inventory publication, not a crawl-change alert.',
    'Entries: <b>' + inventory.length + '</b> total · <b>' + counts.official + '</b> official · <b>' + counts.android + '</b> Android-derived · <b>' + counts.runtime + '</b> runtime-tested.',
    '',
    'Android-derived observations may be undocumented, internal, partial, contextual, client/version-dependent, or unverified. Raw fragments and route prefixes are shown as observations, not guaranteed ready-to-use links.',
    '',
    'The following messages contain the complete collected inventory, split into sections and batches.',
    '<a href="' + REPO_URL + '/blob/main/data/publication-inventory.json">Machine-readable full inventory</a>'
  ].join('\n'));

  for (let i = 0; i < messages.length; i++) {
    const part = messages[i];
    const heading = '<b>' + escapeHtml(part.group) + '</b> · part ' + (i + 1) + '/' + messages.length + ' · ' + part.count + ' entries';
    await sendTelegram(heading + '\n\n' + part.body);
    console.log('Published batch ' + (i + 1) + '/' + messages.length + ' (' + part.group + ').');
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  await sendTelegram('<b>Full inventory publication completed</b>\nAll <b>' + inventory.length + '</b> inventory entries have been sent in ' + messages.length + ' batches. Ongoing crawl reports will be sent separately to this private chat.');
  await writeFile(STATE_PATH, JSON.stringify({
    completed: true,
    completedAt: new Date().toISOString(),
    totalEntries: inventory.length,
    batches: messages.length,
    counts
  }, null, 2) + '\n', 'utf8');
  console.log('Full inventory publication completed successfully.');
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
