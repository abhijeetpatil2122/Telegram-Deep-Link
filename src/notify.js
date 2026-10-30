import { readFile, writeFile } from 'node:fs/promises';
const INVENTORY_PATH='data/publication-inventory.json', STATE_PATH='data/documentation-notification-state.json';
const TOKEN=process.env.TELEGRAM_BOT_TOKEN, CHAT_ID=process.env.TELEGRAM_CHAT_ID||'1314643983';
const RUN_NUMBER=process.env.GITHUB_RUN_NUMBER||'unknown';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const view=x=>JSON.stringify({template:x.template,category:x.category,group:x.group,placeholders:x.placeholders});
async function send(text){const r=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.ok)throw Error('Telegram report failed: '+(j.description||r.status));}
async function save(items){await writeFile(STATE_PATH,JSON.stringify({notifiedAt:new Date().toISOString(),inventory:items},null,2)+'\n','utf8');}
async function main(){if(!TOKEN)throw Error('TELEGRAM_BOT_TOKEN is not configured.');const items=JSON.parse(await readFile(INVENTORY_PATH,'utf8'));const summary=JSON.parse(await readFile('data/summary.json','utf8'));let previous=null;try{previous=JSON.parse(await readFile(STATE_PATH,'utf8')).inventory;}catch{}
if(!previous){await send('<b>Crawl #'+esc(RUN_NUMBER)+' completed</b>\n\nOfficial documentation baseline initialized.\n'+summary.counts.documentedTemplates+' formats · '+summary.counts.documentationGroups+' sections.');await save(items);return;}
const before=new Map(previous.map(x=>[x.id,x])),after=new Map(items.map(x=>[x.id,x]));
const added=items.filter(x=>!before.has(x.id)),removed=previous.filter(x=>!after.has(x.id)),changed=items.filter(x=>before.has(x.id)&&view(x)!==view(before.get(x.id)));
const lines=['<b>Crawl #'+esc(RUN_NUMBER)+' completed</b>','',''+summary.counts.documentedTemplates+' documented formats · '+summary.counts.documentationGroups+' sections.','','Changes: <b>'+added.length+'</b> new · <b>'+changed.length+'</b> updated · <b>'+removed.length+'</b> removed.'];
const changes=[...added.map(x=>['NEW',x]),...changed.map(x=>['UPDATED',x]),...removed.map(x=>['REMOVED',x])];
if(!changes.length)lines.push('','No documented-link changes detected.');
else for(const [kind,item] of changes.slice(0,15))lines.push('- <b>'+kind+'</b> '+esc(item.template));
if(changes.length>15)lines.push('…and '+(changes.length-15)+' more changes.');
await send(lines.join('\n'));await save(items);}
main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
