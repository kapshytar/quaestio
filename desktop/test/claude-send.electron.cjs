// Offline Chromium regression: no real provider prompts or network requests.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const desktop = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.resolve(desktop, '../mobile/shared/js/sendMessage.js'), 'utf8');
const renderer = fs.readFileSync(path.join(desktop, 'renderer.js'), 'utf8');
const selectors = { textarea: [], contenteditable: ['[contenteditable="true"]'], button: ['button[aria-label*="Send"]'] };
const message = 'Hello\nSecond line';
const payload = { message, serviceId: 'claude', selectors };
const fixture = decoy => `<button aria-label="Add scheduled task" onclick="window.taskClicks++">Task</button><div class="composer"><div contenteditable="true" enterkeyhint="enter"></div>${decoy ? '<button aria-label="Send project instructions" onclick="window.projectClicks++">Project</button>' : ''}<button id="send" aria-label="Send message" disabled onclick="window.sendClicks++">Send</button></div>`;
async function desktopScript() {
  let code;
  const context = vm.createContext({ activeSendCount: 0, reportBackgroundWorkState() {}, webviews: { slot: { getURL: () => 'https://claude.ai/project/offline', executeJavaScript: async s => { code = s; return { success: true }; } } }, normalizeSelectors: s => s, getSelectorsForSlot: () => selectors, setStatus() {}, window: {}, detectServiceByUrl: () => 'claude', debugModeToggle: { checked: false }, console });
  const start = renderer.indexOf('async function sendMessage(slot, text)');
  vm.runInContext(renderer.slice(start, renderer.indexOf('async function sendToAll()', start)) + '\nthis.run = sendMessage;', context);
  await context.run('slot', message);
  return code;
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
  const win = new BrowserWindow({ show: false });
  const wc = win.webContents;
  async function load(decoy, enableAfter) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fixture(decoy)));
    await wc.executeJavaScript(`window.taskClicks=0; window.projectClicks=0; window.sendClicks=0; window.enterCount=0; document.querySelector('[contenteditable]').addEventListener('keydown', e => { if(e.key==='Enter') window.enterCount++; }); ${enableAfter === null ? '' : `setTimeout(() => document.getElementById('send').disabled=false, ${enableAfter});`} void 0;`);
  }
  const wait = ms => wc.executeJavaScript(`new Promise(resolve => setTimeout(resolve, ${ms}))`);
  const result = () => wc.executeJavaScript(`({task:window.taskClicks,project:window.projectClicks,send:window.sendClicks,enter:window.enterCount,text:document.querySelector('[contenteditable]').innerText})`);
  for (const decoy of [false, true]) {
    await load(decoy, 350);
    await wc.executeJavaScript(shared + `\nVeritySharedSendMessage.run(${JSON.stringify(payload)});`);
    await wait(650);
    let r = await result();
    assert.deepEqual({ task: r.task, project: r.project, send: r.send, enter: r.enter }, { task: 0, project: 0, send: 1, enter: 0 });
    assert.equal(r.text.trim(), message);
    await wc.executeJavaScript(`VeritySharedSendMessage.run(${JSON.stringify(payload)});`);
    await wait(250);
    r = await result(); assert.equal(r.send, 2); assert.equal(r.task + r.project, 0);
    console.log(`PASS mobile shared: first delayed send + repeat, ${decoy ? 'broad-selector project decoy' : 'scheduled task'} untouched`);
  }
  await load(true, null);
  await wc.executeJavaScript(shared + `\nVeritySharedSendMessage.run(${JSON.stringify(payload)});`);
  await wait(1750);
  let r = await result(); assert.equal(r.task + r.project + r.send, 0); assert.equal(r.enter, 1);
  console.log('PASS missing Send: Enter fallback, no unrelated controls clicked');
  const guard = "if (serviceId === 'claude') return null;";
  assert.equal(shared.split(guard).length - 1, 1, 'Mutation must apply once');
  await load(false, null);
  await wc.executeJavaScript(shared.replace(guard, '') + `\nVeritySharedSendMessage.run(${JSON.stringify(payload)});`);
  await wait(250); r = await result(); assert.equal(r.task, 1, 'Original heuristic must click scheduled task');
  console.log('PASS mutation: generic ask substring wrongly clicks Add scheduled task');
  const script = await desktopScript();
  await load(true, null); await wc.executeJavaScript(script); r = await result(); assert.equal(r.task + r.project + r.send, 0); assert.equal(r.enter, 1);
  await load(true, 0); await wait(30); await wc.executeJavaScript(script); r = await result(); assert.equal(r.send, 1); assert.equal(r.task + r.project, 0);
  console.log('PASS desktop parity: exact send control, no task/project fallback');
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
