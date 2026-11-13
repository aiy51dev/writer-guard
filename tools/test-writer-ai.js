/* ============================================================
 * 编辑台 · AI 助手测试（CDP 驱动）
 * ------------------------------------------------------------
 * 覆盖：
 *   ① 五个 AI 按钮挪到正文尾部（Markdown 正文后缀位置）一行显示
 *   ② 候选标题默认收在「起标题」后面的小三角里，点三角可开合
 *   ③ 选中候选标题→回填标题栏，并自动收起
 *   ④ 没配 API 时点按钮 = 把提示词推给豆包（WG_DOUBAO_ASK）
 *   ⑤ 推送失败时退到「复制提示词」，不会静默失败
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8907;
const PORT_CDP = 9353;
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
  /* 用 sessionStorage 当底座：跨 Page.reload 也能保住数据，才能测持久化 */
  var mem = {};
  try { mem = JSON.parse(window.sessionStorage.getItem('__wgmock') || '{}') || {}; } catch (e) { mem = {}; }
  var listeners = [];
  function save() { try { window.sessionStorage.setItem('__wgmock', JSON.stringify(mem)); } catch (e) { /* ignore */ } }
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
    set: function(obj, cb) { Object.assign(mem, obj); save(); listeners.forEach(function(f){ try { f(obj, 'local'); } catch(e){} }); return toCb({}, cb); },
    remove: function(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(function(k){ delete mem[k]; }); save(); return toCb({}, cb); },
    clear: function(cb) { Object.keys(mem).forEach(function(k){ delete mem[k]; }); save(); return toCb({}, cb); }
  };
  window.chrome = window.chrome || {};
  window.chrome.storage = { local: local, sync: local, onChanged: { addListener: function(f){ listeners.push(f); }, removeListener: function(){} } };
  window.chrome.runtime = {
    id: 'test',
    getURL: function(p){ return '/' + p; },
    sendMessage: function(){},
    onMessage: { addListener: function(){} },
    lastError: null
  };
  window.chrome.tabs = { query: function(o, cb){ if (cb) cb([]); return Promise.resolve([]); }, sendMessage: function(){}, create: function(){} };
  window.chrome.downloads = { download: function(){} };
})();
`;

const PAGE_SCRIPT = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  try {
    await wait(400);

    /* ---------- ① 按钮位置 ---------- */
    var foot = document.querySelector('.wgw-foot');
    var bar = document.getElementById('wgw-aibar');
    chk('AI 按钮组在正文尾部（Markdown 正文后缀）', !!foot && !!bar && foot.contains(bar));

    var labels = [].slice.call(document.querySelectorAll('#wgw-aibar [data-ai]'))
      .map(function (b) { return b.textContent.trim(); });
    chk('五个 AI 按钮齐全', labels.join('/') === '起标题/写正文/改写选中/降 AI 味/生成摘要', labels.join('/'));

    var tops = {};
    [].slice.call(document.querySelectorAll('#wgw-aibar [data-ai]')).forEach(function (b) {
      var r = b.getBoundingClientRect();
      tops[Math.round(r.top)] = 1;
    });
    chk('按钮排在同一行', Object.keys(tops).length <= 2, Object.keys(tops).join(','));

    var head = document.querySelector('.wgw-foot');
    var hr = head ? head.getBoundingClientRect() : { top: 0 };
    var ed = document.getElementById('wgw-md');
    var er = ed.getBoundingClientRect();
    chk('AI 栏在编辑区下方', hr.top >= er.bottom - 4, 'foot=' + Math.round(hr.top) + ' editor=' + Math.round(er.bottom));

    /* ---------- ①-b 排版预览表头：复制按钮在「写入编辑器」前面 ---------- */
    var copyTop = document.getElementById('wgw-copy-top');
    var writeBtn = document.getElementById('wgw-write');
    chk('排版预览表头有「复制」按钮', !!copyTop && copyTop.textContent.trim() === '复制',
      copyTop ? copyTop.textContent.trim() : 'none');
    chk('「复制」紧挨在「写入编辑器」前面', !!copyTop && copyTop.nextElementSibling === writeBtn,
      copyTop && copyTop.nextElementSibling ? copyTop.nextElementSibling.id : 'none');
    chk('「写入编辑器」仍在手机预览按钮前面', !!writeBtn && writeBtn.nextElementSibling &&
      writeBtn.nextElementSibling.id === 'wgw-dev-phone',
      writeBtn && writeBtn.nextElementSibling ? writeBtn.nextElementSibling.id : 'none');

    /* 点「复制」应该把带样式的 HTML 写进剪贴板（公众号正文粘得上） */
    var wrote = null;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { write: function (items) { wrote = items; return Promise.resolve(); } }
      });
    } catch (e) { /* 改不动就算了，下面会失败 */ }

    ed.value = '## 复制测试小标题\\n\\n正文段落，==绿底关键词== 和 **加粗**。';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(320);
    if (copyTop) copyTop.click();
    await wait(300);

    chk('点「复制」写了一次剪贴板', !!wrote && wrote.length === 1);
    var htmlBlob = null;
    try { htmlBlob = wrote && wrote[0] ? await wrote[0].getType('text/html') : null; } catch (e) { htmlBlob = null; }
    var htmlTxt = htmlBlob ? await htmlBlob.text() : '';
    chk('复制内容带 text/html（粘进公众号带排版）', !!htmlTxt && htmlTxt.length > 20, String(htmlTxt.length));
    chk('复制内容里有正文文字', htmlTxt.indexOf('复制测试小标题') >= 0, htmlTxt.slice(0, 60));
    chk('复制内容保留了绿底高亮', /background|绿底关键词/.test(htmlTxt));
    chk('复制后按钮给回音', /已复制/.test(copyTop ? copyTop.textContent : ''),
      copyTop ? copyTop.textContent : 'none');

    /* ---------- ② 结果区默认收起 ---------- */
    var o = document.getElementById('wgw-ai-out');
    var tg = document.getElementById('wgw-ai-toggle');
    chk('结果区默认收起', !!o && !o.classList.contains('is-open'));
    chk('小三角默认隐藏（没结果不占位）', !!tg && tg.hidden === true);
    chk('小三角紧跟在「起标题」后面', !!tg && tg.previousElementSibling &&
      tg.previousElementSibling.getAttribute('data-ai') === 'titles',
      tg && tg.previousElementSibling ? tg.previousElementSibling.textContent.trim() : 'none');

    /* ---------- ③ 没配 API：点「起标题」→ 推给内置豆包侧窗 ---------- */
    window.__sent = [];
    window.__bg = [];
    chrome.runtime.sendMessage = function (msg, cb) {
      window.__bg.push(msg);
      if (typeof cb === 'function') setTimeout(function () { cb({ ok: true, sent: true }); }, 10);
    };
    window.__dockOpen = false;
    WG.doubaoDock = {
      open: function () { window.__dockOpen = true; },
      push: function (prompt, opts) {
        window.__sent.push({ type: 'DOCK_PUSH', prompt: prompt, send: opts && opts.send });
        window.__dockOpen = true;
        return Promise.resolve({ ok: true, dock: true, sent: true, mode: 'paste' });
      }
    };

    ed.value = '这是正文：讲三个让短视频不油腻的动作，重点是开头三秒和镜头切换。';
    ed.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector('[data-ai="titles"]').click();
    await wait(400);

    chk('没配 API 时推进内置豆包侧窗', window.__sent.length === 1 && window.__sent[0].type === 'DOCK_PUSH',
      JSON.stringify(window.__sent.map(function (m) { return m.type; })));
    chk('不再走后台开豆包网页标签页', window.__bg.length === 0,
      JSON.stringify(window.__bg.map(function (m) { return m.type; })));
    chk('推送时把右侧豆包抽屉打开', window.__dockOpen === true);
    var prompt = (window.__sent[0] || {}).prompt || '';
    chk('提示词要求直接发送，不用二次点', (window.__sent[0] || {}).send === true);
    chk('提示词里写明要起标题', /起标题/.test(prompt), prompt.slice(0, 40));
    chk('提示词带上正文内容', prompt.indexOf('让短视频不油腻') >= 0, prompt.length + ' 字');
    chk('提示词要求信息型标题、不要标题党', /信息型|标题党/.test(prompt));

    chk('推送后结果区自动展开', o.classList.contains('is-open'));
    chk('推送后小三角出现且朝下', tg.hidden === false && tg.textContent === '▾', tg.textContent);

    /* ---------- ④ 小三角开合 ---------- */
    tg.click();
    await wait(80);
    chk('点三角收起', !o.classList.contains('is-open') && tg.textContent === '▸', tg.textContent);
    var hClosed = ed.getBoundingClientRect().height;

    tg.click();
    await wait(80);
    chk('再点三角展开', o.classList.contains('is-open') && tg.textContent === '▾');
    var hOpen = ed.getBoundingClientRect().height;
    chk('展开/收起都不改变正文高度', Math.abs(hOpen - hClosed) < 2,
      Math.round(hOpen) + ' vs ' + Math.round(hClosed));

    /* ---------- ⑤ 点候选标题：回填 + 自动收起 ---------- */
    o.innerHTML = '<div class="wgw-ai-titles">' +
      '<button class="wgw-ai-title" data-title="三个动作让短视频不油腻">三个动作让短视频不油腻</button>' +
      '<button class="wgw-ai-title" data-title="短视频开头三秒怎么留住人">短视频开头三秒怎么留住人</button>' +
      '</div>';
    o.classList.add('is-open');
    o.querySelector('.wgw-ai-title').click();
    await wait(120);

    var titleEl = document.getElementById('wgw-title');
    chk('点候选标题回填标题栏', titleEl && titleEl.value === '三个动作让短视频不油腻', titleEl ? titleEl.value : 'no input');
    chk('选完自动收起，不挡正文', !o.classList.contains('is-open') && tg.textContent === '▸');

    /* ---------- ⑥ 内置豆包没就绪 → 只借用已开标签页，仍不开网页版 ---------- */
    window.__sent = [];
    window.__bg = [];
    var copied = '';
    WG.copy = function (t) { copied = String(t || ''); return true; };
    WG.doubaoDock = {
      open: function () {},
      push: function (prompt, opts) {
        window.__sent.push({ type: 'DOCK_PUSH', prompt: prompt, send: opts && opts.send });
        return Promise.resolve({ ok: false, dock: true, msg: '右侧内置豆包没就绪（可能没登录）' });
      }
    };
    chrome.runtime.sendMessage = function (msg, cb) {
      window.__bg.push(msg);
      if (typeof cb === 'function') setTimeout(function () { cb({ ok: false, noTab: true, msg: '没有已打开的豆包标签页' }); }, 10);
    };
    document.querySelector('[data-ai="deai"]').click();
    await wait(600);

    chk('侧窗失败也尝试过一次推送', window.__sent.length === 1 && window.__sent[0].type === 'DOCK_PUSH');
    chk('失败后不偷偷开网页版豆包', window.__bg.filter(function (m) { return m.type === 'WG_DOUBAO_ASK'; }).length === 0,
      JSON.stringify(window.__bg.map(function (m) { return m.type; })));
    chk('失败时把提示词复制走', copied.indexOf('降 AI 味') >= 0 && copied.length > 30, copied.slice(0, 40));
    chk('失败时给出可读提示', /没就绪|复制/.test(o.textContent), o.textContent.slice(0, 60));
    chk('结果区给了「小窗豆包」兜底入口', !!o.querySelector('[data-act="doubao-popup"]'));

    /* 用户自己点了才开小窗（popup 模式，不是全屏标签页） */
    o.querySelector('[data-act="doubao-popup"]').click();
    await wait(400);
    var popAsk = window.__bg.filter(function (m) { return m.type === 'WG_DOUBAO_ASK'; })[0];
    chk('点兜底按钮才推，且明确要「小窗」', !!popAsk && popAsk.popup === true,
      JSON.stringify(popAsk || {}).slice(0, 80));

    /* ---------- ⑦ 接了 API 就不再推豆包 ---------- */
    window.__sent = [];
    WG.AI = {
      isReady: function () { return true; },
      chat: function () {
        return Promise.resolve('三个动作让短视频镜头不油腻\\n开头三秒决定完播率高低\\n镜头切换的四个实操细节');
      },
    };
    document.querySelector('[data-ai="titles"]').click();
    await wait(400);
    chk('配了 API 走 API，不推豆包', window.__sent.length === 0, 'sent=' + window.__sent.length);
    chk('API 结果直接列成候选', o.querySelectorAll('.wgw-ai-title').length === 3,
      o.querySelectorAll('.wgw-ai-title').length);

    /* ---------- ⑧ 隐形字数：插完还能继续编辑 ---------- */
    var hh = WG.buildHiddenHtml ? WG.buildHiddenHtml('隐藏字数测试') : '';
    chk('隐形代码不再用 overflow:hidden 裁剪块', hh.indexOf('overflow:hidden') < 0 && hh.length > 0,
      hh.slice(0, 80));
    chk('隐形代码后面带可编辑空段落', /<p><br><\\/p>$/.test(hh.trim()), hh.trim().slice(-30));
    chk('隐形字仍在（font-size:0 计入字数）', hh.indexOf('隐藏字数测试') >= 0);

    /* ---------- ⑨ 高度默认自定义 + 写入按钮位置 ---------- */
    chk('高度档默认「自定义」', document.getElementById('wgw-height').textContent === '高度·自定义',
      document.getElementById('wgw-height').textContent);
    chk('自定义档已生效（h-custom）', document.querySelector('.wgw-split').classList.contains('h-custom'));
    chk('加载时不弹滑杆弹层', document.getElementById('wgw-hpop').hidden === true);

    var previewHead = document.querySelector('.wgw-pane .card-head');
    var writeBtn = document.getElementById('wgw-write');
    chk('「写入编辑器」在排版预览卡头', !!previewHead && previewHead.contains(writeBtn));
    chk('写入按钮排在「手机」切换前面', !!writeBtn &&
      writeBtn.nextElementSibling && writeBtn.nextElementSibling.id === 'wgw-dev-phone',
      writeBtn && writeBtn.nextElementSibling ? writeBtn.nextElementSibling.id : 'none');

    /* 拖滑杆：自动切自定义档并保存 780px，刷新后验证 */
    var hr2 = document.getElementById('wgw-hrange');
    hr2.value = '780';
    hr2.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    chk('拖滑杆后档位是自定义', document.getElementById('wgw-height').textContent === '高度·自定义');
    chk('拖滑杆后高度立即生效', document.querySelector('.wgw-split')
      .style.getPropertyValue('--wgw-pane-h') === '780px');
  } catch (e) {
    chk('脚本异常', false, (e && e.message) || String(e));
  }
  return out;
})()`;

/* 重载后验证高度档与 px 都还在 */
const CHECK_RELOAD = `(function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var split = document.querySelector('.wgw-split');
  chk('刷新后仍是自定义档', split.classList.contains('h-custom'), split.className);
  var px = split.style.getPropertyValue('--wgw-pane-h');
  chk('刷新后自定义高度还在（780px）', px === '780px', px || '(空)');
  chk('刷新后按钮文案同步', document.getElementById('wgw-height').textContent === '高度·自定义');
  var paneEl = document.querySelector('.wgw-split .wgw-pane') || split;
  chk('刷新后编辑区面板用的就是自定义高度', Math.abs(paneEl.getBoundingClientRect().height - 780) < 12,
    Math.round(paneEl.getBoundingClientRect().height) + 'px');
  return out;
})();`;

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1500,1000',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgwriter-' + Date.now(),
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
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#writer' });
  await sleep(2600);

  const r = await send('Runtime.evaluate', {
    expression: PAGE_SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });

  const val = r.result && r.result.result && r.result.result.value;
  let pass = 0;
  let fail = 0;

  if (!val) {
    console.log('FAIL: 脚本没返回值');
    console.log(JSON.stringify(r.result, null, 2).slice(0, 1200));
    fail = 1;
  } else {
    val.forEach((x) => {
      if (x.ok) { pass++; console.log('PASS  ' + x.n + (x.ex ? '  [' + x.ex + ']' : '')); }
      else { fail++; console.log('FAIL  ' + x.n + (x.ex ? '  ::  ' + x.ex : '')); }
    });
  }

  /* ---------- 阶段二：刷新后验证高度持久化 ---------- */
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#writer' });
  await sleep(2800);
  const r2 = await send('Runtime.evaluate', {
    expression: CHECK_RELOAD, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined,
  });
  const val2 = r2.result && r2.result.result && r2.result.result.value;
  if (!val2) {
    console.log('FAIL: 刷新验证脚本没返回值');
    fail++;
  } else {
    val2.forEach((x) => {
      if (x.ok) { pass++; console.log('PASS  ' + x.n + (x.ex ? '  [' + x.ex + ']' : '')); }
      else { fail++; console.log('FAIL  ' + x.n + (x.ex ? '  ::  ' + x.ex : '')); }
    });
  }

  console.log('');
  console.log('RESULT: ' + pass + ' pass / ' + fail + ' fail');
  console.log('');

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})();
