import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_URL = 'https://core.telegram.org/api/links';
const MD_URL = DOC_URL + '.md';
const USER_AGENT = 'Telegram-Deep-Link-Crawler/1.0';
const sha = value => createHash('sha256').update(value).digest('hex');
const id = value => createHash('sha1').update(value).digest('hex').slice(0, 12);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/markdown, text/plain, text/html, */*' },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error('Official documentation fetch failed (' + response.status + '): ' + url);
  return { text: await response.text(), finalUrl: response.url || url, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
}

function decode(value) {
  return value.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToMarkdown(html) {
  const protectedHtml = html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>([^]*?)<\/h\1>/gi, (_, n, body) => '\n' + '#'.repeat(+n) + ' ' + decode(body.replace(/<[^>]+>/g, ' ')).trim() + '\n')
    .replace(/<pre\b[^>]*>([^]*?)<\/pre>/gi, (_, body) => '\n\n```\n' + decode(body.replace(/<[^>]+>/g, '')) + '\n```\n\n')
    .replace(/<code\b[^>]*>([^]*?)<\/code>/gi, (_, body) => '`' + decode(body.replace(/<[^>]+>/g, '')) + '`')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' | ')
    .replace(/<tr\b[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|li|tr|section|article|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(protectedHtml).replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function cleanCode(value) {
  return value.replace(/\\`/g, '`').replace(/\s+/g, ' ').trim().replace(/^[`'“”]+|[`'“”]+$/g, '');
}
function isDeepLink(value) {
  return /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(value)
    || /\btg:(?:\/\/)?[a-z0-9_+.-]+/i.test(value)
    || /\btonsite:\/\//i.test(value)
    || /(?:^|\s)[\w.-]+\.ton(?:\/|\?|$)/i.test(value);
}
function placeholders(value) {
  return [...new Set([...value.matchAll(/<([a-zA-Z][\w-]*)>/g)].map(x => x[1]))];
}
function parseTableRow(line) {
  const cells = line.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(x => x.trim());
  if (cells.length < 2 || cells.every(x => /^:?-{2,}:?$/.test(x))) return null;
  return cells;
}

function parseDocumentation(markdown) {
  const groups = [];
  let current = null, fence = false, fenceLines = [], fenceStart = 0;
  let activeCategory = 'General', activeGroup = 'General';
  const seen = new Set();
  const ensureGroup = () => {
    if (!current) current = { category: activeCategory, group: activeGroup, description: '', templates: [], parameters: [], details: [] };
  };
  const addTemplate = (raw, line, kind) => {
    const template = cleanCode(raw);
    if (!template || template.length > 1800 || !isDeepLink(template)) return;
    const key = (current.category + '/' + current.group + '/' + template).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    current.templates.push({ id: id(key), template, placeholders: placeholders(template), line, extraction: kind });
  };
  const finishGroup = () => {
    if (!current) return;
    current.templates = current.templates.filter(x => x.template);
    if (current.templates.length || current.parameters.length || current.details.length || current.description) groups.push(current);
    current = null;
  };

  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (!fence) { fence = true; fenceLines = []; fenceStart = i + 1; }
      else {
        ensureGroup();
        for (const raw of fenceLines) addTemplate(raw.trim().replace(/^[-*+]\s+/, ''), fenceStart, 'fenced-code');
        fence = false;
      }
      continue;
    }
    if (fence) { fenceLines.push(line); continue; }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/[`*_]/g, '').trim();
      finishGroup();
      if (level <= 3) {
        activeCategory = title;
        activeGroup = 'General';
      } else {
        activeGroup = title;
      }
      current = { category: activeCategory, group: activeGroup, description: '', templates: [], parameters: [], details: [] };
      continue;
    }
    ensureGroup();

    // Inline code links and code samples are documented formats too.
    for (const match of line.matchAll(/`([^`]+)`/g)) addTemplate(match[1], i + 1, 'inline-code');

    const cells = parseTableRow(line);
    if (cells && /^(name|parameter)$/i.test((cells[0] || '').replace(/[`*_]/g, ''))) continue;
    if (cells && cells.length >= 3 && !cells.every(x => /^:?-{2,}:?$/.test(x))) {
      const normalized = cells.map(x => x.replace(/[`*_]/g, '').trim());
      if (normalized[0] && normalized[1] && normalized[2]) {
        current.parameters.push({ name: normalized[0], requirement: normalized[1], description: normalized.slice(2).join(' | ') });
      }
    }

    const bullet = line.match(/^\s{0,8}[-*+]\s+(.+)$/);
    if (bullet) {
      const value = bullet[1].trim();
      const code = value.match(/^`([^`]+)`(?:\s*[-–—:]\s*(.*))?$/);
      if (code && !isDeepLink(code[1])) {
        current.details.push({ value: code[1], description: (code[2] || '').trim() });
      } else if (value && !isDeepLink(value)) {
        current.details.push({ value: value.replace(/[`*_]/g, '').trim(), description: '' });
      }
    }

    if (!current.description && line.trim() && !/^\s*(?:[-*+]|\||Parameters:|Syntax:|\*\*)/.test(line)
      && !line.includes('`') && !/^\s*<|^\s*Name\s/.test(line)) {
      current.description = line.trim().replace(/\s+/g, ' ').slice(0, 420);
    }
  }
  finishGroup();

  // Keep parent/child headings in source order and preserve every documented format.
  const flat = groups.flatMap(group => group.templates.map(template => ({
    ...template, category: group.category, group: group.group
  })));
  if (!flat.length) throw new Error('Parser found no deep-link formats in the official documentation.');
  return { groups, flat };
}

async function writeJson(path, value) {
  const target = resolve(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function main() {
  console.log('Fetching machine-readable official documentation:', MD_URL);
  let fetched;
  try { fetched = await fetchText(MD_URL); }
  catch (error) {
    console.warn('Markdown endpoint unavailable; falling back to the official HTML page:', error.message);
    fetched = await fetchText(DOC_URL);
    fetched.text = htmlToMarkdown(fetched.text);
  }
  const markdown = fetched.text.replace(/^\uFEFF/, '');
  if (markdown.length < 5000 || !/^\s*#/m.test(markdown)) throw new Error('Official documentation response is incomplete or not recognizable.');

  const parsed = parseDocumentation(markdown);
  const expected = [
    'tg://settings', 'tg://settings/<path>',
    'tg://resolve?domain=<username>&text=<draft_text>&profile',
    'tonsite://somesite.domain/path?query#hash'
  ];
  const missing = expected.filter(value => !parsed.flat.some(item => item.template === value));
  if (missing.length) throw new Error('Parser integrity check failed; missing documented core formats: ' + missing.join(' | '));
  const settings = parsed.groups.find(group => /settings links/i.test(group.category + ' ' + group.group));
  if (!settings || settings.details.filter(item => /^(appearance|data|business|chat|privacy|notifications|devices|language|folders|advanced)(?:\/|$)/.test(item.value)).length < 20) {
    throw new Error('Parser integrity check failed; the documented Settings path list appears incomplete.');
  }
  if (!parsed.groups.some(group => group.parameters.length > 0)) {
    throw new Error('Parser integrity check failed; parameter definitions were not extracted.');
  }

  const catalog = parsed.groups.filter(group => group.templates.length).map(group => ({
    id: id(group.category + '/' + group.group), category: group.category, group: group.group,
    description: group.description, templates: group.templates, parameters: group.parameters,
    details: group.details
  }));
  const summary = {
    generatedAt: new Date().toISOString(),
    source: { url: DOC_URL, fetchedUrl: fetched.finalUrl, sha256: sha(markdown), etag: fetched.etag, lastModified: fetched.lastModified },
    counts: {
      documentedTemplates: parsed.flat.length, documentationGroups: catalog.length,
      categories: [...new Set(catalog.map(x => x.category))].length,
      parameterDefinitions: catalog.reduce((n, x) => n + x.parameters.length, 0),
      documentedOptions: catalog.reduce((n, x) => n + x.details.length, 0),
      templatesWithPlaceholders: parsed.flat.filter(x => x.placeholders.length).length
    }
  };
  const inventory = parsed.flat.map(item => ({
    id: 'official:' + item.id, kind: 'official-template', template: item.template,
    category: item.category, group: item.group, placeholders: item.placeholders,
    status: 'officially-documented'
  }));

  await writeJson('data/documented-links.json', parsed.flat);
  await writeJson('data/documentation-catalog.json', catalog);
  await writeJson('data/publication-inventory.json', inventory);
  await writeJson('data/summary.json', summary);
  console.log(JSON.stringify(summary.counts, null, 2));
}
main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
