import { readFile, writeFile } from 'node:fs/promises';
const INVENTORY_PATH='data/publication-inventory.json';
const STATE_PATH='data/rich-notification-state.json';
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID=process.env.TELEGRAM_CHAT_ID||'1314643983';
const RUN_NUMBER=process.env.GITHUB_RUN_NUMBER||'unknown';
const stable=x=>JSON.stringify({template:x.template,category:x.category,group:x.group,placeholders:x.placeholders});
function table(headers,rows){return{type:'table',is_bordered:true,is_striped:true,is_compact:true,cells:[headers.map(text=>({text,is_header:true})),...rows.map(row=>row.map(text=>({text:String(text??'')})))]};}
async function sendRich(blocks){const r=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendRichMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,rich_message:{blocks}}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.ok)throw Error('Telegram Rich Message report failed: '+(j.description||r.status));}
async function save(items){await writeFile(STATE_PATH,JSON.stringify({notifiedAt:new Date().toISOString(),inventory:items},null,2)+'\n','utf8');}
async function main(){
  if(!TOKEN)throw Error('TELEGRAM_BOT_TOKEN is not configured.');
  const items=JSON.parse(await readFile(INVENTORY_PATH,'utf8'));
  const summary=JSON.parse(await readFile('data/summary.json','utf8'));
  let previous=null;try{previous=JSON.parse(await readFile(STATE_PATH,'utf8')).inventory;}catch{}
  const blocks=[{type:'heading',size:2,text:'Documentation update'},{type:'paragraph',text:'Crawl run '+RUN_NUMBER+' completed successfully.'},table(['Metric','Current'],[['Documented formats',String(summary.counts.documentedTemplates)],['Documentation sections',String(summary.counts.documentationGroups)]])];
  if(!previous){
    blocks.push({type:'paragraph',text:'Initial change-detection baseline created.'});
    await sendRich(blocks);await save(items);return;
  }
  const before=new Map(previous.map(x=>[x.id,x])),after=new Map(items.map(x=>[x.id,x]));
  const added=items.filter(x=>!before.has(x.id));
  const removed=previous.filter(x=>!after.has(x.id));
  const changed=items.filter(x=>before.has(x.id)&&stable(x)!==stable(before.get(x.id)));
  blocks.push(table(['Change','Count'],[['Added',String(added.length)],['Updated',String(changed.length)],['Removed',String(removed.length)]]));
  const changes=[...added.map(x=>['Added',x]),...changed.map(x=>['Updated',x]),...removed.map(x=>['Removed',x])];
  if(!changes.length)blocks.push({type:'paragraph',text:'No documented-link changes detected.'});
  else{
    const rows=changes.slice(0,40).map(([kind,item])=>[kind,item.template,(item.category||'')+(item.group&&item.group!=='General'?' · '+item.group:'')]);
    blocks.push(table(['Status','Documented format','Section'],rows));
    if(changes.length>40)blocks.push({type:'paragraph',text:'Additional changes: '+(changes.length-40)+'.'});
  }
  await sendRich(blocks);await save(items);
}
main().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
