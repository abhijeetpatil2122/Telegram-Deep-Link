import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const HTML_URL = 'https://corefork.telegram.org/api/links';
export const MARKDOWN_URL = 'https://corefork.telegram.org/api/links.md';
const USER_AGENT = 'Telegram-Deep-Link-Watcher/1.0 (+https://github.com/abhijeetpatil2122/Telegram-Deep-Link)';
const DATA_DIR = new URL('../data/', import.meta.url);

const sha256 = value => createHash('sha256').update(value).digest('hex');

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToMarkdown(html) {
  return decodeEntities(html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>([^]*?)<\/h\1>/gi, (_, n, body) => '\n' + '#'.repeat(Number(n)) + ' ' + body.replace(/<[^>]+>/g, '') + '\n')
    .replace(/<pre\b[^>]*>([^]*?)<\/pre>/gi, (_, body) => '\n\n```\n' + body.replace(/<[^>]+>/g, '') + '\n```\n\n')
    .replace(/<code\b[^>]*>([^]*?)<\/code>/gi, (_, body) => '`' + body.replace(/<[^>]+>/g, '') + '`')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|tr|section|article|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isDeepLink(value) {
  const v = value.trim().replace(/^[("'\s]+|[)"',;\s]+$/g, '');
  return /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(v)
    || /^tg:(?:\/\/)?[a-z0-9_+.-]+/i.test(v)
    || /^tonsite:\/\//i.test(v)
    || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ton(?:[/?#]|$)/i.test(v);
}

function cleanCandidate(value) {
  return decodeEntities(value)
    .replace(/^\s*(?:[-*+]\s+)?/, '')
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .replace(/[),.;]+$/g, '')
    .trim();
}

function parseMarkdown(markdown) {
  const links = [];
  const seen = new Set();
  let category = 'Deep links';
  let section = 'General';
  let inFence = false;
  let fenceBuffer = [];

  const add = (raw, line) => {
    const value = cleanCandidate(raw);
    if (!value || value.length > 2000 || !isDeepLink(value)) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      id: sha256(key).slice(0, 16),
      template: value,
      category,
      section,
      line
    });
  };

  const addCode = (text, line) => {
    for (const part of text.split(/\r?\n/)) {
      const candidate = part.trim().replace(/^[-*+]\s+/, '');
      if (isDeepLink(candidate)) add(candidate, line);
    }
  };

  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (!inFence) { inFence = true; fenceBuffer = []; }
      else { addCode(fenceBuffer.join('\n'), i + 1); inFence = false; }
      continue;
    }
    if (inFence) { fenceBuffer.push(line); continue; }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/[`*_]/g, '').trim();
      if (level <= 2) { category = title; section = 'General'; }
      else section = title;
      continue;
    }

    for (const match of line.matchAll(/`([^`]+)`/g)) addCode(match[1], i + 1);
  }

  if (inFence) addCode(fenceBuffer.join('\n'), lines.length);
  return links;
}

async function fetchSource(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: url.endsWith('.md') ? 'text/markdown, text/plain;q=0.9, */*;q=0.1' : 'text/html, */*;q=0.1'
    },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error('Source request failed (' + response.status + '): ' + url);
  const body = await response.text();
  if (body.length < 5000) throw new Error('Source response is unexpectedly short: ' + url);
  if (url.endsWith('.md') && !/^\s*#/m.test(body)) throw new Error('Markdown endpoint did not return recognizable Markdown.');
  if (!url.endsWith('.md') && !/<html|<!doctype html/i.test(body)) throw new Error('HTML endpoint did not return an HTML document.');
  return {
    body,
    finalUrl: response.url || url,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified')
  };
}

function verifyInventories(htmlLinks, markdownLinks) {
  if (!htmlLinks.length || !markdownLinks.length) {
    throw new Error('Integrity check failed: one source produced no deep-link formats.');
  }
  const htmlSet = new Set(htmlLinks.map(x => x.template.toLowerCase()));
  const mdSet = new Set(markdownLinks.map(x => x.template.toLowerCase()));
  const common = [...mdSet].filter(x => htmlSet.has(x)).length;
  const overlap = common / Math.max(htmlSet.size, mdSet.size);
  if (overlap < 0.75) {
    throw new Error('HTML/Markdown inventories disagree too much (' + Math.round(overlap * 100) + '% overlap). Refusing to publish.');
  }
  return { htmlCount: htmlSet.size, markdownCount: mdSet.size, commonCount: common, overlap: Number(overlap.toFixed(4)) };
}


function parseFamilies(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading && /^#{1,3}\s/.test(line)) {
      if (current) sections.push(current);
      current = { title: heading[1].replace(/[\`*_]/g, '').trim(), body: [] };
    } else if (current) current.body.push(line);
  }
  if (current) sections.push(current);

  const families = [];
  for (const section of sections) {
    const title = section.title;
    const body = section.body.join('\n');
    if (/^(deep links|unsupported links)$/i.test(title)) continue;
    if (!/links/i.test(title) && !/deep links/i.test(title)) continue;
    const key = title.toLowerCase().replace(/\s+links?$/i, '').trim();
    const templates = parseMarkdown('### ' + title + '\n' + body).map(x => x.template);
    const options = new Set();
    const addOption = value => {
      const v = value.trim().replace(/^[\`*_]+|[\`*_]+$/g, '');
      if (v && v !== '+' && v !== '-' && v.length < 120 && !/[<>]/.test(v)) options.add(v);
    };
    if (/^settings links$/i.test(title)) {
      for (const m of body.matchAll(/^\s*[-*+]\s+\`([^\`]+)\`/gm)) addOption(m[1]);
    } else if (/^contacts links$/i.test(title)) {
      for (const m of body.matchAll(/^\s*\|\s*\`([^|]+)\`\s*\|/gm)) addOption(m[1]);
    } else if (/^post story links$/i.test(title)) {
      for (const m of body.matchAll(/^\s*[-*+]\s+\`([^ \`]+)\`/gm)) addOption(m[1]);
    } else {
      for (const m of body.matchAll(/^\s*[-*+]\s+\`([^ \`]+)\`/gm)) addOption(m[1]);
    }

    if (/^settings links$/i.test(title)) options.delete('path');
    if (/^contacts links$/i.test(title)) options.delete('section');
    if (/^post story links$/i.test(title)) options.delete('content_type');
    for (const template of templates) {
      for (const match of template.matchAll(/<([^>]+)>/g)) addOption(match[1]);
      for (const match of template.matchAll(/[?&]([a-z][a-z0-9_]*)(?==|&|$)/gi)) {
        if (!['tg', 'http', 'https'].includes(match[1].toLowerCase())) addOption(match[1]);
      }
    }
    for (const match of body.matchAll(/combination of ([^\n.]+)/gi)) {
      for (const value of match[1].matchAll(/\`([^\`]+)\`/g)) addOption(value[1]);
    }
    for (const match of body.matchAll(/(?:recognized|possible) values:\s*([^\n]+)/gi)) {
      for (const value of match[1].matchAll(/\`([^\`]+)\`/g)) addOption(value[1]);
    }
    if (/^settings links$/i.test(title)) options.delete('path');
    if (/^contacts links$/i.test(title)) options.delete('section');
    if (/^post story links$/i.test(title)) options.delete('content_type');
    const ready = new Set(templates.filter(x => !/<[^>]+>|\{prefix\}/.test(x)));
    if (/^settings links$/i.test(title)) {
      ready.add('tg://settings');
      for (const path of options) ready.add('tg://settings/' + path);
    }
    if (/^contacts links$/i.test(title)) {
      ready.add('tg://contacts');
      for (const option of options) ready.add('tg://contacts/' + option);
    }
    if (/^post story links$/i.test(title)) {
      ready.add('tg://post');
      for (const option of options) ready.add('tg://post/' + option);
    }
    if (!templates.length && !ready.size) continue;
    const allOptions = [...options];
    families.push({
      id: sha256(key).slice(0, 16),
      title,
      key,
      templates: [...new Set(templates)],
      options: allOptions,
      ready: [...ready].sort()
    });
  }
  return families;
}

async function saveJson(name, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(new URL(name, DATA_DIR), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function crawl() {
  console.log('Fetching official HTML and Markdown documentation...');
  const [html, markdown] = await Promise.all([fetchSource(HTML_URL), fetchSource(MARKDOWN_URL)]);
  const htmlText = htmlToMarkdown(html.body);
  const htmlLinks = parseMarkdown(htmlText);
  const markdownLinks = parseMarkdown(markdown.body);
  const verification = verifyInventories(htmlLinks, markdownLinks);

  // Markdown is the primary structured source. Keep HTML-only entries too after cross-checking.
  const byTemplate = new Map(markdownLinks.map(item => [item.template.toLowerCase(), item]));
  for (const item of htmlLinks) {
    if (!byTemplate.has(item.template.toLowerCase())) byTemplate.set(item.template.toLowerCase(), { ...item, source: 'html' });
  }
  const inventory = [...byTemplate.values()].sort((a, b) => a.template.localeCompare(b.template));
  const result = {
    fetchedAt: new Date().toISOString(),
    sources: {
      html: { url: HTML_URL, finalUrl: html.finalUrl, sha256: sha256(html.body), etag: html.etag, lastModified: html.lastModified },
      markdown: { url: MARKDOWN_URL, finalUrl: markdown.finalUrl, sha256: sha256(markdown.body), etag: markdown.etag, lastModified: markdown.lastModified }
    },
    verification,
    total: inventory.length,
    inventory,
    families: parseFamilies(markdown.body)
  };

  await saveJson('catalog.json', result);
  await saveJson('summary.json', {
    fetchedAt: result.fetchedAt,
    total: result.total,
    verification,
    htmlSha256: result.sources.html.sha256,
    markdownSha256: result.sources.markdown.sha256
  });
  console.log('Verified ' + inventory.length + ' unique deep-link formats.');
  console.log(JSON.stringify(verification));
  return result;
}

if (import.meta.url === new URL(process.argv[1] || '', 'file:').href) {
  crawl().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
