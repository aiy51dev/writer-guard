/* 用 CDP 检查 MV3 沙箱页能力：localStorage / confirm 是否被拦 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const EXT = process.argv[2] || '/tmp/wgprobe-ext';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function extId(p) {
  const h = crypto.createHash('sha256').update(p).digest('hex').slice(0, 32);
  return h.split('').map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const id = extId(EXT.replace(/\\/g, '/'));
console.log('computed id:', id);

const child = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + 'C:/Users/Aiy51/AppData/Local/Temp/wgprof-' + Date.now(),
  '--load-extension=' + EXT,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

child.stdout.on('data', (d) => process.stdout.write('[chrome] ' + d));
child.stderr.on('data', (d) => {
  const s = String(d);
  if (/DevTools listening|ERROR|FATAL/.test(s)) process.stdout.write('[chrome:err] ' + s);
});
child.on('exit', (code) => console.log('[chrome exit]', code));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargets() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return r.json();
}

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      list = await getTargets();
      if (list && list.length) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!list) { console.log('FAIL: devtools 没起来'); child.kill(); process.exit(1); }

  const page = list.find((t) => t.type === 'page');
  if (!page) { console.log('FAIL: 没有 page target'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const waits = new Map();
  const events = [];
  let dialogSeen = null;

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogSeen = m.params;
      send('Page.handleJavaScriptDialog', { accept: false });
    }
    events.push(m.method);
  };

  function send(method, params) {
    const id2 = ++msgId;
    ws.send(JSON.stringify({ id: id2, method, params: params || {} }));
    return new Promise((res) => waits.set(id2, res));
  }

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');

  const url = 'chrome-extension://' + id + '/probe.html';
  await send('Page.navigate', { url });
  await sleep(2500);

  const r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({url: location.href, origin: location.origin, r: window.__r || null})',
    returnByValue: true,
  });

  console.log('result:', r.result && r.result.result && r.result.result.value);
  console.log('dialog:', dialogSeen ? JSON.stringify(dialogSeen).slice(0, 160) : 'NONE');

  // 顺手测 iframe 版本
  await send('Page.navigate', { url: 'chrome-extension://' + id + '/host.html' });
  await sleep(2000);
  const r2 = await send('Runtime.evaluate', {
    expression: `(function(){ var f=document.getElementById('f'); try { return JSON.stringify({ok:1, inner: f.contentDocument ? 'same-origin' : 'cross-origin'}); } catch(e){ return 'catch:'+e.name; } })()`,
    returnByValue: true,
  });
  console.log('host frame:', r2.result && r2.result.result && r2.result.result.value);

  ws.close();
  child.kill();
  process.exit(0);
})();
