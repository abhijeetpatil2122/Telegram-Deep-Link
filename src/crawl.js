import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_URL = 'https://corefork.telegram.org/api/links.md';
const JAVA_URL = 'https://raw.githubusercontent.com/DrKLO/Telegram/master/TMessagesProj/src/main/java/org/telegram/ui/LaunchActivity.java';
const JAVA_PAGE_URL = 'https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/LaunchActivity.java';
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

function scanJava(source) {
  const lines = source.split(/\r?\n/), candidates = new Map();
  const direct = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[A-Za-z0-9_+./?=&%{}<>:-]+|tg:(?:\/\/)?[A-Za-z0-9_+./?=&%{}<>:-]+|tonsite:\/\/[A-Za-z0-9_+./?=&%{}<>:-]+/gi;
  const literals = /(?:startsWith|endsWith|equals(?:IgnoreCase)?|contains|indexOf)\s*\(\s*"([^"\n]{1,100})"/g;
  const context = /(?:deep.?link|uri|url|scheme|host|path|query|intent|resolve|launch|open.?link|telegram\.me|t\.me|tg:)/i;

  function add(value, lineNumber, excerpt, extraction) {
    const candidate = clean(value).replace(/[),;]+$/, '');
    if (!candidate || candidate.length > 1200) return;
    const key = candidate.toLowerCase();
    if (!candidates.has(key)) candidates.set(key, {
      id: idFor('android\n' + candidate), candidate, source: 'android_launch_activity',
      sourceUrl: JAVA_PAGE_URL, line: lineNumber, excerpt: excerpt.trim().slice(0, 320), extraction,
      reviewStatus: 'needs_review',
      note: 'Implementation-derived candidate; verify route behavior and required parameters before publishing.'
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(direct)) add(match[0], i + 1, line, 'literal-uri');
    if (context.test(line)) for (const match of line.matchAll(literals)) {
      const value = match[1];
      if (/^(?:tg|t\.me|telegram\.me|telegram\.dog|https?:|\/|\?|settings|contacts?|new|chats?|login|passport|stars?|ton|bg|addstickers|addemoji|addtheme|addstyle|share|msg_url|privatepost|resolve|proxy|socks|call|nft|invoice|gift|auth|scanqr|search|confirmphone|setlanguage|emoji|time|user|restore_purchases|importStickers)/i.test(value)) {
        add(value, i + 1, line, 'url-handler-string');
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.candidate.localeCompare(b.candidate));
}

async function writeJson(path, value) {
  const target = resolve(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function main() {
  console.log('Fetching official Markdown:', DOC_URL);
  const docs = await fetchText(DOC_URL);
  if (!/^\s*#/m.test(docs.text) || docs.text.length < 1000) {
    throw new Error('The Markdown endpoint returned unexpected content. Refusing to write an unreliable inventory.');
  }
  console.log('Fetching Android source:', JAVA_URL);
  const java = await fetchText(JAVA_URL);
  if (!java.text.includes('package org.telegram.ui;') || java.text.length < 100000) {
    throw new Error('The Android response does not look like LaunchActivity.java.');
  }

  const documented = parseMarkdown(docs.text), android = scanJava(java.text);
  const documentedKeys = new Set(documented.map(item => item.template.toLowerCase()));
  const candidates = android.map(item => ({ ...item, alreadyInDocs: documentedKeys.has(item.candidate.toLowerCase()) }));
  const summary = {
    generatedAt: new Date().toISOString(),
    sources: {
      officialDocs: { url: DOC_URL, finalUrl: docs.finalUrl, sha256: hash(docs.text), etag: docs.etag, lastModified: docs.lastModified },
      androidSource: { url: JAVA_URL, displayUrl: JAVA_PAGE_URL, finalUrl: java.finalUrl, sha256: hash(java.text), etag: java.etag, lastModified: java.lastModified }
    },
    counts: {
      documentedTemplates: documented.length,
      androidCandidates: candidates.length,
      androidCandidatesNotExactMatches: candidates.filter(item => !item.alreadyInDocs).length
    },
    note: 'These are extracted templates and implementation candidates, not a guarantee of every runtime-supported route. Review Android-only candidates before publishing.'
  };
  await writeJson('data/documented-links.json', documented);
  await writeJson('data/android-candidates.json', candidates);
  await writeJson('data/summary.json', summary);
  console.log(JSON.stringify(summary.counts, null, 2));
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
