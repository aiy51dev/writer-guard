/* 截图验证：智录笔记投递到编辑台后的排版预览（人工看效果用）
 * 用法：node tools/shot-handoff.js
 * 产出：screenshots/shot-handoff.png
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8914;
const PORT_CDP = 9360;
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

/* 造一张带文字的“截图”，更像真实笔记 */
const MAKE_IMG = `(function(){
  var c=document.createElement('canvas'); c.width=640; c.height=360;
  var x=c.getContext('2d');
  var g=x.createLinearGradient(0,0,640,360); g.addColorStop(0,'#1e293b'); g.addColorStop(1,'#0e7490');
  x.fillStyle=g; x.fillRect(0,0,640,360);
  x.fillStyle='rgba(255,255,255,.9)'; x.font='bold 40px system-ui'; x.fillText('视频截图 · 01',48,150);
  x.fillStyle='rgba(255,255,255,.55)'; x.font='22px system-ui'; x.fillText('这里是一句讲解字幕',48,200);
  return c.toDataURL('image/png');
})()`;

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1560,1180', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgshot-' + Date.now(),
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
    var img=${MAKE_IMG};
    var img2=(function(){var c=document.createElement('canvas');c.width=640;c.height=360;var x=c.getContext('2d');x.fillStyle='#f59e0b';x.fillRect(0,0,640,360);x.fillStyle='#0f172a';x.font='bold 34px system-ui';x.fillText('视频截图 · 02',52,180);return c.toDataURL('image/png')})();
    var md=[
      '## 三个让短视频不油腻的动作',
      '',
      '很多人以为「不油腻」是靠滤镜，其实==开头三秒==就决定了观众留不留。',
      '',
      '> 这条笔记来自智录笔记的段落底色，投递时保留成引用块，不再塌成纯文字。',
      '',
      '![截图1](wgimg:shot-1)',
      '',
      '第一个动作：**先给结果，再讲过程**。镜头不要从「大家好」开始。',
      '',
      '- 动作一：开头直接抛结论',
      '- 动作二：中段只留一个转折',
      '- 动作三：结尾留一句反问',
      '',
      '![截图2](wgimg:shot-2)',
      '',
      '把这两张截图配上去，读者一眼就知道在讲什么。'
    ].join('\\n');
    WG.Studio.toWriter(md,'三个让短视频不油腻的动作',{'shot-1':img,'shot-2':img2});
    await wait(900);
    document.getElementById('wgw-dev-phone');
    return document.getElementById('wgw-md').value;
  })()`;

  const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined });
  console.log('正文预览（前 200 字）：\n' + String((r.result && r.result.result && r.result.result.value) || '').slice(0, 200));

  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outDir = path.join(ROOT, 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'shot-handoff.png');
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('已保存 ' + out);

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(0);
})();
