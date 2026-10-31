import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { crawl } from './crawl.js';
import { sendDiscovery, sendTestMessage } from './publish.js';

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

async function main() {
  const result = await crawl();
  let state = await readState();

  if (!state) {
    const testMessage = await sendTestMessage({
      count: result.total,
      overlap: result.verification.overlap
    });
    await saveState({
      initializedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      source: result.sources,
      inventory: result.inventory.map(item => ({ id: item.id, template: item.template })),
      pending: [],
      posted: [],
      removedHistory: [],
      testMessage: { messageId: testMessage.message_id, chatId: testMessage.chat.id }
    });
    console.log('Initial baseline saved (' + result.total + ' formats); private-chat test message delivered.');
    return;
  }

  const current = result.inventory.map(item => ({ id: item.id, template: item.template }));
  const known = new Set(state.inventory.map(item => item.id));
  const alreadyPosted = new Set(state.posted || []);
  const newlyFound = result.inventory.filter(item => !known.has(item.id) && !alreadyPosted.has(item.id));
  const pendingById = new Map((state.pending || []).map(item => [item.id, item]));
  for (const item of newlyFound) pendingById.set(item.id, item);

  const currentIds = new Set(current.map(item => item.id));
  const removedNow = state.inventory.filter(item => !currentIds.has(item.id));
  const removedHistory = [...(state.removedHistory || [])];
  for (const item of removedNow) {
    if (!removedHistory.some(old => old.id === item.id)) {
      removedHistory.push({ ...item, removedAt: new Date().toISOString() });
    }
  }

  state = {
    ...state,
    checkedAt: new Date().toISOString(),
    source: result.sources,
    inventory: current,
    pending: [...pendingById.values()],
    removedHistory
  };
  await saveState(state);

  const itemById = new Map(result.inventory.map(item => [item.id, item]));
  for (const pending of [...state.pending]) {
    const item = itemById.get(pending.id) || pending;
    const message = await sendDiscovery(item);
    const posted = new Set(state.posted || []);
    posted.add(item.id);
    state = {
      ...state,
      pending: state.pending.filter(entry => entry.id !== item.id),
      posted: [...posted],
      lastDelivery: {
        id: item.id,
        template: item.template,
        messageId: message.message_id,
        chatId: message.chat.id,
        deliveredAt: new Date().toISOString()
      }
    };
    await saveState(state);
    console.log('Published ' + item.template + ' (message ' + message.message_id + ').');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('Watcher run completed. New formats queued: ' + newlyFound.length + '; removed formats recorded: ' + removedNow.length + '.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
