import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_URL = 'https://core.telegram.org/api/links';
const USER_AGENT = 'Telegram-Deep-Link-Crawler/0.1 (+https://github.com/abhijeetpatil2122/Telegram-Deep-Link)';
const hash = value => createHash('sha256').update(value).digest('hex');
const idFor = value => createHash('sha1').update(value).digest('hex').slice(0, 12);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/markdown, text/plain, text/html, */*' },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error('Fetch failed (' + response.status + '): ' + url);
  return { text: await response.text(), finalUrl: response.url || url, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
}

function clean(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    // Some rendered HTML pages contain escaped code wrappers inside examples.
    .replace(/<\/?code>/gi, '')
    .replace(/\\\x60/g, '\x60').replace(/\s+/g, ' ').trim()
    .replace(/^[\x60'"“”]+|[\x60'"“”]+$/g, '');
}

function isLink(value) {
  const v = clean(value);
  return /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(v)
    || /\btg:(?:\/\/)?[a-z0-9_+.-]+/i.test(v)
    || /\btonsite:\/\//i.test(v)
    || /(?:^|\s)\w[\w.-]*\.ton(?:\/|\?|$)/i.test(v);
}


function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripCodeHtml(body) {
  // The official page uses angle-bracket placeholders such as <username> inside
  // code examples. Protect those before removing actual HTML tags.
  const placeholders = 'username|bot_username|short_name|start_parameter|start_param|phone_number|channel|id|thread_id|media_timestamp|task_id|option_id|story_id|invite_hash|hash|slug|url|text|domain|phone|post|token|mode|path|query|server|port|secret|user|pass|name|color|hex_color1|hex_color2|hex_color3|hex_color4|top_color|bottom_color|intensity|rotation|purpose|star_count|unix|format|code|parameter|prefix|peer|appname|startapp|startattach|attach|choose';
  const protectedBody = body.replace(new RegExp('<(' + placeholders + ')>', 'gi'), '&lt;$1&gt;');
  // Keep entities encoded until the outer HTML-tag removal has finished.
  return protectedBody.replace(/<[^>]+>/g, '');
}

function htmlToMarkdown(html) {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) =>
      '\n' + '#'.repeat(Number(level)) + ' ' + decodeHtml(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) + '\n')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) =>
      '\n\n' + String.fromCharCode(96).repeat(3) + '\n' + stripCodeHtml(body) + '\n' + String.fromCharCode(96).repeat(3) + '\n\n')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, body) =>
      String.fromCharCode(96) + stripCodeHtml(body) + String.fromCharCode(96))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|section|article|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtml(value).replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const entries = new Map();
  let section = 'Introduction', subsection = '', inFence = false, fence = [], fenceLine = 0;

  function add(raw, line, extraction = 'inline-code') {
    const template = clean(raw);
    if (!template || template.length > 1200 || !isLink(template)) return;
    const key = section + '\0' + template;
    if (!entries.has(key)) entries.set(key, {
      id: idFor(section + '\n' + template), template, section, subsection: subsection || null,
      source: 'official_docs', sourceUrl: DOC_URL, line, extraction, reviewStatus: 'documented'
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading && !inFence) {
      const level = heading[1].length, title = heading[2].replace(/[\x60*_]/g, '').trim();
      if (level <= 2) { section = title; subsection = ''; } else subsection = title;
    }
    if (/^\s*(?:\x60{3}|~~~)/.test(line)) {
      if (!inFence) { inFence = true; fence = []; fenceLine = i + 1; }
      else {
        for (const item of fence) {
          const candidate = item.trim().replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^\|\s*/, '').replace(/\s*\|.*$/, '').trim();
          add(candidate, fenceLine, 'fenced-code');
          for (const match of item.matchAll(/\x60([^\x60]+)\x60/g)) add(match[1], fenceLine, 'fenced-inline-code');
        }
        inFence = false;
      }
      continue;
    }
    if (inFence) { fence.push(line); continue; }
    for (const match of line.matchAll(/\x60([^\x60]+)\x60/g)) add(match[1], i + 1);
    if (/settings links/i.test(section) || /settings links/i.test(subsection)) {
      const cells = line.split('|').map(x => x.trim()), path = clean(cells[1] || '');
      if (cells.length > 1 && path && !/^[-:]+$/.test(path) && !/^path$/i.test(path)
        && /^(?:[a-z][a-z0-9-]*)(?:\/[a-z0-9_-]+)*\/?$/i.test(path)) {
        add('tg://settings/' + path.replace(/^\/+|\/+$/g, ''), i + 1, 'settings-table-path');
      }
    }
  }
  return [...entries.values()].sort((a, b) => a.section.localeCompare(b.section) || a.template.localeCompare(b.template));
}

async function writeJson(path, value) {
  const target = resolve(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function placeholders(template) {
  return [...new Set([...template.matchAll(/<([^<>]+)>/g)].map(match => match[1]))];
}

function queryOptions(template) {
  const query = template.split('?')[1] || '';
  return query.split('&').filter(Boolean).map(part => {
    const [name, ...rest] = part.split('=');
    return { name, value: rest.join('=') || null };
  });
}

function buildDocumentationCatalog(documented) {
  const groups = new Map();
  for (const item of documented) {
    const key = (item.section || 'Telegram links') + ' / ' + (item.subsection || 'General');
    if (!groups.has(key)) groups.set(key, {
      id: idFor(key), category: item.section || 'Telegram links',
      group: item.subsection || 'General', sourceUrl: DOC_URL, templates: []
    });
    groups.get(key).templates.push({
      id: item.id, template: item.template, line: item.line,
      placeholders: placeholders(item.template), options: queryOptions(item.template),
      sourceUrl: item.sourceUrl
    });
  }
  return [...groups.values()].sort((a,b) =>
    a.category.localeCompare(b.category) || a.group.localeCompare(b.group)
  );
}

async function main() {
  console.log('Fetching official Telegram deep-link documentation:', DOC_URL);
  const html = await fetchText(DOC_URL);
  if (!/<(?:html|article|main|h[1-6])\b/i.test(html.text) || html.text.length < 1000) {
    throw new Error('The official deep-link website did not return recognizable HTML.');
  }
  const docs = { ...html, text: htmlToMarkdown(html.text) };
  if (!/^\s*#/m.test(docs.text) || docs.text.length < 1000) {
    throw new Error('Could not extract usable deep-link documentation from the official website HTML.');
  }

  const documented = parseMarkdown(docs.text);
  const malformed = documented.filter(item =>
    /<\/?code>/i.test(item.template)
    || /(?:t\.me|telegram\.me|telegram\.dog)\/\s+(?:\?|\/|$)/i.test(item.template)
    || /\btg:\s+\//i.test(item.template)
  );
  if (malformed.length) {
    throw new Error('Malformed templates detected in official HTML extraction: ' +
      malformed.slice(0, 5).map(item => item.template).join(' | ')
    );
  }

  const requiredTemplates = [
    't.me/<username>?text=<draft_text>&profile',
    'tg://resolve?domain=<username>&text=<draft_text>&profile',
    't.me/<username>/<id>?single&thread=<thread_id>&comment=<comment>&t=<media_timestamp>&task=<task_id>&option=<option_id>',
    'tg://settings',
    't.me/<username>?direct',
    'tg://join?invite=<hash>'
  ];
  const missingTemplates = requiredTemplates.filter(template =>
    !documented.some(item => item.template === template)
  );
  if (missingTemplates.length) {
    throw new Error('Official HTML extraction is missing expected documented examples: ' +
      missingTemplates.join(' | ')
    );
  }

  const catalog = buildDocumentationCatalog(documented);
  const summary = {
    generatedAt: new Date().toISOString(),
    source: { url: DOC_URL, finalUrl: docs.finalUrl, sha256: hash(docs.text), etag: docs.etag, lastModified: docs.lastModified },
    counts: {
      documentedTemplates: documented.length,
      documentationGroups: catalog.length,
      categories: [...new Set(catalog.map(group => group.category))].length,
      templatesWithPlaceholders: documented.filter(item => placeholders(item.template).length).length
    },
    note: 'This catalog contains only deep-link formats and paths explicitly extracted from the official Telegram documentation website. No Android source candidates or inferred undocumented routes are included.'
  };

  const publicationInventory = documented.map(item => ({
    id: 'official:' + item.id,
    kind: 'official-template',
    template: item.template,
    category: item.section,
    group: item.subsection || null,
    sourceUrl: item.sourceUrl,
    line: item.line,
    status: 'officially-documented',
    placeholders: placeholders(item.template),
    options: queryOptions(item.template)
  }));

  await writeJson('data/documented-links.json', documented);
  await writeJson('data/documentation-catalog.json', catalog);
  await writeJson('data/publication-inventory.json', publicationInventory);
  await writeJson('data/summary.json', summary);
  console.log(JSON.stringify(summary.counts, null, 2));
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
