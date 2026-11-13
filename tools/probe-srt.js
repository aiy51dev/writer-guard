/* 探针：沙箱 iframe 里 SRT 按钮为什么没反应 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P1 = 8899, P2 = 9351;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/tests/studio-harness.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => server.listen(P1, r));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--remote-debugging-port=' + P2,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgprobe-srt-' + Date.now(), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) { await sleep(350); try { list = await (await fetch('http://127.0.0.1:' + P2 + '/json/list')).json(); if (list && list.length) break; } catch (e) {} }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0; const waits = new Map(); const contexts = []; const logs = []; let chooser = 0;

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Target.attachedToTarget') {
      send('Runtime.enable', {}, m.params.sessionId);
      send('Page.enable', {}, m.params.sessionId);
      send('Page.setInterceptFileChooserDialog', { enabled: true }, m.params.sessionId);
      return;
    }
    if (m.method === 'Runtime.executionContextCreated') { contexts.push({ id: m.params.context.id, sessionId: m.sessionId || null, aux: m.params.context.auxData || {} }); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[console.' + m.params.type + '] ' + m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[exception] ' + (d.text || '') + ' ' + String((d.exception && d.exception.description) || '').slice(0, 200));
      return;
    }
    if (m.method === 'Page.fileChooserOpened') { chooser++; return; }
  };
  function send(method, params, sessionId) {
    const id = ++mid; const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((r) => waits.set(id, r));
  }
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + P1 + '/tests/studio-harness.html' });
  await sleep(9000);

  async function ev(ctx, expr, optGesture) {
    const r = await send('Runtime.evaluate', { expression: expr, contextId: ctx.id, returnByValue: true, awaitPromise: true, userGesture: !!optGesture }, ctx.sessionId);
    const res = r.result || {};
    if (res.exceptionDetails) return 'ERR:' + (res.exceptionDetails.text || '') + ' ' + String((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || '').slice(0, 200);
    return res.result ? res.result.value : undefined;
  }

  let z = null;
  for (const c of contexts) {
    if (!c.aux.isDefault) continue;
    const v = await ev(c, 'location.href');
    if (typeof v === 'string' && v.indexOf('zhilu.html') >= 0) z = c;
  }
  if (!z) { console.log('no zhilu ctx', contexts.length); process.exit(1); }

  console.log('typeof showOpenFilePicker =', await ev(z, 'typeof window.showOpenFilePicker'));
  console.log('typeof showDirectoryPicker =', await ev(z, 'typeof window.showDirectoryPicker'));
  console.log('typeof indexedDB =', await ev(z, 'typeof indexedDB'));
  console.log('indexedDB 打开测试 =', await ev(z, '(function(){try{indexedDB.open("t",1);return "no-throw";}catch(e){return "throw:"+e.name+" "+e.message}})()'));
  console.log('showOpenFilePicker 调用 =', await ev(z, '(async function(){try{await window.showOpenFilePicker({types:[{accept:{"text/plain":[".srt"]}}]});return "opened";}catch(e){return "throw:"+e.name+" | "+e.message;}})()'));

  chooser = 0;
  await ev(z, '(function(){var b=document.getElementById("watchDirBtn"); if(b) b.click(); return !!b;})()', true);
  await sleep(1200);
  console.log('点 SRT 按钮后 fileChooserOpened 次数 =', chooser);
  console.log('watchStatus 显示 =', await ev(z, '(function(){var s=document.getElementById("watchStatus");return s?("display="+getComputedStyle(s).display+" text="+s.textContent):"none"})()'));
  console.log('srtStatus =', await ev(z, '(function(){var s=document.getElementById("srtStatus");return s?(getComputedStyle(s).display+"|"+s.textContent):"none"})()'));
  console.log('日志面板尾部 =', String(await ev(z, '(function(){var l=document.getElementById("logBox")||document.querySelector(".log-box")||document.querySelector(".log");return l?l.innerText.slice(-300):"no-log"})()')));
  console.log('原生 file input 点击(带手势) =', await ev(z, '(function(){try{document.getElementById("srtFile").click();return "clicked"}catch(e){return "throw:"+e.name}})()', true));
  console.log('input.showPicker 可用 =', await ev(z, 'typeof document.getElementById("srtFile").showPicker'));
  await sleep(900);
  console.log('点击后 fileChooserOpened 次数 =', chooser);
  console.log('--- logs ---'); logs.slice(-12).forEach((l) => console.log(l));

  /* 截图看看文件选择框长什么样 */
  await ev(z, '(function(){var b=document.getElementById("watchDirBtn"); if(b) b.click(); return !!b;})()');
  await sleep(700);
  console.log('文件框节点数 =', await ev(z, 'document.querySelectorAll("[data-wg-filepicker]").length'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.join(ROOT, 'screenshots/shot-srt-picker.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('截图已存 screenshots/shot-srt-picker.png');
  }

  ws.close(); chrome.kill(); server.close(); process.exit(0);
})();
