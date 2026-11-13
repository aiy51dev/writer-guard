/* ============================================================
 * 工作台测试页批量跑（CDP 驱动）
 * ------------------------------------------------------------
 * 依次打开 tests/*.html，读取 #out 里的 PASS / FAIL 汇总
 * 用法：node tools/test-pages.js
 *      node tools/test-pages.js writer integration   （只跑指定页面）
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8903;
const PORT_CDP = 9347;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const DEFAULT_PAGES = [
  { file: 'syntax-check.html', wait: 4000 },
  { file: 'engine-test.html', wait: 3000 },
  { file: 'writer-test.html', wait: 3000 },
  { file: 'rewriter-test.html', wait: 3000 },
  { file: 'integration-test.html', wait: 4000 },
  { file: 'insert-cover-test.html', wait: 9500 },
  { file: 'editor-pick-test.html', wait: 16000 },
  { file: 'editor-doubao-test.html', wait: 6000 },
  { file: 'content-watch-test.html', wait: 5000 },
  { file: 'doubao-test.html', wait: 4000 },
];

function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => server.listen(PORT_STATIC, () => r(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_MOCK = `
(function(){
  var mem = {};
  var listeners = [];
  function toCb(obj, cb) { if (typeof cb === 'function') { setTimeout(function(){ cb(obj); }, 0); return; } return Promise.resolve(obj); }
  var local = {
    get: function(keys, cb) {
      var out = {};
      if (keys == null) out = Object.assign({}, mem);
      else if (typeof keys === 'string') { if (keys in mem) out[keys] = mem[keys]; }
      else if (Array.isArray(keys)) keys.forEach(function(k){ if (k in mem) out[k] = mem[k]; });
      else if (typeof keys === 'object') Object.keys(keys).forEach(function(k){ out[k] = (k in mem) ? mem[k] : keys[k]; });
      return toCb(out, cb);
    },
    set: function(obj, cb) { Object.assign(mem, obj); listeners.forEach(function(f){ try { f(obj, 'local'); } catch(e){} }); return toCb({}, cb); },
    remove: function(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(function(k){ delete mem[k]; }); return toCb({}, cb); },
    clear: function(cb) { Object.keys(mem).forEach(function(k){ delete mem[k]; }); return toCb({}, cb); }
  };
  window.chrome = window.chrome || {};
  window.chrome.storage = { local: local, sync: local, onChanged: { addListener: function(f){ listeners.push(f); }, removeListener: function(){} } };
  window.chrome.runtime = { id: 'test', getURL: function(p){ return '/' + p; }, sendMessage: function(){}, onMessage: { addListener: function(){} }, lastError: null };
  window.chrome.tabs = { query: function(o, cb){ if (cb) cb([]); return Promise.resolve([]); }, sendMessage: function(){} };
})();
`;

(async () => {
  const args = process.argv.slice(2);
  const pages = args.length
    ? DEFAULT_PAGES.filter((p) => args.some((a) => p.file.indexOf(a) >= 0))
    : DEFAULT_PAGES;

  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1440,900',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgpages-' + Date.now(),
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CHROME_MOCK });

  const results = [];
  for (const p of pages) {
    ctxId = null;
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/tests/' + p.file });
    await sleep(p.wait);
    const r = await send('Runtime.evaluate', {
      expression: `(function(){
        var o = document.getElementById('out') || document.getElementById('testout');
        if (!o) return { text: '(no #out)', pass: 0, fail: 0 };
        var t = o.textContent || '';
        var m = t.match(/RESULT:\\s*(\\d+)\\s*pass\\s*\\/\\s*(\\d+)\\s*fail/i);
        var pass = 0, fail = 0;
        if (m) {
          pass = Number(m[1]); fail = Number(m[2]);
        } else if (/RESULT:\\s*ALL PASS/i.test(t)) {
          pass = (t.match(/^OK\\b/gm) || []).length || 1; fail = 0;
        } else {
          pass = (t.match(/^PASS/gm) || []).length +
                 (t.match(/:\\s*(yes|ok|found|kept|mounted)\\b/gmi) || []).length;
          fail = (t.match(/^FAIL/gm) || []).length +
                 (t.match(/:\\s*(no|failed|error|missing)\\b/gmi) || []).length;
        }
        return { text: t.slice(0, 4000), pass: pass, fail: fail };
      })()`,
      returnByValue: true,
      contextId: ctxId || undefined,
    });
    const v = (r.result && r.result.result && r.result.result.value) || { text: '(评估失败)', pass: 0, fail: 0 };
    results.push({ file: p.file, pass: v.pass, fail: v.fail, text: v.text });
    console.log('\n=== ' + p.file + ' : ' + v.pass + ' pass / ' + v.fail + ' fail');
    if (v.fail) {
      v.text.split('\n').filter((l) => /^FAIL|ERROR|MISS|ONERROR|^\[诊断\]/.test(l)).slice(0, 14)
        .forEach((l) => console.log('   ' + l));
    }
    if (!v.pass && !v.fail) {
      console.log('   --- 页面输出前 12 行 ---');
      String(v.text || '(空)').split('\n').slice(0, 12).forEach((l) => console.log('   | ' + l.slice(0, 180)));
    }
  }

  const tp = results.reduce((a, b) => a + b.pass, 0);
  const tf = results.reduce((a, b) => a + b.fail, 0);
  console.log('\n==========================');
  console.log('TOTAL: ' + tp + ' pass / ' + tf + ' fail');
  console.log('==========================');

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(tf ? 1 : 0);
})();
