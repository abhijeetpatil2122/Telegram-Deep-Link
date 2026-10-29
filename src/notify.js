import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const INVENTORY_PATH = 'data/publication-inventory.json';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHANNEL_ID || '@TDeepLink';
const REPO_URL = 'https://github.com/abhijeetpatil2122/Telegram-Deep-Link';

function stableView(item) {
  return JSON.stringify({
    template: item.template, status: item.status, classification: item.classification,
    note: item.note, context: item.sourceContext?.map(line => line.text) || null
  });
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
  if (!response.ok || !result.ok) throw new Error('Telegram notification failed: ' + (result.description || response.status));
}

async function main() {
  if (!TOKEN) {
    console.log('Telegram notification skipped: configure the TELEGRAM_BOT_TOKEN repository secret to enable channel updates.');
    return;
  }
  const current = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
  let previous;
  try {
    previous = JSON.parse(execFileSync('git', ['show', 'HEAD:' + INVENTORY_PATH], { encoding: 'utf8' }));
  } catch {
    const summary = JSON.parse(await readFile('data/summary.json', 'utf8'));
    const counts = summary.counts;
    const baselineMessage = [
      '<b>Telegram Deep-Link Inventory is now being tracked</b>', '',
      'Baseline: <b>' + counts.documentedTemplates + '</b> official documented templates, <b>' + counts.androidCandidates + '</b> Android source candidates, and <b>' + counts.userConfirmedWorkingRuntimeLinks + '</b> maintainer-reported runtime-tested routes.', '',
      'Android candidates are included even when undocumented. Some are internal, partial, contextual, client/version-dependent, or unverified. Inclusion does not guarantee a link works or is publicly supported.', '',
      '<a href="' + REPO_URL + '/blob/main/data/publication-inventory.json">Open full inventory</a> · <a href="' + REPO_URL + '/blob/main/data/summary.json">Summary</a>'
    ].join(String.fromCharCode(10));
    await sendTelegram(baselineMessage);
    console.log('Initial Telegram inventory baseline notification sent.');
    return;
  }
  const before = new Map(previous.map(item => [item.id, item]));
  const after = new Map(current.map(item => [item.id, item]));
  const added = current.filter(item => !before.has(item.id));
  const removed = previous.filter(item => !after.has(item.id));
  const changed = current.filter(item => before.has(item.id) && stableView(item) !== stableView(before.get(item.id)));
  if (!added.length && !removed.length && !changed.length) {
    console.log('No publication inventory changes; no Telegram notification needed.');
    return;
  }
  const sections = [
    '<b>Telegram Deep-Link Inventory Update</b>', '',
    'New: <b>' + added.length + '</b> · Changed: <b>' + changed.length + '</b> · Removed: <b>' + removed.length + '</b>', '',
    'Includes official templates and implementation-derived Android candidates. Undocumented entries may be internal, partial, contextual, client/version-dependent, or unverified; inclusion does not guarantee that a link works or is publicly supported.', ''
  ];
  const entries = [
    ...added.map(item => ({ label: 'NEW', item })),
    ...changed.map(item => ({ label: 'UPDATED', item })),
    ...removed.map(item => ({ label: 'REMOVED', item }))
  ].slice(0, 12);
  for (const { label, item } of entries) {
    sections.push('• <b>' + label + '</b> <code>' + escapeHtml(item.template) + '</code>');
    sections.push('  <i>' + escapeHtml(item.status || item.classification || item.kind) + '</i>');
  }
  const total = added.length + changed.length + removed.length;
  if (total > entries.length) sections.push('', '…and ' + (total - entries.length) + ' more inventory changes.');
  sections.push('', '<a href="' + REPO_URL + '/blob/main/data/publication-inventory.json">Open full inventory</a> · <a href="' + REPO_URL + '/blob/main/data/summary.json">Summary</a>');
  const message = sections.join(String.fromCharCode(10));
  const response = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram notification failed: ' + (result.description || response.status));
  console.log('Telegram inventory notification sent. New=' + added.length + ', changed=' + changed.length + ', removed=' + removed.length + '.');
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
