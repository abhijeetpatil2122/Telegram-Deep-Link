const API = 'https://api.telegram.org';
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const EXAMPLES = {
  username: 'telegram', domain: 'telegram', draft_text: 'Hello from Telegram',
  phone_number: '1234567890', hash: 'AbCdEf123', slug: 'example',
  id: '12345', channel: '1234567890', thread_id: '10', comment: '12346',
  media_timestamp: '90', task_id: '1', option_id: 'YWJj', token: 'example-token',
  server: 'proxy.example.com', port: '443', secret: 'example-secret',
  user: 'demo', pass: 'password', name: 'Example', story_id: '123',
  album_id: '42', manager_bot_username: 'managerbot',
  suggested_bot_username: 'example_bot', suggested_bot_name: 'Example Bot',
  url: 'https://example.com', text: 'Hello', mode: 'blur', path: 'appearance/themes',
  color: 'blue', hex_color: 'FFFFFF', hex_color1: 'FF0000',
  hex_color2: '00FF00', hex_color3: '0000FF', hex_color4: 'FFFFFF',
  startapp: 'hello', startattach: 'hello', attach: 'example_bot'
};

function exampleFor(template) {
  return template.replace(/<([a-zA-Z][\w-]*)>/g, (_, name) => encodeURIComponent(EXAMPLES[name] ?? 'example'));
}

function htmlFor(item) {
  const example = exampleFor(item.template);
  const exampleHref = /^(?:t\.me|telegram\.me|telegram\.dog)\//i.test(example) ? 'https://' + example : example;
  const clickable = /^https?:\/\//i.test(exampleHref);
  const description = item.description ? '\n\n' + escapeHtml(item.description) : '';
  return [
    '<b>New Telegram deep link</b>',
    '',
    '<b>Section:</b> ' + escapeHtml(item.category + (item.section && item.section !== 'General' ? ' · ' + item.section : '')),
    '<b>Format:</b>',
    '<code>' + escapeHtml(item.template) + '</code>',
    '<b>Example:</b>',
    clickable ? '<a href="' + escapeHtml(exampleHref) + '">' + escapeHtml(exampleHref) + '</a>' : '<code>' + escapeHtml(example) + '</code>',
    description,
    '',
    '<a href="https://corefork.telegram.org/api/links">Official Telegram documentation</a>'
  ].join('\n');
}

export async function sendDiscovery(item) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing.');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is missing.');

  const response = await fetch(API + '/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlFor(item),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error('Telegram delivery failed: ' + (payload.description || response.status));
  }
  return payload.result;
}
