const API = 'https://api.telegram.org';
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

function familyHeaders(family) {
  const roots = new Set();
  for (const template of family.templates || []) {
    const match = template.match(/^tg:\/\/([a-z0-9_]+)/i);
    if (match) { roots.add('tg:' + match[1]); roots.add('tg://' + match[1]); }
  }
  for (const link of family.ready || []) {
    const match = link.match(/^tg:\/\/([a-z0-9_]+)/i);
    if (match) { roots.add('tg:' + match[1]); roots.add('tg://' + match[1]); }
  }
  return [...roots];
}

function linkLine(link) {
  const safe = escapeHtml(link);
  return '<a href="' + safe + '">' + safe + '</a>';
}

function renderFamilyMessages(family) {
  const headers = familyHeaders(family);
  const options = unique(family.options);
  const ready = unique(family.ready);
  const optionChunks = [];
  const readyChunks = [];
  const chunkSize = 18;
  for (let i = 0; i < options.length; i += chunkSize) optionChunks.push(options.slice(i, i + chunkSize));
  for (let i = 0; i < ready.length; i += chunkSize) readyChunks.push(ready.slice(i, i + chunkSize));
  const pages = Math.max(1, optionChunks.length, readyChunks.length);
  const messages = [];
  for (let i = 0; i < pages; i++) {
    const lines = [];
    if (headers.length) lines.push(...headers);
    else if (family.templates?.length) lines.push(...family.templates.slice(0, 2));
    const optionLines = optionChunks[i] || [];
    const readyLines = readyChunks[i] || [];
    if (options.length) lines.push('<blockquote expandable>Options:\n' + optionLines.map(escapeHtml).join('\n') + '</blockquote>');
    if (ready.length) lines.push('<blockquote expandable>Ready to use:\n' + readyLines.map(linkLine).join('\n') + '</blockquote>');
    const message = lines.join('\n\n');
    if (message.length > 3900) throw new Error('Family message exceeds Telegram message size limit: ' + family.title);
    messages.push(message);
  }
  return messages;
}

async function sendText(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing.');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is missing.');
  const response = await fetch(API + '/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error('Telegram delivery failed: ' + (payload.description || response.status));
  return payload.result;
}

export async function sendFamily(family) {
  const results = [];
  for (const message of renderFamilyMessages(family)) {
    results.push(await sendText(message));
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return results;
}

export async function sendTestMessage({ count, overlap, familyCount }) {
  const text = [
    '<b>Telegram Deep Link Watcher</b>',
    '',
    'Documentation crawl and integrity checks completed.',
    '<b>Extracted templates:</b> ' + Number(count),
    '<b>Link families:</b> ' + Number(familyCount || 0),
    '<b>HTML / Markdown agreement:</b> ' + Math.round(Number(overlap) * 100) + '%',
    '<b>Destination:</b> Private test chat',
    '',
    'This is a private test. No historical catalogue was published to the public channel.'
  ].join('\n');
  return sendText(text);
}
