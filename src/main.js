import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { crawl } from './crawl.js';
import { sendFamily, sendTestMessage } from './publish.js';

const DATA = new URL('../data/', import.meta.url);
const STATE_FILE = new URL('state.json', DATA);

async function readState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveState(state) {
  await mkdir(DATA, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
function snapshot(family) {
  return {
    title: family.title,
    templates: [...(family.templates || [])].sort(),
    options: [...(family.options || [])].sort(),
    ready: [...(family.ready || [])].sort(),
    documentation: family.documentation || ''
  };
}
function difference(current, previous) {
  const old = new Set(previous || []);
  return (current || []).filter(value => !old.has(value));
}

async function main() {
  const result = await crawl();
  let state = await readState();
  const families = result.families || [];

  if (!state) {
    const testMessage = await sendTestMessage({
      count: result.total,
      overlap: result.verification.overlap,
      familyCount: families.length
    });
    state = {
      initializedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      source: result.sources,
      inventory: result.inventory.map(item => ({ id: item.id, template: item.template })),
      familySnapshots: Object.fromEntries(families.map(f => [f.id, snapshot(f)])),
      previewedFamilies: [],
      pending: [],
      posted: [],
      removedHistory: [],
      testMessage: { messageId: testMessage.message_id, chatId: testMessage.chat.id }
    };
    await saveState(state);
  }

  if (!state.testMessage) {
    const testMessage = await sendTestMessage({
      count: result.total,
      overlap: result.verification.overlap,
      familyCount: families.length
    });
    state.testMessage = { messageId: testMessage.message_id, chatId: testMessage.chat.id };
  }

  // One-time complete Rich Message catalogue delivery to the private test chat.
  // Persist after each family so an interrupted run resumes without repeating completed families.
  const catalogueVersion = 2;
  const deliveredFamilies = new Set(state.richCatalogueFamilies || []);
  if (state.richCatalogueVersion !== catalogueVersion) {
    for (const family of families) {
      if (deliveredFamilies.has(family.id)) continue;
      const sent = await sendFamily(family);
      deliveredFamilies.add(family.id);
      state = {
        ...state,
        richCatalogueFamilies: [...deliveredFamilies],
        familySnapshots: {
          ...(state.familySnapshots || {}),
          [family.id]: snapshot(family)
        },
        lastRichCatalogueDelivery: {
          family: family.title,
          messageIds: sent.map(message => message.message_id),
          chatId: sent[0]?.chat?.id,
          deliveredAt: new Date().toISOString()
        }
      };
      await saveState(state);
      console.log('Complete Rich Message family delivered privately: ' + family.title + ' (' + sent.length + ' message(s)).');
    }
    state.richCatalogueVersion = catalogueVersion;
    await saveState(state);
  }

  // First private preview: representative families only. The public channel is never targeted here.
  const previewTitles = new Set(['Settings links', 'Contacts links', 'New chat links', 'Chat list links', 'Post story links']);
  const previewed = new Set(state.previewedFamilies || []);
  for (const family of families) {
    if (!previewTitles.has(family.title) || previewed.has(family.id)) continue;
    const sent = await sendFamily(family);
    previewed.add(family.id);
    state = {
      ...state,
      previewedFamilies: [...previewed],
      lastPrivatePreview: {
        family: family.title,
        messageIds: sent.map(message => message.message_id),
        chatId: sent[0]?.chat?.id,
        deliveredAt: new Date().toISOString()
      }
    };
    await saveState(state);
    console.log('Private preview delivered: ' + family.title + ' (' + sent.length + ' message(s)).');
  }

  const oldSnapshots = state.familySnapshots || {};
  const hasFamilyBaseline = Object.keys(oldSnapshots).length > 0;
  const nextSnapshots = {};
  for (const family of families) {
    const current = snapshot(family);
    nextSnapshots[family.id] = current;
    const previous = oldSnapshots[family.id];

    // On the first structured run, establish a baseline instead of posting the existing catalogue.
    if (!previous && !hasFamilyBaseline) continue;

    const newOptions = previous ? difference(current.options, previous.options) : current.options;
    const newReady = previous ? difference(current.ready, previous.ready) : current.ready;
    const newTemplates = previous ? difference(current.templates, previous.templates) : current.templates;
    const documentationChanged = !previous || current.documentation !== previous.documentation;
    if (!newOptions.length && !newReady.length && !newTemplates.length && !documentationChanged) continue;

    // Keep the family's URI header even when only a new option or ready link was added.
    const delta = {
      ...family,
      templates: current.templates,
      options: newOptions,
      ready: newReady,
      documentation: current.documentation
    };
    const sent = await sendFamily(delta);
    state = {
      ...state,
      familySnapshots: { ...oldSnapshots, ...nextSnapshots },
      lastDelivery: {
        family: family.title,
        messageIds: sent.map(message => message.message_id),
        chatId: sent[0]?.chat?.id,
        deliveredAt: new Date().toISOString()
      }
    };
    await saveState(state);
    console.log('New documented items privately notified: ' + family.title + ' (' + sent.length + ' message(s)).');
  }

  const oldIds = new Set((state.inventory || []).map(item => item.id));
  const currentIds = new Set(result.inventory.map(item => item.id));
  const removedNow = (state.inventory || []).filter(item => !currentIds.has(item.id));
  const removedHistory = [...(state.removedHistory || [])];
  for (const item of removedNow) {
    if (!removedHistory.some(old => old.id === item.id)) removedHistory.push({ ...item, removedAt: new Date().toISOString() });
  }

  state = {
    ...state,
    checkedAt: new Date().toISOString(),
    source: result.sources,
    inventory: result.inventory.map(item => ({ id: item.id, template: item.template })),
    familySnapshots: nextSnapshots,
    previewedFamilies: [...previewed],
    removedHistory
  };
  await saveState(state);
  console.log('Watcher completed. Families: ' + families.length + '; templates: ' + result.total + '; removed templates recorded: ' + removedNow.length + '.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
