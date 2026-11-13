/* ============================================================
 * 智录笔记 → 编辑台 投递链路测试（CDP 驱动）
 * ------------------------------------------------------------
 * 用户报的问题：
 *   ① 发到编辑台后，正文里全是 data:image 的 base64「图片代码」
 *   ② 排版预览里看不到智录笔记的排版，只有一坨文字
 *   ③ 截图直接嵌进 Markdown，编辑台卡死
 *
 * 覆盖：
 *   A. 桥接转换：按钮文字不进正文、截图变短代号、真图单独带出、
 *      标题/列表/带底色段落保留结构
 *   B. 编辑台落位：正文只有 `![截图](wgimg:xx)`，预览显示真图，
 *      统计显示图片数
 *   C. 缺图兜底：图丢了不显示代码，显示灰框提示
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8912;
const PORT_CDP = 9358;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

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

const STORAGE_MOCK = `
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
  window.chrome.runtime = {
    id: 'test',
    getURL: function(p){ return '/' + p; },
    sendMessage: function(msg, cb){ if (typeof cb === 'function') setTimeout(function(){ cb({ ok: false, msg: 'test' }); }, 0); },
    onMessage: { addListener: function(){} },
    lastError: null
  };
  window.chrome.tabs = { query: function(o, cb){ if (cb) cb([]); return Promise.resolve([]); }, sendMessage: function(){}, create: function(){} };
})();
`;

const PAGE_WRITER = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  try {
    await wait(700);
    var ta = document.getElementById('wgw-md');
    var pv = document.getElementById('wgw-preview');
    var stats = document.getElementById('wgw-stats');
    if (!ta || !pv) { chk('编辑台页面元素缺失', false); return out; }

    /* ---------- A. 投递落位 ---------- */
    var md = '## 小标题\\n\\n第一段带 ==重点== 的文字。\\n\\n![截图1](wgimg:h1-1)\\n\\n- 第一条\\n- 第二条';
    WG.Studio.toWriter(md, '测试标题', { 'h1-1': B64 });
    await wait(600);

    chk('正文已进编辑区', ta.value.indexOf('## 小标题') >= 0, ta.value.slice(0, 30));
    chk('正文里是短代号，不是 base64', ta.value.indexOf('wgimg:h1-1') >= 0 && ta.value.indexOf('data:image') < 0,
      'len=' + ta.value.length);
    chk('正文没被撑爆（短于 400 字符）', ta.value.length < 400, 'len=' + ta.value.length);
    chk('图库已入库', !!(WG.imgStore && WG.imgStore['h1-1']));
    chk('排版预览里是真图', pv.innerHTML.indexOf('src="data:image/png;base64,') >= 0,
      pv.innerHTML.slice(0, 120));
    chk('预览里不出现代号文本', pv.innerHTML.indexOf('wgimg:h1-1') < 0);
    chk('预览保留了标题层级', /<h2/.test(pv.innerHTML));
    chk('预览保留了高亮语法', /background-color:#/.test(pv.innerHTML) || /==/.test(pv.innerHTML) === false);
    chk('预览保留了列表', /<li/.test(pv.innerHTML));
    chk('统计里显示图片数', /1 张图/.test(stats.textContent || ''), stats.textContent);

    /* ---------- B. 缺图兜底 ---------- */
    ta.value = '![截图9](wgimg:gone-9)';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(700);
    chk('图丢了不显示代码', pv.innerHTML.indexOf('wgimg:gone-9') < 0, pv.innerHTML.slice(0, 140));
    chk('图丢了显示可操作提示', pv.innerHTML.indexOf('原图没带过来') >= 0, pv.innerHTML.slice(0, 160));

    /* ---------- C. 普通外链图仍照常渲染 ---------- */
    ta.value = '![风景](https://example.com/a.jpg)';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(700);
    chk('外链图片不受影响', pv.innerHTML.indexOf('https://example.com/a.jpg') >= 0);
  } catch (e) {
    chk('脚本异常', false, (e && e.message) || String(e));
  }
  return out;
})()`;

const PAGE_BRIDGE = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  try {
    if (!window.WGStudio || typeof WGStudio.htmlToMd !== 'function') {
      chk('桥接脚本没加载', false);
      return out;
    }
    var root = document.getElementById('articleContent');
    root.innerHTML =
      '<div class="cover-image"><img src="' + B64 + '"></div>' +
      '<div class="note-paragraph has-bg" style="background:#fff3c9;color:#333;padding:12px 16px;border-radius:14px;">这是带底色的一段' +
        '<b>重点</b></div>' +
      '<div class="note-actions-between"><button class="note-btn delnote-btn">删除笔记</button>' +
        '<button class="note-btn edit-btn">编辑文字</button></div>' +
      '<img src="' + B64 + '" id="noteImg_1">' +
      '<h2 style="text-align:center">截图里的三个动作</h2>' +
      '<ul><li>第一个动作</li><li>第二个动作</li></ul>' +
      '<p>普通段落，带 <strong>加粗</strong> 和 <mark>高亮</mark>。</p>' +
      '<div class="subtitle-item">字幕条目不该进来</div>';

    var r = WGStudio.htmlToMd(root);
    var md = r.md || '';
    var imgs = r.imgs || {};

    chk('转换出正文', md.length > 10, md.length);
    chk('按钮文字不进正文', md.indexOf('删除笔记') < 0 && md.indexOf('编辑文字') < 0, md.slice(0, 60));
    chk('字幕列表不进正文', md.indexOf('字幕条目不该进来') < 0);
    chk('正文里没有 base64', md.indexOf('data:image') < 0, 'len=' + md.length);
    chk('正文长度正常（没被图片撑爆）', md.length < 600, 'len=' + md.length);
    chk('截图转成短代号', /\\]\\(wgimg:[\\w-]+\\)/.test(md), md);
    chk('真图被单独带出来', Object.keys(imgs).length === 2, 'n=' + Object.keys(imgs).length);
    chk('带出的是完整 dataURL', Object.keys(imgs).every(function (k) { return /^data:image\\//.test(imgs[k]); }));
    chk('标题保留 H2', /^## 截图里的三个动作/m.test(md), md);
    chk('列表保留', /^- 第一个动作/m.test(md) && /^- 第二个动作/m.test(md));
    chk('加粗保留', md.indexOf('**重点**') >= 0, md);
    chk('带底色的段落转成引用块', /^> 这是带底色的一段/m.test(md), md);
  } catch (e) {
    chk('脚本异常', false, (e && e.message) || String(e));
  }
  return out;
})()`;

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1500,1000',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wghandoff-' + Date.now(),
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STORAGE_MOCK });

  let pass = 0;
  let fail = 0;
  const report = (val, tag) => {
    if (!val) { console.log('FAIL: ' + tag + ' 脚本没返回值'); fail++; return; }
    val.forEach((x) => {
      if (x.ok) { pass++; console.log('PASS  ' + x.n + (x.ex ? '  [' + x.ex + ']' : '')); }
      else { fail++; console.log('FAIL  ' + x.n + (x.ex ? '  ::  ' + x.ex : '')); }
    });
  };

  console.log('--- A/B/C 编辑台落位 ---');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#writer' });
  await sleep(2800);
  const r1 = await send('Runtime.evaluate', {
    expression: PAGE_WRITER, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });
  report(r1.result && r1.result.result && r1.result.result.value, '编辑台');

  console.log('');
  console.log('--- 桥接转换 ---');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/tests/mock-bridge.html?t=' + Date.now() });
  await sleep(900);
  const r2 = await send('Runtime.evaluate', {
    expression: PAGE_BRIDGE, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });
  report(r2.result && r2.result.result && r2.result.result.value, '桥接');

  console.log('');
  console.log('RESULT: ' + pass + ' pass / ' + fail + ' fail');
  console.log('');

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})();
