// Offline Chromium regression. No provider/network/clipboard access.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const desktop = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(desktop, 'renderer.js'), 'utf8');
const mobile = path.resolve(desktop, '../mobile/shared/js');
const prompt = 'Explain how to preserve complete answers through boxless wrappers';
const answer = 'LATEST COMPLETE ANSWER: preserve every paragraph of this response, including the final conclusion. '.repeat(5);
const turn = (text, marker = true) => `<div data-testid="assistant-message"><h2>Claude responded: status</h2><div data-transcript-engine-root class="contents"><div ${marker ? 'data-perf-reply-text' : 'class="legacy-response"'}><p>Visible introduction before the boxless section.</p><div class="contents"><p>${text}</p><ul><li>Final conclusion retained.</li></ul><table><tr><th>Item</th><th>Result</th></tr><tr><td>Reply</td><td>Complete</td></tr></table></div><div style="display:none">HIDDEN_NONE</div><div class="contents" style="visibility:hidden">HIDDEN_CONTENTS</div><div style="visibility:hidden">HIDDEN_VISIBILITY</div></div></div><button>Copy</button><p>2 minutes ago</p></div>`;
const fixture = `<div data-testid="user-message">Old question</div>${turn('OLD ANSWER '.repeat(200))}<div data-testid="user-message">${prompt}</div>${turn(answer).replace('<div data-transcript-engine-root', '<div data-perf-reply-text><p>Intermediate response before tool use.</p></div><div data-transcript-engine-root')}`;
const legacy = `<div data-testid="user-message">${prompt}</div>${turn(answer, false)}`;
const tokens = text => (String(text).match(/[\p{L}\p{N}]+/gu) || []).join(' ');
function complete(actual, expected) {
  const a = tokens(actual).split(' '), e = tokens(expected).split(' ');
  let i = 0;
  for (const token of a) if (token === e[i]) i++;
  assert.equal(i, e.length, 'Reply must retain every original word, in order');
}
async function injected(source) {
  let code;
  const context = vm.createContext({ webviews: { slot: { getURL: () => 'https://claude.ai/chat/offline', executeJavaScript: async s => { code = s; return {}; } } }, webviewReady: { slot: true }, detectServiceByUrl: () => 'claude', lastDomScrapeDebugBySlot: new Map(), console });
  const start = source.indexOf('async function getLatestAssistantReply(');
  vm.runInContext(source.slice(start, source.indexOf('function rememberResolvedSourcePrompt', start)) + '\nthis.run = getLatestAssistantReply;', context);
  await context.run('slot');
  return code;
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
  const win = new BrowserWindow({ show: false, width: 1100, height: 900 });
  const wc = win.webContents;
  const domScript = await injected(renderer);
  const rawScript = fs.readFileSync(path.join(mobile, 'extractLatestAssistantRaw.js'), 'utf8');
  const scrapeScript = fs.readFileSync(path.join(mobile, 'scrapeReply.js'), 'utf8');
  const pages = [{ label: 'synthetic', html: fixture }, { label: 'legacy', html: legacy }];
  for (const file of process.argv.slice(2)) pages.push({ label: path.basename(file), html: fs.readFileSync(file, 'utf8') });
  for (const page of pages) {
    const html = page.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<style>.contents{display:contents}</style>' + html));
    const desktopResult = await wc.executeJavaScript(domScript);
    const expected = await wc.executeJavaScript(`(() => {const turns = [...document.querySelectorAll('[data-testid="assistant-message"]')]; const bodies = turns.at(-1)?.querySelectorAll('[data-perf-reply-text],.legacy-response') || []; return [...bodies].map(body => body.innerText).join('\\n');})()`);
    assert(expected.length > 300);
    complete(desktopResult.raw, expected);
    assert(!desktopResult.raw.includes('HIDDEN_'));
    if (page.label !== 'legacy') {
      assert.equal(desktopResult.diagnostics.selected.selector_hint, '[data-testid="assistant-message"]');
      assert(!desktopResult.raw.includes('Claude responded:'));
      assert(!desktopResult.raw.includes('minutes ago'));
    }
    await wc.executeJavaScript(rawScript + '\n' + scrapeScript + '\nvoid 0;');
    const payload = { serviceId: 'claude', sourcePrompt: desktopResult.diagnostics.prompt_candidate?.text || '', compactDiagnostics: true };
    const raw = JSON.parse(await wc.executeJavaScript(`VeritySharedExtractLatestAssistantRaw.run(${JSON.stringify(payload)})`));
    complete(raw.raw, expected);
    const android = JSON.parse(await wc.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify(payload)})`));
    assert(android.success, JSON.stringify(android)); complete(android.text, expected);
    const ios = JSON.parse(await wc.executeJavaScript(`VeritySharedScrapeReply.run(${JSON.stringify({ ...payload, rawReplyOverride: raw.raw })})`));
    assert(ios.success, JSON.stringify(ios)); complete(ios.text, expected);
    for (const text of [raw.raw, android.text, ios.text]) assert(!text.includes('HIDDEN_'));
    if (page.label === 'synthetic') {
      for (const text of [desktopResult.raw, raw.raw, android.text, ios.text]) assert(!text.includes('OLD ANSWER'));
      const traversal = 'if (el !== rootEl && !visible(el)) {\n          const style = window.getComputedStyle(el);\n          if (style.display !== \'contents\' || style.visibility === \'hidden\') return;\n        }';
      assert(renderer.includes(traversal), 'Traversal mutation must match once');
      const broken = await wc.executeJavaScript(await injected(renderer.replace(traversal, 'if (el !== rootEl && !visible(el)) return;')));
      assert(!broken.raw?.includes('LATEST COMPLETE ANSWER'), 'Original bug must lose the reply');
      const overbroad = await wc.executeJavaScript(await injected(renderer.replace(traversal, '')));
      assert(overbroad.raw.includes('HIDDEN_'), 'Removing visibility protection must leak hidden text');
      console.log('PASS mutations: original loses reply; overbroad traversal leaks hidden content');
    }
    console.log(`PASS ${page.label}: desktop ${desktopResult.raw.length}, Android ${android.text.length}, iOS ${ios.text.length}; complete source text retained`);
  }
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
