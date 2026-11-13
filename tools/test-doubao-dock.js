/* ============================================================
 * 内置豆包侧窗推送测试（CDP 驱动）
 * ------------------------------------------------------------
 * 覆盖：
 *   ① 豆包 iframe 延迟加载（工作台启动不拖着第三方页面）
 *   ② push() 打开右侧抽屉 + 加载 iframe
 *   ③ postMessage 握手 PING/PONG → FILL 推送提示词 → 自动发送
 *   ④ token 不对的伪造回包被忽略
 *   ⑤ 二次推送复用同一个 iframe，不重复加载
 *   ⑥ 豆包页没就绪 → 超时返回 ok:false + 可读文案（不新开网页版标签页）
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8908;
const PORT_CDP = 9354;
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
  window.__tabCreate = 0;
  window.__injectCalls = 0;
  window.chrome.runtime = {
    id: 'test',
    getURL: function(p){ return '/' + p; },
    /* 注入兜底走这条：测试里直接回「没有注入通道」，让 push 快速失败而不是干等 */
    sendMessage: function(msg, cb){
      if (msg && msg.type === 'WG_DOUBAO_FILL_FRAME') window.__injectCalls++;
      if (typeof cb === 'function') setTimeout(function(){ cb({ ok: false, msg: 'test: 没有注入通道' }); }, 0);
    },
    onMessage: { addListener: function(){} },
    lastError: null
  };
  window.chrome.tabs = {
    query: function(o, cb){ if (cb) cb([]); return Promise.resolve([]); },
    sendMessage: function(){},
    create: function(){ window.__tabCreate++; }
  };
  window.chrome.downloads = { download: function(){} };
})();
`;

const PAGE_SCRIPT = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var frame = document.getElementById('doubao-frame');
  var drawer = document.getElementById('doubao-drawer');

  try {
    await wait(300);

    /* ---------- ① 延迟加载 ---------- */
    chk('豆包 iframe 初始不加载（不拖慢工作台）', !frame.getAttribute('src'),
      frame.getAttribute('src') || '(空)');
    chk('侧窗推送接口已就绪', !!(WG.doubaoDock && typeof WG.doubaoDock.push === 'function'));
    chk('抽屉初始是收起的', drawer.hidden === true);

    /* ---------- ②③ 推送：握手 + 填充 ---------- */
    frame.dataset.src = '/tests/mock-doubao.html';
    var prompt = '帮我给这篇公众号文章起标题。\\n\\n正文：三个让短视频不油腻的动作。';
    var r = await WG.doubaoDock.push(prompt, { send: true });

    chk('push 返回成功', !!r && r.ok === true, JSON.stringify(r));
    chk('标记为走了内置侧窗', !!r && r.dock === true);
    chk('已自动点发送', !!r && r.sent === true);
    chk('推送时把抽屉打开了', drawer.hidden === false);
    chk('推送时加载了 iframe', /mock-doubao\\.html/.test(frame.getAttribute('src') || ''),
      frame.getAttribute('src') || '(空)');

    var win = frame.contentWindow;
    chk('iframe 里收到了 PING 握手', win.__log && win.__log.ping > 0,
      win.__log ? win.__log.ping : 'no log');
    chk('iframe 里收到了 FILL 提示词', win.__log && win.__log.fills.length === 1,
      win.__log ? win.__log.fills.length : 'no log');
    var got = (win.__log && win.__log.fills[0]) || {};
    chk('提示词原样送达', got.prompt === prompt, String(got.prompt || '').slice(0, 40));
    chk('要求自动发送', got.send === true);
    chk('豆包输入框里已经是这段提示词', win.document.getElementById('chat').value === prompt,
      win.document.getElementById('chat').value.slice(0, 30));

    /* ---------- ④ 伪造 token 的回包被忽略 ---------- */
    window.postMessage({ __wgDoubao: 'RES', token: 'hacker', reqId: 999, ok: true, ready: true }, '*');
    var ping = await WG.doubaoDock.ping();
    chk('伪造 token 的回包不干扰正常通信', !!ping && ping.ok === true, JSON.stringify(ping));

    /* ---------- ⑤ 二次推送复用 iframe ---------- */
    var srcBefore = frame.getAttribute('src');
    var r2 = await WG.doubaoDock.push('再来一次：写摘要', { send: false });
    chk('二次推送也成功', !!r2 && r2.ok === true, JSON.stringify(r2));
    chk('二次推送复用同一个 iframe', frame.getAttribute('src') === srcBefore);
    chk('send:false 时只填不发', (win.__log.fills[1] || {}).send === false,
      JSON.stringify(win.__log.fills[1] || {}));

    /* ---------- ⑥ 鼠标离开必须收起（用户反复提的那条） ---------- */
    var pt = function (x, y) {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    };
    var rc = drawer.getBoundingClientRect();
    pt(rc.left + 30, rc.top + 40);
    await wait(50);
    chk('指针移到侧栏里不会被收起', drawer.hidden === false);

    pt(6, 6);
    await wait(180);
    chk('指针离开侧栏 → 立刻自动收起', drawer.hidden === true, 'hidden=' + drawer.hidden);

    /* 指针从没进过侧栏时（刚推送完），不该立刻收掉，否则看不到豆包在写 */
    var r3 = await WG.doubaoDock.push('第三条：写摘要', { send: false });
    chk('再次推送仍成功', !!r3 && r3.ok === true, JSON.stringify(r3));
    pt(6, 6);
    await wait(180);
    chk('鼠标还没进过侧栏时不会被误收', drawer.hidden === false);

    /* ---------- 全程没开新标签页 ---------- */
    chk('全程没有新开豆包网页标签页', window.__tabCreate === 0, 'create=' + window.__tabCreate);
  } catch (e) {
    chk('脚本异常', false, (e && e.message) || String(e));
  }
  return out;
})()`;

const STAGE_SILENT = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var frame = document.getElementById('doubao-frame');

  try {
    await wait(300);
    frame.dataset.src = '/tests/mock-doubao-silent.html';
    var t0 = Date.now();
    var r = await WG.doubaoDock.push('豆包没就绪时应该优雅失败', { send: true });
    var cost = Date.now() - t0;

    chk('豆包页不应答时 push 返回失败', !!r && r.ok === false, JSON.stringify(r));
    chk('失败时给出可读原因', /没就绪|没回音|超时/.test((r && r.msg) || ''), (r && r.msg) || '');
    chk('失败也不新开网页版标签页', window.__tabCreate === 0, 'create=' + window.__tabCreate);
    chk('先走 postMessage，失败后才注入兜底', window.__injectCalls >= 1, 'inject=' + window.__injectCalls);
    chk('超时有上限（<26 秒），按钮不卡死', cost < 26000, cost + 'ms');
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
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgdock-' + Date.now(),
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

  /* ---------- 静态检查：侧窗外壳脚本必须外链（MV3 CSP 禁内联） ---------- */
  {
    const shellPath = path.join(ROOT, 'workbench', 'doubao-side.html');
    const jsPath = path.join(ROOT, 'workbench', 'doubao-side.js');
    const shell = fs.existsSync(shellPath) ? fs.readFileSync(shellPath, 'utf8') : '';
    const add = (ok, n, ex) => {
      if (ok) { pass++; console.log('PASS  ' + n); }
      else { fail++; console.log('FAIL  ' + n + (ex ? '  ::  ' + ex : '')); }
    };
    add(fs.existsSync(jsPath), '侧窗脚本 doubao-side.js 存在');
    add(/<script\s+src="doubao-side\.js"><\/script>/.test(shell), '侧窗 HTML 外链脚本',
      shell.match(/<script[^>]*>/g) ? shell.match(/<script[^>]*>/g).join(' | ') : 'none');
    /* 内联 script（无 src）= MV3 扩展页面 CSP 直接禁掉 → 提示永远不消失 */
    const inline = shell.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
    add(inline.length === 0, '侧窗 HTML 无内联脚本（MV3 CSP）',
      inline.length ? inline[0].slice(0, 60) : 'ok');
    add(!/正在打开豆包[\s\S]*多半天是没登录|多半是没登录/.test(shell), '加载提示不再误导「没登录」');
  }

  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#writer' });
  await sleep(2600);
  const r = await send('Runtime.evaluate', {
    expression: PAGE_SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });
  report(r.result && r.result.result && r.result.result.value, '阶段一');

  console.log('');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html?t=' + Date.now() + '#writer' });
  await sleep(2600);
  const r2 = await send('Runtime.evaluate', {
    expression: STAGE_SILENT, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });
  report(r2.result && r2.result.result && r2.result.result.value, '阶段二');

  console.log('');
  console.log('RESULT: ' + pass + ' pass / ' + fail + ' fail');
  console.log('');

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})();
