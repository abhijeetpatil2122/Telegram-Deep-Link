import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_URL = 'https://core.telegram.org/api/links';
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

function classifyCandidate(candidate, excerpt, extraction) {
  const value = candidate.toLowerCase();
  const context = excerpt.toLowerCase();
  let candidateType = 'handler-token';
  let category = 'other';
  let classification = 'needs-manual-review';
  let reviewNote = 'Heuristic classification only; inspect the surrounding source and confirm how Telegram parses this value.';

  if (/^tg:\/\/(?:addcontact|send_gift|calllog|scanqr)$/i.test(candidate)) {
    candidateType = 'scheme-prefix';
    category = 'runtime-supported-action';
    classification = 'user-confirmed-working';
    reviewNote = 'The user reports this tg:// route works in Telegram. Android source also contains a matching explicit handler; this is implementation evidence, not an official documentation claim.';
  } else if (/^tg:\/\/telegram\.org$/i.test(candidate) && /replace\(/i.test(context)) {
    candidateType = 'internal-url-rewrite';
    category = 'internal-url-rewrite';
    classification = 'likely-internal-or-contextual';
    reviewNote = 'This value is used as an internal URL rewrite target while parsing another link; it is not a public deep-link template.';
  } else if (/^tg:\/\/(?:calllog|scanqr|search|openmessage)$/i.test(candidate) || /^tg:(?:calllog|scanqr|search|openmessage)$/i.test(candidate)) {
    candidateType = 'scheme-prefix';
    category = 'client-action-route';
    classification = 'likely-internal-or-contextual';
    reviewNote = 'Android handles this as a direct client action or compatibility route. The source match does not establish a documented, stable public link format; keep it out of the confirmed-template inventory unless independently verified.';
  } else if (/^tg:\/\/(?:[a-z0-9_]+)?$/i.test(candidate) || /^tg:(?!\/\/)[a-z0-9_]+$/i.test(candidate)) {
    candidateType = 'scheme-prefix';
    category = 'deep-link';
    reviewNote = 'This is a scheme/route prefix detected in client dispatch logic, not a complete deep-link template. Recover the supported parameters from the handler before publishing.';
  } else if (/^(?:t\.me|telegram\.me|telegram\.dog)$/i.test(candidate)) {
    candidateType = 'host-token';
    category = 'link-host-alias';
    reviewNote = 'Host alias used by the URL parser, not a standalone link template.';
  } else if (/^tg:\/\/[a-z0-9_]+\?[^=]+=$/i.test(candidate)) {
    candidateType = 'uri-query-prefix';
    category = 'deep-link';
    reviewNote = 'Partial URI with a query parameter name but no value. Use the surrounding parser and official documentation to recover the complete parameter schema.';
  } else if (/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(candidate)
      || /^tg:\/\//i.test(candidate)
      || /^tonsite:\/\//i.test(candidate)) {
    candidateType = 'full-uri';
    category = value.startsWith('tonsite:') ? 'ton-sites' : 'deep-link';
    reviewNote = 'Looks like a URI example or partial URI; confirm required parameters and whether it is a documented public format.';
  } else if (/^(?:\?(?:enablelogs|disablelogs|sendlogs)\b|login_email$)/i.test(candidate)) {
    candidateType = candidate.startsWith('?') ? 'query-fragment' : 'handler-token';
    category = /logs/i.test(candidate) ? 'diagnostics' : 'authentication';
    classification = 'likely-internal-or-contextual';
    reviewNote = 'This token appears in a diagnostic/authentication settings branch, not as a complete documented deep-link template. Do not publish it as a standalone link.';

  } else if (candidate.startsWith('?')) {
    candidateType = 'query-fragment';
    category = 'query-parameters';
    reviewNote = 'Query fragment only; it needs a valid base URL and may be an option handled by a particular route.';
  } else if (/^(?:addstickers|addemoji|addtheme|addstyle|bg|call|contact|invoice|login|joinchat|proxy|socks|setlanguage|giftcode|boost|story|privatepost|resolve|settings|nft|msg|share|stargift_auction|stargift_preview)\//i.test(candidate)) {
    candidateType = 'path-prefix';
    category = /^(?:addstickers|addemoji)/i.test(candidate) ? 'stickers-and-emoji'
      : /^(?:addtheme|addstyle|bg)\//i.test(candidate) ? 'themes-and-backgrounds'
      : /^(?:invoice|giftcode|boost)\//i.test(candidate) ? 'payments-and-gifts'
      : /^(?:stargift_auction|stargift_preview|nft)\//i.test(candidate) ? 'collectibles-and-gifts'
      : /^(?:call|joinchat)\//i.test(candidate) ? 'calls-and-invites'
      : /^(?:settings|setlanguage)\//i.test(candidate) ? 'settings-and-language'
      : /^(?:login)\//i.test(candidate) ? 'authentication'
      : 'chat-and-navigation';
    reviewNote = 'Looks like a route prefix. The required path parameters and host/scheme must be recovered from the surrounding implementation before publishing.';
  } else if (/^\/(?:[a-z0-9_-]+)?(?:\?|$)/i.test(candidate)) {
    candidateType = 'path-fragment';
    category = 'path-fragments';
    reviewNote = 'Relative path fragment only; inspect the URL construction and caller before treating it as a deep link.';
  } else if (/^(?:settings|contacts?|new_dialog|login_email|restore_purchases|importstickers|scanqr|msg_url|privatepost|resolve|proxy|socks|call|nft|invoice|gift|auth|search|confirmphone|setlanguage)\b/i.test(candidate)) {
    candidateType = 'handler-token';
    category = /^(?:login|auth|confirmphone)/i.test(candidate) ? 'authentication'
      : /^(?:invoice|gift|restore_purchases)/i.test(candidate) ? 'payments-and-gifts'
      : /^(?:settings|contacts?)/i.test(candidate) ? 'settings-and-navigation'
      : /^(?:new_dialog)/i.test(candidate) ? 'internal-intent-action'
      : 'handler-route';
    if (/^new_dialog$/i.test(candidate)) {
      classification = 'likely-internal-or-contextual';
      reviewNote = 'Android Intent action used to open the new-dialog UI, not a Telegram public deep-link route.';
    } else {
      reviewNote = 'This appears to be a route/handler token rather than a complete URI; verify how the client combines it with a scheme, host, path, and parameters.';
    }
  } else if (/\b(?:sendlogs|disablelogs|enablelogs|login_email)\b/i.test(context)) {
    candidateType = 'contextual-token';
    category = 'diagnostics-or-authentication';
    classification = 'likely-internal-or-contextual';
    reviewNote = 'Found in a diagnostic/authentication branch; likely not a general-purpose public deep-link template.';
  }

  return { candidateType, category, classification, classificationMethod: 'heuristic-v1', reviewNote };
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
      sourceContext: lines.slice(Math.max(0, lineNumber - 3), Math.min(lines.length, lineNumber + 2))
        .map((text, index) => ({ line: Math.max(0, lineNumber - 3) + index + 1, text: text.trim().slice(0, 400) })),
      reviewStatus: 'needs_review',
      ...classifyCandidate(candidate, excerpt, extraction),
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

const USER_CONFIRMED_RUNTIME_ROUTES = [
  {
    template: 'tg://addcontact?name=<name>&phone=<phone>',
    route: 'tg://addcontact',
    purpose: 'Open the add-contact flow with a name and phone number.',
    parameters: [
      { name: 'name', required: false, description: 'Contact display name.' },
      { name: 'phone', required: false, description: 'Phone number to add.' }
    ],
    sourceNeedle: 'url.startsWith("tg://addcontact")',
    sourceLineHint: 2696,
    verification: 'user-confirmed-working',
    caveat: 'The source reads name and phone query parameters; phone values containing + should be URL-encoded correctly.'
  },
  {
    template: 'tg://send_gift?to=<username-or-user_id>',
    route: 'tg://send_gift',
    purpose: 'Open the gift flow for a recipient.',
    parameters: [
      { name: 'to', required: false, description: 'Recipient username (with or without @) or numeric user ID. If omitted, Telegram opens recipient selection.' }
    ],
    sourceNeedle: 'url.startsWith("tg://send_gift")',
    sourceLineHint: 2739,
    verification: 'user-confirmed-working',
    caveat: 'Recipient resolution and gift availability depend on the Telegram account and recipient.'
  },
  {
    template: 'tg://calllog',
    route: 'tg://calllog',
    purpose: 'Open the call log.',
    parameters: [],
    sourceNeedle: 'url.startsWith("tg://calllog")',
    sourceLineHint: 2652,
    verification: 'user-confirmed-working',
    caveat: 'Client action; not listed as an official public template in the documentation snapshot.'
  },
  {
    template: 'tg://scanqr',
    route: 'tg://scanqr',
    purpose: 'Open the QR-scanning flow.',
    parameters: [],
    sourceNeedle: 'url.startsWith("tg://scanqr")',
    sourceLineHint: 2694,
    verification: 'user-confirmed-working',
    caveat: 'Requires the client/device to be able to use the camera and the relevant UI.'
  }
];

const NOT_CONFIRMED_TG_SCHEME_FORMS = [
  { template: 'tg://enablelogs', observedFragment: '?enablelogs' },
  { template: 'tg://disablelogs', observedFragment: '?disablelogs' },
  { template: 'tg://sendlogs', observedFragment: '?sendlogs' },
  { template: 'tg://login_email', observedFragment: 'login_email' }
];

function buildRuntimeLinks(androidSource) {
  const lines = androidSource.split(/\r?\n/);
  return USER_CONFIRMED_RUNTIME_ROUTES.map(route => {
    const sourceLine = lines.findIndex(line => line.includes(route.sourceNeedle));
    if (sourceLine < 0) {
      throw new Error('Expected Android route handler was not found: ' + route.route);
    }
    return {
      ...route,
      source: 'android_launch_activity',
      sourceUrl: JAVA_PAGE_URL,
      sourceLine: sourceLine + 1,
      officialDocumentationStatus: 'not-confirmed-as-official-template',
      note: 'Separate from data/documented-links.json. User-confirmed runtime behavior plus an explicit Android handler; not a claim of official public documentation.'
    };
  });
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
  if (!/<(?:html|article|main|h[1-6])\\b/i.test(html.text) || html.text.length < 1000) {
    throw new Error('The official deep-link website did not return recognizable HTML.');
  }
  const docs = { ...html, text: htmlToMarkdown(html.text) };
  if (!/^\\s*#/m.test(docs.text) || docs.text.length < 1000) {
    throw new Error('Could not extract usable deep-link documentation from the official website HTML.');
  }

  const documented = parseMarkdown(docs.text);
  const malformed = documented.filter(item =>
    /<\\/?code>/i.test(item.template)
    || /(?:t\\.me|telegram\\.me|telegram\\.dog)\\/\\s+(?:\\?|\\/|$)/i.test(item.template)
    || /\\btg:\\s+\\//i.test(item.template)
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
