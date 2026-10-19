// Offline GLM regression based on live Z.ai response DOM observed 2026-10-19.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../mobile/shared/js') + '/';
const vm = require('node:vm');
const renderer = fs.readFileSync(path.resolve(__dirname, '../renderer.js'), 'utf8');
async function desktopScript() {
 let code;
 const context = vm.createContext({webviews:{slot:{getURL:()=> 'https://chat.z.ai/c/offline',executeJavaScript:async s=>{code=s;return {}}}},webviewReady:{slot:true},detectServiceByUrl:()=> 'glm',lastDomScrapeDebugBySlot:new Map(),console});
 const start=renderer.indexOf('async function getLatestAssistantReply(');
 vm.runInContext(renderer.slice(start, renderer.indexOf('function rememberResolvedSourcePrompt',start))+'\nthis.run = getLatestAssistantReply;',context);
 await context.run('slot');
 return code;
}
async function generationScripts() {
 let code;
 const context=vm.createContext({webviews:{slot:{executeJavaScript:async s=>{code=s;return false}}},webviewReady:{slot:true}});
 const start=renderer.indexOf('async function isSlotStillGenerating(');
 vm.runInContext(renderer.slice(start,renderer.indexOf('async function tryCopyLatestAssistantReply(',start))+'\nthis.run = isSlotStillGenerating;',context);
 await context.run('slot','glm');
 const native=[['iOS','ios/VerityMobile/SlotWebViewModel.swift','func isStillGenerating('],['Android','android/app/src/main/java/com/chataggregator/app/ChatFragment.kt','fun isStillGenerating(']].map(([name,file,anchor])=>{
  const text=fs.readFileSync(path.resolve(__dirname,'../../mobile',file),'utf8');
  const begin=text.indexOf('"""',text.indexOf(anchor))+3;
  const script=text.slice(begin,text.indexOf('"""',begin)).replace('\\(String(reflecting: sid))','"glm"').replace('$serviceIdJson','"glm"');
  return [name,script];
 });
 return [['desktop',code],...native];
}
const scripts = ['extractLatestAssistantRaw', 'scrapeReply'].map(n => fs.readFileSync(root+n+'.js','utf8')).join('\n');
const answer = 'Проверка сбора ответа GLM: первая строка.\nВторая строка проверки.';
const turn = text => `<div id="response-content-container"><div class="markdown-prose"><div class="thinking-chain-container"><button>Thought Process</button><p>INTERNAL THOUGHTS MUST NOT LEAK</p></div><p>${text}</p></div></div>`;
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
 const win = new BrowserWindow({show:false,width:1100,height:900});
 const desktop = await desktopScript();
 for (const [label,html,expected] of [
  ['latest response excludes reasoning',turn('OLD ANSWER '.repeat(40))+'<div class="user-message">Question</div>'+turn(answer),answer],
  ['previous answer followed by a new user turn',turn(answer)+'<div class="user-message">Новый вопрос, ответ на который ещё не появился</div>',null],
  ['short response uses existing minimum length',turn('тест'),null],
  ['no answer does not collect prompt','<div class="user-message">A long user prompt that must not become an answer.</div>',null],
  ['thinking only',turn(''),null]
 ]) {
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  await win.webContents.executeJavaScript(scripts+'\nvoid 0;');
  const desktopResult=await win.webContents.executeJavaScript(desktop);
  if(expected===null)assert(!desktopResult.raw,JSON.stringify(desktopResult));
  else assert.equal(desktopResult.raw.trim(),expected);
  const raw=JSON.parse(await win.webContents.executeJavaScript('VeritySharedExtractLatestAssistantRaw.run({serviceId:"glm",compactDiagnostics:true})'));
  const scrape=JSON.parse(await win.webContents.executeJavaScript('VeritySharedScrapeReply.run({serviceId:"glm"})'));
  if(expected===null){assert(!raw.raw,JSON.stringify(raw));assert(!scrape.success,JSON.stringify(scrape));}
  else {
   assert.equal(raw.raw.trim(),expected);assert.equal(scrape.text.trim(),expected);assert(scrape.success);
   const ios=JSON.parse(await win.webContents.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify({serviceId:'glm',rawReplyOverride:raw.raw})})`));
   assert(ios.success);assert.equal(ios.text.trim(),expected);
  }
  console.log('PASS '+label);
 }
 const presets = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mobile/shared/contracts/servicePresets.json'), 'utf8'));
 const sendScript = fs.readFileSync(root+'sendMessage.js','utf8');
 const fixtures = {
  qwen: '<textarea class="message-input-textarea"></textarea><button class="send-button" aria-label="Send"></button>',
  glm: '<textarea id="chat-input"></textarea><button id="send-message-button"></button>',
  kimi: '<div class="chat-input-editor" role="textbox" contenteditable="true" style="min-height:30px"></div><div class="send-button-container disabled" style="width:30px;height:30px"></div>',
  minimax: '<div class="tiptap ProseMirror rich-text-editor" contenteditable="true" style="min-height:30px"></div><button aria-label="Send message"></button>'
 };
 for (const [serviceId, html] of Object.entries(fixtures)) {
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html+'<button aria-label="Scheduled task">Wrong control</button>'));
  await win.webContents.executeJavaScript(sendScript+'\nvoid 0;');
  const payload = { serviceId, selectors: presets.services[serviceId].selectors, message: 'Проверка отправки на русском' };
  const result = await win.webContents.executeJavaScript(`new Promise(resolve=>{
   const input=document.querySelector('textarea,[contenteditable]');
   const send=document.querySelector('.send-button,#send-message-button,.send-button-container,[aria-label="Send message"]');
   let sent=false;
   if (send.classList.contains('send-button-container')) setTimeout(()=>send.classList.remove('disabled'),350);
   send.addEventListener('click',()=>{sent=true;resolve({text:input.value||input.innerText})});
   document.querySelector('[aria-label="Scheduled task"]').addEventListener('click',()=>resolve({wrong:true}));
   VeritySharedSendMessage.run(${JSON.stringify(payload)});
   setTimeout(()=>{if(!sent)resolve({timeout:true})},2000);
  })`);
  assert.equal(result.text,payload.message, serviceId+': '+JSON.stringify(result));
  console.log('PASS '+serviceId+' sends through observed composer/send controls');
 }
 const guard = "if (['qwen', 'glm', 'kimi', 'minimax'].includes(serviceId)) return null;";
 assert.equal(sendScript.split(guard).length-1,1,'Provider guard mutation must apply once');
 async function absentSend(serviceId, script) {
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<textarea></textarea><button aria-label="Add scheduled task">Task</button>'));
  await win.webContents.executeJavaScript(script+'\nvoid 0;');
  return win.webContents.executeJavaScript(`new Promise(resolve=>{
   document.querySelector('button').addEventListener('click',()=>resolve({wrong:true}));
   VeritySharedSendMessage.run(${JSON.stringify({serviceId,selectors:presets.services[serviceId].selectors,message:'Проверка отсутствующей отправки'})});
   setTimeout(()=>resolve({wrong:false}),1750);
  })`);
 }
 for (const serviceId of Object.keys(fixtures)) {
  assert.equal((await absentSend(serviceId,sendScript)).wrong,false,serviceId+' must not click a scheduled task');
  console.log('PASS '+serviceId+' missing Send never clicks unrelated task');
 }
 assert.equal((await absentSend('kimi',sendScript.replace(guard,''))).wrong,true,'Removing new-provider guard must restore wrong-control click');
 console.log('PASS mutation: removing provider guard reproduces unrelated task click');
 const generating = value => typeof value === 'string' ? JSON.parse(value).generating : value;
 for (const [name,script] of await generationScripts()) {
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<button><span class="block size-3 rounded-xs" style="display:block;width:12px;height:12px"></span></button>'));
  assert.equal(generating(await win.webContents.executeJavaScript(script)),true,name+' must detect live GLM stop control');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<button id="send-message-button">Send</button>'));
  assert.equal(generating(await win.webContents.executeJavaScript(script)),false,name+' must finish after stop control disappears');
  console.log('PASS '+name+' GLM generating/finished detection');
 }
 win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
