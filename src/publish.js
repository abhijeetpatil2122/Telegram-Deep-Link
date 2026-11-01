const API = 'https://api.telegram.org';
const RICH_LIMIT = 30000;

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
function countCharacters(value) {
  return Array.from(value).length;
}
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function renderTemplate(value) {
  return escapeHtml(value);
}
function renderList(values, ordered = false) {
  const tag = ordered ? 'ol' : 'ul';
  return '<' + tag + '>' + values.map(value => '<li>' + escapeHtml(value) + '</li>').join('') + '</' + tag + '>';
}
function cleanParameterDescription(value) {
  return String(value || '')
    .replace(/&nbsp;|&raquo;|&#187;|&#160;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
function familyHtml(family) {
  const templates = unique(family.templates).filter(template => !template.startsWith('tg:') || template.startsWith('tg://'));
  const options = unique(family.options);
  // Ready-to-use entries already listed as the main link formats should not be repeated.
  const ready = unique(family.ready).filter(template => !templates.includes(template));
  const parameters = (family.parameters || []).filter(item => item && item.name);
  const blocks = [];
  const familyTitle = String(family.title || '').trim().toLowerCase();
  const isBoostFamily = familyTitle === 'boost links';
  const isPostStoryFamily = familyTitle === 'post story links';
  const title = String(family.title || '').replace(/\\s+links?$/i, '').trim();

  if (title) blocks.push('<h3>' + escapeHtml(title) + '</h3>');
  if (templates.length) blocks.push(isBoostFamily ? renderList(templates) : templates.map(renderTemplate).join('<br>'));
  if (options.length) blocks.push(isPostStoryFamily ? 'Options:' + renderList(options, true) : '<blockquote expandable>Options:<br>' + options.map(escapeHtml).join('<br>') + '</blockquote>');
  if (ready.length) blocks.push(isPostStoryFamily ? 'Ready to use:' + renderList(ready) : '<blockquote expandable>Ready to use:<br>' + ready.map(renderTemplate).join('<br>') + '</blockquote>');
  if (parameters.length) {
    const rows = parameters.map(item =>
      '<tr><td>' + escapeHtml(item.name) + '</td><td>' +
      escapeHtml(cleanParameterDescription(item.requirement || '').toLowerCase()) +
      '</td><td>' + escapeHtml(cleanParameterDescription(item.description)) + '</td></tr>'
    );
    const table = '<table><tr><th>Name</th><th>Optional</th><th>Description</th></tr>' + rows.join('') + '</table>';
    blocks.push('<details><summary>Parameters</summary>' + table + '</details>');
  }
  blocks.push('<hr>', '@TDeepLink');
  return blocks.join('');
}
function splitRichContent(family) {
  const full = familyHtml(family);
  if (countCharacters(full) <= RICH_LIMIT) return [full];
  const groups = [
    ['templates', unique(family.templates)],
    ['options', unique(family.options)],
    ['ready', unique(family.ready)],
    ['parameters', family.parameters || []]
  ].filter(([, values]) => values.length);
  const chunks = [];
  let current = { templates: [], options: [], ready: [], parameters: [] };
  for (const [property, values] of groups) {
    for (const value of values) {
      current[property].push(value);
      if (countCharacters(familyHtml({ ...family, ...current })) > RICH_LIMIT) {
        current[property].pop();
        if (Object.values(current).some(list => list.length)) chunks.push(current);
        current = { templates: [], options: [], ready: [], parameters: [] };
        current[property].push(value);
      }
    }
  }
  if (Object.values(current).some(list => list.length)) chunks.push(current);
  return chunks.map(chunk => familyHtml({ ...family, ...chunk }));
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
async function sendRich(html) {
  return request('sendRichMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    rich_message: { html }
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
  const html = [
    'Telegram Deep Link Watcher',
    'Documentation crawl and integrity checks completed.',
    'Extracted links: ' + Number(count),
    'Link families: ' + Number(familyCount || 0),
    'HTML / Markdown match: ' + Math.round(Number(overlap) * 100) + '%',
    'Destination: Private test chat',
    'This is a private test. No public channel has been targeted.'
  ].map(escapeHtml).join('<br>');
  return sendRich(html);
}
