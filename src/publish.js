const API = 'https://api.telegram.org';
const RICH_LIMIT = 30000;
const TEXT_LIMIT = 3900;
const fence = String.fromCharCode(96, 96, 96);
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function countCharacters(value) { return Array.from(value).length; }
function familyMarkdown(family, part, total) {
  const heading = '# ' + family.title + (total > 1 ? ' — Part ' + part + '/' + total : '');
  const body = family.documentation || '';
  const fallback = (family.templates || []).length
    ? '\n\n## Documented syntax\n\n' + fence + 'text\n' + unique(family.templates).join('\n') + '\n' + fence
    : '';
  return [heading, '', body || fallback, '', '---',
    '*Source: [Telegram official deep-link documentation](https://core.telegram.org/api/links)*'
  ].join('\n');
}
function splitRichContent(family) {
  const paragraphs = (family.documentation || '').split(/\n\s*\n/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? current + '\n\n' + paragraph : paragraph;
    if (countCharacters(familyMarkdown({ ...family, documentation: candidate }, 1, 1)) <= RICH_LIMIT) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (countCharacters(familyMarkdown({ ...family, documentation: paragraph }, 1, 1)) <= RICH_LIMIT) {
      current = paragraph;
      continue;
    }
    let fragment = '';
    for (const line of paragraph.split('\n')) {
      const next = fragment ? fragment + '\n' + line : line;
      if (countCharacters(familyMarkdown({ ...family, documentation: next }, 1, 1)) > RICH_LIMIT) {
        if (fragment) chunks.push(fragment);
        fragment = line;
      } else fragment = next;
    }
    current = fragment;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks.map((documentation, index) => familyMarkdown(
    { ...family, documentation }, index + 1, chunks.length
  ));
}
function splitPlainText(value, limit = TEXT_LIMIT) {
  const chunks = [];
  let current = '';
  for (const line of value.split('\n')) {
    const next = current ? current + '\n' + line : line;
    if (countCharacters(next) > limit && current) {
      chunks.push(current);
      current = line;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
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
async function sendPlain(text) {
  const sent = [];
  for (const chunk of splitPlainText(text)) {
    sent.push(await request('sendMessage', {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: chunk,
      disable_web_page_preview: true
    }));
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return sent;
}
export async function sendFamily(family) {
  if (!process.env.TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID is missing.');
  const messages = splitRichContent(family);
  const results = [];
  for (const message of messages) {
    try {
      results.push(await sendRich(message));
    } catch (error) {
      const unsupported = /method not found|unknown method|sendRichMessage/i.test(error.message);
      if (!unsupported) throw error;
      console.warn('Rich Messages unavailable; using ordered text chunks.');
      results.push(...await sendPlain(message));
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return results;
}
export async function sendTestMessage({ count, overlap, familyCount }) {
  const markdown = [
    '# Telegram Deep Link Watcher', '',
    'Documentation crawl and integrity checks completed.', '',
    '**Extracted templates:** ' + Number(count),
    '**Link families:** ' + Number(familyCount || 0),
    '**HTML / Markdown agreement:** ' + Math.round(Number(overlap) * 100) + '%',
    '**Destination:** Private test chat', '',
    'This is a private test. No public channel has been targeted.'
  ].join('\n');
  return sendRich(markdown);
}
