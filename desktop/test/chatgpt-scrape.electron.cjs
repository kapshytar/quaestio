// Offline Chromium regression. Electron <this file> [saved-page.html].
// No network, provider session or system clipboard is used.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const desktop = path.resolve(__dirname, '..');
const mobile = path.resolve(desktop, '../mobile/shared/js');
const renderer = fs.readFileSync(path.join(desktop, 'renderer.js'), 'utf8');

async function injectedScript(name, end) {
  let script;
  const webview = { getURL: () => 'https://chatgpt.com/c/offline', focus() {},
    executeJavaScript: async code => { script = code; return { clicked: false }; } };
  const context = vm.createContext({ webviews: { slot: webview }, webviewReady: { slot: true },
    detectServiceByUrl: () => 'chatgpt', lastDomScrapeDebugBySlot: new Map(), console,
    window: { electronAPI: { readClipboardText() {}, writeClipboardText() {} } },
    readClipboardTextSafe: async () => '', writeClipboardTextSafe: async () => {}, sleep: async () => {} });
  const start = renderer.indexOf(`async function ${name}(`);
  vm.runInContext(renderer.slice(start, renderer.indexOf(end, start)) + `\nthis.run = ${name};`, context);
  await context.run('slot', 'chatgpt');
  return script;
}

const prompt = 'Compare the two approaches and preserve the table in the answer';
const answer = 'LATEST ANSWER: The first approach preserves the complete response and the second checks its association with the question. '.repeat(4);
const turn = (id, question, text) => `<div data-turn-key="${id}"><div data-content-search-unit-key="${id}:user" class="group/user-message">${question}<button aria-label="Copy message">copy</button></div><div class="group flex flex-col"><div data-content-search-unit-key="${id}:assistant"><div data-markdown-text-style="assistant-message"><p>${text}</p><p>The result retains the complete prose and structured comparison below.</p><table><tr><th>Approach</th><th>Result</th></tr><tr><td>DOM</td><td>Complete</td></tr></table><button aria-label="Copy table">table</button></div></div><div class="turn-action-controls"><button aria-label="Copy">copy</button></div></div></div>`;
const fixture = `<html><body><main class="composer-container">${turn('old', 'Previous unrelated question', 'OLD ANSWER '.repeat(500))}${turn('latest', prompt, answer)}<textarea></textarea></main></body></html>`;
const legacy = `<html><body>${turn('latest', prompt, answer)}</body></html>`
  .replace(/data-content-search-unit-key="latest:user"/g, 'data-message-author-role="user"')
  .replace(/data-content-search-unit-key="latest:assistant"/g, 'data-message-author-role="assistant"')
  .replace(/data-markdown-text-style="assistant-message"/g, 'class="assistant-content"')
  .replace('aria-label="Copy"', 'aria-label="Copy" data-testid="copy-turn-action-button"');

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  const wc = window.webContents;
  const domScript = await injectedScript('getLatestAssistantReply', 'function rememberResolvedSourcePrompt');
  const copyScript = await injectedScript('tryCopyLatestAssistantReply', '\nfunction ');
  const rawScript = fs.readFileSync(path.join(mobile, 'extractLatestAssistantRaw.js'), 'utf8');
  const scrapeScript = fs.readFileSync(path.join(mobile, 'scrapeReply.js'), 'utf8');
  const pages = [{ label: 'synthetic', html: fixture }, { label: 'legacy', html: legacy }];
  if (process.argv[2]) pages.push({ label: 'saved-page', html: fs.readFileSync(process.argv[2], 'utf8') });
  for (const page of pages) {
    const html = page.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const result = await wc.executeJavaScript(domScript);
    assert(result.raw.length > 300);
    assert(result.raw.includes('|'));
    if (page.label !== 'legacy') assert.equal(result.diagnostics.selected.selector_hint, '[data-markdown-text-style="assistant-message"]');
    if (page.label === 'synthetic') { assert(result.raw.includes('LATEST ANSWER')); assert(!result.raw.includes('OLD ANSWER')); }
    const sourcePrompt = result.diagnostics.prompt_candidate.text;
    await wc.executeJavaScript(`HTMLElement.prototype.click = function() { window.clickedCopy = { label: this.getAttribute('aria-label'), turn: this.closest('[data-turn-key]')?.getAttribute('data-turn-key') }; }; void 0;`);
    const copy = await wc.executeJavaScript(copyScript);
    const clicked = await wc.executeJavaScript('window.clickedCopy');
    assert(copy.clicked, JSON.stringify(copy));
    assert.equal(clicked.label, 'Copy');
    if (page.label === 'synthetic') assert.equal(clicked.turn, 'latest');
    await wc.executeJavaScript(rawScript + '\n' + scrapeScript + '\nvoid 0;');
    const payload = { serviceId: 'chatgpt', sourcePrompt, compactDiagnostics: true };
    const android = JSON.parse(await wc.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify(payload)})`));
    assert(android.success, JSON.stringify(android));
    assert(android.text.includes('|'));
    const iosRaw = JSON.parse(await wc.executeJavaScript(`VeritySharedExtractLatestAssistantRaw.run(${JSON.stringify(payload)})`));
    assert(iosRaw.raw?.length > 300, JSON.stringify(iosRaw));
    const ios = JSON.parse(await wc.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify({ ...payload, rawReplyOverride: iosRaw.raw })})`));
    assert(ios.success, JSON.stringify(ios));
    assert(ios.text.includes('|'));
    if (page.label === 'synthetic') {
      assert(android.text.includes('LATEST ANSWER') && !android.text.includes('OLD ANSWER'));
      assert(ios.text.includes('LATEST ANSWER') && !ios.text.includes('OLD ANSWER'));
      const wrong = JSON.parse(await wc.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify({ ...payload, sourcePrompt: 'Completely unrelated current question about database backups and restore' })})`));
      assert.equal(wrong.success, false);
      const wrongIOS = JSON.parse(await wc.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify({ ...payload, sourcePrompt: 'Completely unrelated current question about database backups and restore', rawReplyOverride: iosRaw.raw })})`));
      assert.equal(wrongIOS.success, false);
    }
    console.log(`PASS ${page.label}: desktop DOM ${result.raw.length} chars, full-reply Copy, Android direct, iOS raw + sanitize`);
  }
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
