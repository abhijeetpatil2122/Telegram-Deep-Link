const API = 'https://api.telegram.org';
const RICH_LIMIT = 30000;

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
function countCharacters(value) {
  return Array.from(value).length;
}
function familyMarkdown(family, part = 1, total = 1) {
  const heading = '# ' + family.title + (total > 1 ? ' — Part ' + part + '/' + total : '');
  const templates = unique(family.templates);
  const options = unique(family.options);
  const ready = unique(family.ready);

  const lines = [heading, ''];
  if (templates.length) lines.push(templates.join('\n'));

  const expandable = [];
  if (options.length) expandable.push('Options:\n' + options.join('\n'));
  if (ready.length) expandable.push('Ready to use:\n' + ready.join('\n'));
  if (expandable.length) {
    if (templates.length) lines.push('');
    lines.push('<blockquote expandable>' + expandable.join('\n\n') + '</blockquote>');
  }

  lines.push('', '---', '@TDeepLink');
  return lines.join('\n');
}
function splitRichContent(family) {
  const full = familyMarkdown(family);
  if (countCharacters(full) <= RICH_LIMIT) return [full];

  const groups = [
    ['templates', unique(family.templates)],
    ['options', unique(family.options)],
    ['ready', unique(family.ready)]
  ].filter(([, values]) => values.length);
  const chunks = [];
  let current = { templates: [], options: [], ready: [] };
  for (const [property, values] of groups) {
    for (const value of values) {
      current[property].push(value);
      if (countCharacters(familyMarkdown({ ...family, ...current })) > RICH_LIMIT) {
        current[property].pop();
        if (Object.values(current).some(list => list.length)) chunks.push(current);
        current = { templates: [], options: [], ready: [] };
        current[property].push(value);
      }
    }
  }
  if (Object.values(current).some(list => list.length)) chunks.push(current);
  return chunks.map((chunk, index) => familyMarkdown({ ...family, ...chunk }, index + 1, chunks.length));
}
async function request(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing.');
  const response = await fetch(API + '/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.description || ('Telegram request failed (' + response.status + ').'));
    error.errorCode = result.error_code;
    error.method = method;
    throw error;
  }
  return result.result;
}
async function sendRich(text) {
  return request('sendRichMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    rich_message: { markdown: text }
  });
}
export async function sendFamily(family) {
  if (!process.env.TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID is missing.');
  const results = [];
  for (const message of splitRichContent(family)) {
    results.push(await sendRich(message));
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  return results;
}
export async function sendTestMessage({ count, overlap, familyCount }) {
  const markdown = [
    '# Telegram Deep Link Watcher', '',
    'Documentation crawl and integrity checks completed.', '',
    '**Extracted links:** ' + Number(count),
    '**Link families:** ' + Number(familyCount || 0),
    '**HTML / Markdown match:** ' + Math.round(Number(overlap) * 100) + '%',
    '**Destination:** Private test chat', '',
    'This is a private test. No public channel has been targeted.'
  ].join('\n');
  return sendRich(markdown);
}
