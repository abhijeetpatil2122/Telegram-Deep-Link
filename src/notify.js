import { readFile, writeFile } from 'node:fs/promises';

const INVENTORY_PATH = 'data/publication-inventory.json';
const STATE_PATH = 'data/notification-state.json';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1314643983';
const REPO_URL = 'https://github.com/abhijeetpatil21222/Telegram-Deep-Link';
const RUN_NUMBER = process.env.GITHUB_RUN_NUMBER || 'unknown';

function stableView(item) {
  return JSON.stringify({
    template: item.template, status: item.status, classification: item.classification,
    note: item.note, context: item.sourceContext?.map(line => line.text) || null
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function writeNotificationState(items) {
  const inventory = items.map(item => ({
    id: item.id, template: item.template, kind: item.kind,
    status: item.status, classification: item.classification, note: item.note,
    sourceContext: item.sourceContext?.map(line => ({ text: line.text })) || null
  }));
  await writeFile(STATE_PATH, JSON.stringify({
    notifiedAt: new Date().toISOString(),
    inventory
  }, null, 2) + '\n', 'utf8');
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

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  const current = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
  const summary = JSON.parse(await readFile('data/summary.json', 'utf8'));
  const counts = summary.counts;
  let previous = null;
  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    previous = state.inventory;
  } catch {}

  if (!previous) {
    const message = [
      '<b>Crawl #' + escapeHtml(RUN_NUMBER) + ' completed</b>', '',
      'Initial tracking baseline recorded.',
      'Inventory: <b>' + counts.documentedTemplates + '</b> official templates · <b>' + counts.androidCandidates + '</b> Android candidates · <b>' + counts.userConfirmedWorkingRuntimeLinks + '</b> runtime-tested routes.',
      '',
      'No previous notification snapshot was available for a change comparison.',
      '<a href="' + REPO_URL + '/blob/main/data/publication-inventory.json">Open full inventory</a>'
    ].join('\n');
    await sendTelegram(message);
    await writeNotificationState(current);
    console.log('Initial crawl status report sent.');
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
    'Inventory: <b>' + counts.documentedTemplates + '</b> official · <b>' + counts.androidCandidates + '</b> Android candidates · <b>' + counts.userConfirmedWorkingRuntimeLinks + '</b> runtime-tested routes.',
    '',
    'Changes: <b>' + added.length + '</b> new · <b>' + changed.length + '</b> updated · <b>' + removed.length + '</b> removed.'
  ];

  const entries = [
    ...added.map(item => ({ label: 'NEW', item })),
    ...changed.map(item => ({ label: 'UPDATED', item })),
    ...removed.map(item => ({ label: 'REMOVED', item }))
  ].slice(0, 10);

  if (!entries.length) {
    lines.push('', 'No inventory changes detected in this crawl.');
  } else {
    lines.push('');
    for (const { label, item } of entries) {
      lines.push('• <b>' + label + '</b> <code>' + escapeHtml(item.template) + '</code>');
      lines.push('  <i>' + escapeHtml(item.status || item.classification || item.kind) + '</i>');
    }
    const total = added.length + changed.length + removed.length;
    if (total > entries.length) lines.push('…and ' + (total - entries.length) + ' more changes.');
  }

  lines.push('', '<a href="' + REPO_URL + '/blob/main/data/publication-inventory.json">Full inventory</a> · <a href="' + REPO_URL + '/actions">Crawl history</a>');
  await sendTelegram(lines.join('\n'));
  await writeNotificationState(current);
  console.log('Crawl #' + RUN_NUMBER + ' status report sent. New=' + added.length + ', changed=' + changed.length + ', removed=' + removed.length + '.');
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
