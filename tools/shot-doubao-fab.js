/* 截图验证：① 侧边栏「封面设计」移到「智录笔记」上方 ② 公众号编辑页右下角「豆包」按钮 + 侧窗
 * 用法：node tools/shot-doubao-fab.js
 * 产出：screenshots/shot-nav-cover.png / screenshots/shot-doubao-fab.png
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8918;
const PORT_CDP = 9364;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
};

function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => server.listen(PORT_STATIC, () => r(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK = fs.readFileSync(path.join(__dirname, 'test-handoff.js'), 'utf8')
  .match(/const STORAGE_MOCK = `([\s\S]*?)`;/)[1];

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1440,960', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgshot3-' + Date.now(),
    'about:blank',
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    await sleep(350);
    try {
      list = await (await fetch('http://127.0.0.1:' + PORT_CDP + '/json/list')).json();
      if (list && list.length) break;
    } catch (e) { /* 等 Chrome */ }
  }
  if (!list) { console.log('FAIL: CDP 没起来'); server.close(); chrome.kill(); process.exit(1); }

  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0;
  const waits = new Map();
  let ctxId = null;

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Runtime.executionContextCreated') {
      const c = m.params.context;
      if (c.auxData && c.auxData.isDefault && c.auxData.frameId === page.id) ctxId = c.id;
    }
  };

  function send(method, params) {
    const id = ++mid;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => waits.set(id, r));
  }

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });

  const outDir = path.join(ROOT, 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  async function shot(name, clip) {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: clip });
    const f = path.join(outDir, name);
    fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
    console.log('已保存 ' + f);
  }

  /* ---------- ① 侧边栏顺序 ---------- */
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#writer' });
  await sleep(2600);
  const nav = await send('Runtime.evaluate', {
    expression: `(function(){
      var items=[].slice.call(document.querySelectorAll('.side-nav .nav-item')).map(function(b){return b.textContent.trim()});
      return items.slice(0,5).join(' | ');
    })()`,
    returnByValue: true, contextId: ctxId || undefined,
  });
  console.log('侧边栏前 5 项：' + String((nav.result && nav.result.result && nav.result.result.value) || ''));
  await shot('shot-nav-cover.png', { x: 0, y: 0, width: 250, height: 400, scale: 2 });

  /* ---------- ② 公众号编辑页：豆包按钮 + 侧窗 ---------- */
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/tests/editor-doubao-test.html' });
  await sleep(2200);
  const box = await send('Runtime.evaluate', {
    expression: `(async function(){
      var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
      /* 测试页最后一步会把安全台面板打开（悬浮按钮组会隐藏），先收掉 */
      var p=document.querySelector('.wg-panel.is-open');
      if(p){var c=p.querySelector('.wg-close'); if(c) c.click();}
      await wait(250);
      var d=window.__wgDoubao();
      /* 测试页里 mock 的 getURL 是相对路径（404），截图换成真实外壳页地址 */
      d.frame.src='/workbench/doubao-side.html';
      d.setOpen(true);
      await wait(1800);
      var r=d.wrap.getBoundingClientRect();
      var f=d.fab.getBoundingClientRect();
      return {x:Math.round(r.left-24),y:Math.round(r.top-10),
              w:Math.round(window.innerWidth-r.left+24),h:Math.round(window.innerHeight-r.top+10),
              fab:f.top};
    })()`,
    returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });
  const b = (box.result && box.result.result && box.result.result.value) || {};
  console.log('区域: ' + JSON.stringify(b));
  await shot('shot-doubao-fab.png', {
    x: b.x || 0, y: b.y || 0, width: Math.min(b.w || 500, 520), height: Math.min(b.h || 600, 700), scale: 2,
  });

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(0);
})();
