/* 截图验证：排版预览表头的「复制 / 写入编辑器」按钮位置（人工核对用）
 * 用法：node tools/shot-copy-btn.js
 * 产出：screenshots/shot-copy-btn.png
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8916;
const PORT_CDP = 9362;
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
    '--window-size=1560,1000', '--force-device-scale-factor=1.5',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgshot2-' + Date.now(),
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

  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#writer' });
  await sleep(3000);

  const script = `(async function(){
    var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
    var ta=document.getElementById('wgw-md');
    ta.value=['## 三个让短视频不油腻的动作','','很多人以为「不油腻」是靠滤镜，其实==开头三秒==就决定了观众留不留。','','> 引用块示例：这段话带底色。','','- 动作一：开头直接抛结论','- 动作二：中段只留一个转折'].join('\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(600);
    var b=document.getElementById('wgw-copy-top');
    b.click();
    await wait(300);
    var r=(document.querySelector('.wgw-pane .card-actions')||document.querySelector('.wgw-pane .card-head')).getBoundingClientRect();
    return {x:Math.max(0,r.left-260),y:Math.max(0,r.top-46),w:Math.min(760,r.width+300),h:230,
            btn:b.textContent, order:[].slice.call(document.querySelectorAll('.card-actions .btn')).map(function(x){return x.textContent.trim()})};
  })()`;

  const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined });
  const v = (r.result && r.result.result && r.result.result.value) || {};
  console.log('按钮：' + v.btn + ' / 顺序：' + (v.order || []).join(' | '));

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { x: v.x || 0, y: v.y || 0, width: v.w || 700, height: v.h || 220, scale: 2 },
  });
  const outDir = path.join(ROOT, 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'shot-copy-btn.png');
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('已保存 ' + out);

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(0);
})();
