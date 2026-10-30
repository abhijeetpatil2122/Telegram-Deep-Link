import { readFile, writeFile } from 'node:fs/promises';

const CATALOG_PATH = 'data/documentation-catalog.json';
const STATE_PATH = 'data/full-publication-state.json';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1314643983';
const DOC_URL = 'https://core.telegram.org/api/links';
const REPO_URL = 'https://github.com/abhijeetpatil2122/Telegram-Deep-Link';
const MAX_LENGTH = 3400;

const EXAMPLES = {
  username: 'telegram', bot_username: 'example_bot', short_name: 'demo',
  start_parameter: 'hello', start_param: 'hello', parameter: 'hello',
  phone_number: '1234567890', id: '12345', thread_id: '10',
  media_timestamp: '00:01:30', task_id: '1', option_id: '1',
  story_id: '123', invite_hash: 'AbCdEf123', hash: 'AbCdEf123',
  slug: 'example', url: 'https://example.com', text: 'Hello',
  draft_text: 'Hello%20from%20Telegram', domain: 'example.com',
  phone: '1234567890', post: '123', token: 'example-token',
  mode: 'compact', path: 'example', query: 'q=hello',
  server: 'proxy.example.com', port: '443', secret: 'example-secret',
  user: 'demo', pass: 'password', name: 'Example',
  color: 'blue', hex_color1: '6FB9F0', hex_color2: 'FFFFFF',
  hex_color3: '000000', hex_color4: '000000',
  top_color: '6FB9F0', bottom_color: 'FFFFFF',
  intensity: '50', rotation: '45', purpose: '1',
  star_count: '100', unix: '1790000000', format: 'json',
  code: '123456', prefix: 'ref_', peer: 'telegram',
  appname: 'example', startapp: 'hello', startattach: 'hello',
  attach: 'example_bot', choose: 'users'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function exampleFor(template) {
  const example = template.replace(/<([^<>]+)>/g, (_, name) =>
    encodeURIComponent(EXAMPLES[name] || 'example')
  );
  if (/^t\.me\//i.test(example)) return 'https://' + example;
  if (/^telegram\.me\//i.test(example) || /^telegram\.dog\//i.test(example)) return 'https://' + example;
  return example;
}

function optionLines(group) {
  const all = new Map();
  for (const item of group.templates) {
    for (const option of item.options || []) {
      const value = option.value ? '=' + option.value : '';
      const key = option.name + value;
      if (!all.has(key)) all.set(key, option);
    }
  }
  return [...all.entries()].map(([key, option]) =>
    '• <code>' + escapeHtml(key) + '</code>' + (option.value ? ' — value shown as a placeholder in the format' : ' — flag option')
  );
}

function renderGroup(group, index, total) {
  const formats = group.templates.map(item => '<code>' + escapeHtml(item.template) + '</code>');
  const examples = group.templates.map(item => '<code>' + escapeHtml(exampleFor(item.template)) + '</code>');
  const options = optionLines(group);
  const content = [
    '<b>' + escapeHtml(group.group) + '</b>',
    '<i>' + escapeHtml(group.category) + '</i>',
    '',
    '<b>Documented formats</b>',
    ...formats,
    '',
    '<b>Ready-made examples</b>',
    ...examples,
    '',
    '<blockquote expandable><b>Supported options and parameters</b>',
    ...(options.length ? options : ['No query parameters are shown in these documented formats.']),
    '',
    'Angle-bracket values in the documented formats are placeholders. Replace them with your own values. Examples use illustrative values only.',
    '</blockquote>',
    '',
    '<a href="' + DOC_URL + '">Official Telegram documentation</a> · <a href="' + REPO_URL + '/blob/main/data/documentation-catalog.json">Machine-readable catalog</a>'
  ];
  return content.join('\n');
}

async function sendTelegram(text) {
  const response = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram publication failed: ' + (result.description || response.status));
}

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  if (process.env.PUBLISH_FULL_INVENTORY !== 'true') {
    console.log('Documentation publication is not enabled for this run.');
    return;
  }

  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    if (state.completed === true && process.env.FORCE_REPUBLISH !== 'true') {
      console.log('Documentation catalog was already published; skipping duplicate publication.');
      return;
    }
  } catch {}

  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  const messages = [];
  for (const group of catalog) {
    const rendered = renderGroup(group);
    if (rendered.length <= MAX_LENGTH) {
      messages.push(rendered);
      continue;
    }
    // Keep each template/example together if a category is unusually large.
    for (const item of group.templates) {
      const miniGroup = { ...group, templates: [item] };
      messages.push(renderGroup(miniGroup));
    }
  }

  const summary = JSON.parse(await readFile('data/summary.json', 'utf8'));
  await sendTelegram([
    '<b>Telegram Deep-Link Documentation</b>',
    '',
    'Official documentation only · <b>' + summary.counts.documentedTemplates + '</b> documented formats · <b>' + catalog.length + '</b> groups.',
    '',
    'Each post shows the documented format, a ready-made example, and an expandable list of query options/parameters where present. Examples are illustrative; replace values with your own.',
    '',
    '<a href="' + DOC_URL + '">Source: Telegram official documentation</a>'
  ].join('\n'));

  for (let i = 0; i < messages.length; i++) {
    const prefix = '<b>Telegram Deep-Link Docs</b> · ' + (i + 1) + '/' + messages.length + '\n\n';
    await sendTelegram(prefix + messages[i]);
    console.log('Published documentation post ' + (i + 1) + '/' + messages.length + '.');
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  await sendTelegram('<b>Documentation publication completed</b>\nPublished <b>' + summary.counts.documentedTemplates + '</b> official documented formats across <b>' + messages.length + '</b> posts. Android-source candidates and undocumented routes are excluded.');
  await writeFile(STATE_PATH, JSON.stringify({
    completed: true, completedAt: new Date().toISOString(),
    totalTemplates: summary.counts.documentedTemplates,
    groups: catalog.length, posts: messages.length, source: DOC_URL
  }, null, 2) + '\n', 'utf8');
  console.log('Official documentation publication completed.');
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
