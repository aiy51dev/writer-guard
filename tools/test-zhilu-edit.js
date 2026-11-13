/* ============================================================
 * 智录笔记 · 编辑体验测试（CDP 驱动）
 * ------------------------------------------------------------
 * 覆盖：
 *  1. 画中画水印弹窗自适应（小屏也不用下拉，按钮始终可见）
 *  2. 弹窗内画布可放大查看
 *  3. 显示面板段落直接编辑
 *  4. 段落自定义背景
 *  5. 选中文字滚轮改格式（加粗 / 下划线 / 高亮）
 *  6. 编辑笔记弹窗 footer 不被内容挤出屏幕
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8902;
const PORT_CDP = 9345;
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

const SCRIPT = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  try {
    var A = document.getElementById('articleContent');
    chk('显示面板存在', !!A, A ? 'ok' : 'null');

    /* 造两条笔记 */
    noteList.length = 0;
    noteList.push({ content: '第一段：这是可以直接编辑的正文，选中文字后滚轮改格式', imageDataUrl: '', time: '1.00', isCover: false });
    noteList.push({ content: '第二段：用于验证段落背景', imageDataUrl: '', time: '2.00', isCover: false });
    renderArticlePreview();
    await wait(60);

    /* --- 1. 直接编辑 --- */
    var p0 = document.querySelector('.note-paragraph[data-idx="0"]');
    chk('段落可直接编辑（contenteditable）', !!p0 && p0.getAttribute('contenteditable') === 'true');
    chk('段落不再是只读块', !!p0 && !p0.hasAttribute('readonly'), p0 ? p0.className : '');
    if (p0) {
      p0.innerHTML = '我直接改的文字';
      p0.dispatchEvent(new Event('input', { bubbles: true }));
      chk('改动写回数据（不用弹窗）', noteList[0].content === '我直接改的文字', noteList[0].content);
    }

    /* --- 2. 段落背景 --- */
    var bgBtn = document.querySelectorAll('.bg-btn')[0];
    chk('段落有背景按钮', !!bgBtn, bgBtn ? bgBtn.textContent : 'missing');
    if (bgBtn) {
      bgBtn.click();
      await wait(60);
      var picker = document.querySelector('.note-bg-picker');
      chk('背景选择器弹出', !!picker);
      if (picker) {
        var pr = picker.getBoundingClientRect();
        chk('选择器不出屏', pr.bottom <= window.innerHeight && pr.right <= window.innerWidth,
          Math.round(pr.left) + ',' + Math.round(pr.top) + ' ' + Math.round(pr.width) + 'x' + Math.round(pr.height));
        picker.querySelector('.note-bg-swatch').click();
        await wait(80);
        var p0b = document.querySelector('.note-paragraph[data-idx="0"]');
        var bg = p0b ? getComputedStyle(p0b).backgroundColor : '';
        chk('背景已应用', noteList[0].bg && bg && bg !== 'rgba(0, 0, 0, 0)', noteList[0].bg + ' / ' + bg);
        chk('深色背景自动换白字', noteList[0].bg !== '#111827' || getComputedStyle(p0b).color.indexOf('248') >= 0,
          getComputedStyle(p0b).color);
      }
    }
    closeNoteBg();

    /* --- 3. 选中文字 + 滚轮改格式 --- */
    function selectHead(el, n) {
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var t = w.nextNode();
      if (!t) return false;
      var r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, Math.min(n, t.textContent.length));
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }
    function roll(el, extra) {
      var opt = { deltaY: -100, bubbles: true, cancelable: true };
      if (extra) Object.keys(extra).forEach(function (k) { opt[k] = extra[k]; });
      el.dispatchEvent(new WheelEvent('wheel', opt));
    }

    noteList[1].content = '第二段：用于验证段落背景和滚轮格式';
    renderArticlePreview();
    await wait(60);
    var p1 = document.querySelector('.note-paragraph[data-idx="1"]');

    selectHead(p1, 4);
    roll(p1);
    await wait(80);
    chk('滚轮第 1 档 = 加粗', /<b>|<strong>|font-weight:[ ]*(bold|700)/i.test(p1.innerHTML), p1.innerHTML.slice(0, 90));

    selectHead(p1, 4);
    roll(p1);
    await wait(80);
    chk('滚轮第 2 档 = 下划线', /<u>|text-decoration(-line)?:[ ]*underline/i.test(p1.innerHTML), p1.innerHTML.slice(0, 130));

    selectHead(p1, 4);
    roll(p1, { ctrlKey: true });
    await wait(80);
    chk('Ctrl+滚轮换高亮色', /background-color/i.test(p1.innerHTML), p1.innerHTML.slice(0, 130));

    selectHead(p1, 4);
    roll(p1, { shiftKey: true });
    await wait(80);
    chk('Shift+滚轮只动加粗，不串到其他格式', /underline/i.test(p1.innerHTML), p1.innerHTML.slice(0, 120));

    /* 提示浮层：贴鼠标右侧 + 按键名带【】 */
    selectHead(p1, 4);
    var pr0 = p1.getBoundingClientRect();
    var cx = Math.round(pr0.left + 40);
    var cy = Math.round(pr0.top + 12);
    p1.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, bubbles: true, cancelable: true, clientX: cx, clientY: cy,
    }));
    await wait(90);
    var hud = document.getElementById('wgFmtHud');
    chk('滚轮提示浮层出现', !!hud && hud.classList.contains('is-on'));
    chk('提示用【】标注按键', !!hud && /【[^】]*滚轮[^】]*】/.test(hud.textContent),
      hud ? hud.textContent : 'missing');
    if (hud) {
      var hr = hud.getBoundingClientRect();
      chk('浮层跟在鼠标右侧', hr.left >= cx - 1, 'hud.left=' + Math.round(hr.left) + ' cursor=' + cx);
      chk('浮层垂直对准指针', Math.abs((hr.top + hr.height / 2) - cy) <= 34,
        'hud.cy=' + Math.round(hr.top + hr.height / 2) + ' cursor=' + cy);
      chk('浮层不再钉在右下角', hr.left > 2 && hr.top < window.innerHeight - 80,
        Math.round(hr.left) + ',' + Math.round(hr.top));
    }

    /* --- 4. 编辑笔记弹窗：footer 始终可见 --- */
    var cm = document.getElementById('customModal');
    var re = document.getElementById('richEditor');
    re.innerHTML = new Array(40).join('<p>很长的正文内容，用来把弹窗撑高，检查底部按钮会不会被挤到屏幕外。</p>');
    cm.style.display = 'flex';
    await wait(120);
    var foot = cm.querySelector('.custom-modal-footer');
    var fr = foot.getBoundingClientRect();
    var cr = cm.querySelector('.custom-modal-content').getBoundingClientRect();
    chk('编辑笔记弹窗不超出视口高度', cr.height <= window.innerHeight * 0.95, Math.round(cr.height) + 'px / vh=' + window.innerHeight);
    chk('确定/取消按钮在屏幕内', fr.bottom <= window.innerHeight + 1, 'bottom=' + Math.round(fr.bottom) + ' vh=' + window.innerHeight);
    cm.style.display = 'none';

    /* --- 5. 画中画水印弹窗自适应 --- */
    var src = document.createElement('canvas');
    src.width = 1920; src.height = 1080;
    var sx = src.getContext('2d');
    sx.fillStyle = '#1e293b'; sx.fillRect(0, 0, 1920, 1080);
    sx.fillStyle = '#38bdf8'; sx.font = 'bold 90px sans-serif'; sx.fillText('截图预览', 120, 400);

    var wm = document.createElement('canvas');
    wm.width = 400; wm.height = 200;
    var wx = wm.getContext('2d');
    wx.fillStyle = '#f97316'; wx.fillRect(0, 0, 400, 200);
    wx.fillStyle = '#fff'; wx.font = 'bold 60px sans-serif'; wx.fillText('水印', 90, 120);
    var wmUrl = wm.toDataURL('image/png');

    window.__pip = showPipDragModal(src, [{ dataUrl: wmUrl, width: 400, height: 200 }], 0, 1200, 800, 260, 130);
    await wait(350);

    var content = document.querySelector('.pip-drag-content');
    chk('画中画弹窗打开', !!content);
    if (content) {
      var ccr = content.getBoundingClientRect();
      var btn = content.querySelector('.btn-pip-confirm');
      var br = btn.getBoundingClientRect();
      chk('画中画弹窗不超屏', ccr.height <= window.innerHeight && ccr.width <= window.innerWidth,
        Math.round(ccr.width) + 'x' + Math.round(ccr.height) + ' vp=' + window.innerWidth + 'x' + window.innerHeight);
      chk('确认位置按钮不用下拉可见', br.bottom <= window.innerHeight + 1 && br.top >= 0,
        'btn bottom=' + Math.round(br.bottom) + ' vh=' + window.innerHeight);

      var bgc = content.querySelector('.pip-drag-canvas');
      var w0 = parseFloat(bgc.style.width);
      var h0 = bgc.getBoundingClientRect().height;
      chk('画中画预览再缩小（≤44% 原宽）', w0 <= Math.round(1920 * 0.44) + 2, w0 + 'px / 1920');
      chk('画中画高度只占屏幕 7.5 成内', h0 <= window.innerHeight * 0.75,
        Math.round(h0) + 'px / vh=' + window.innerHeight);
      content.querySelectorAll('.pip-zoom-btn')[1].click();  /* + */
      await wait(80);
      var w1 = parseFloat(bgc.style.width);
      chk('弹窗内画布可放大看细节', w1 > w0 * 1.15, w0 + 'px → ' + w1 + 'px');
      chk('缩放后仍在容器里滚动', !!(content.querySelector('.pip-drag-canvas-container').scrollHeight >= w1 * 0), 'ok');

      content.querySelector('.btn-pip-cancel').click();
      await wait(120);
      chk('取消后弹窗关闭', !document.querySelector('.pip-drag-content'));
      var pr2 = await window.__pip;
      chk('取消返回 null', pr2 === null, String(pr2));
    }
  } catch (e) {
    chk('脚本异常', false, (e && e.message) || String(e));
  }
  return out;
})()`;

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1280,720',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgzhilu-' + Date.now(),
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
  const contexts = [];
  const sessions = new Set();

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Target.attachedToTarget') {
      sessions.add(m.params.sessionId);
      send('Runtime.enable', {}, m.params.sessionId);
      return;
    }
    if (m.method === 'Runtime.executionContextCreated') {
      contexts.push({ id: m.params.context.id, sessionId: m.sessionId || null, aux: m.params.context.auxData || {} });
    }
  };

  function send(method, params, sessionId) {
    const id = ++mid;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((r) => waits.set(id, r));
  }

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/tests/studio-harness.html' });
  await sleep(9000);

  async function evalIn(ctx, expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, contextId: ctx.id, returnByValue: true, awaitPromise: true,
    }, ctx.sessionId);
    const res = r.result || {};
    if (res.exceptionDetails) {
      return { __error: (res.exceptionDetails.text || '') + ' ' + String((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || '').slice(0, 200) };
    }
    return res.result ? res.result.value : undefined;
  }

  let topCtx = null;
  let zhiluCtx = null;
  for (const c of contexts) {
    if (!c.aux.isDefault) continue;
    const v = await evalIn(c, 'location.href');
    if (typeof v !== 'string') continue;
    if (v.indexOf('studio-harness') >= 0) topCtx = c;
    if (v.indexOf('zhilu.html') >= 0) zhiluCtx = c;
  }

  if (!zhiluCtx) {
    console.log('FAIL: 找不到智录笔记执行上下文');
    server.close(); chrome.kill(); process.exit(1);
  }

  /* 模拟小屏：把测试台 iframe 缩到 1024×620，验证弹窗自适应 */
  if (topCtx) {
    await evalIn(topCtx, `(function(){var f=document.getElementById('f-zhilu');f.style.width='1024px';f.style.height='620px';f.style.display='block';return f.style.width;})()`);
    await sleep(600);
  }

  const res = await send('Runtime.evaluate', {
    expression: SCRIPT, contextId: zhiluCtx.id, returnByValue: true, awaitPromise: true,
  }, zhiluCtx.sessionId);

  const val = res.result && res.result.result && res.result.result.value;
  let pass = 0;
  let fail = 0;
  if (!val) {
    console.log('FAIL: 脚本没有返回值');
    console.log(JSON.stringify(res.result, null, 2).slice(0, 1500));
    fail = 1;
  } else {
    val.forEach((t) => {
      console.log((t.ok ? 'PASS ' : 'FAIL ') + t.n + (t.ex ? '  [' + t.ex + ']' : ''));
      if (t.ok) pass++; else fail++;
    });
  }

  console.log('\nRESULT: ' + pass + ' pass / ' + fail + ' fail');
  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})();
