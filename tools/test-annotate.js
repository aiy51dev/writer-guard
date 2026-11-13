/* ============================================================
 * 截图标注模块测试（CDP 驱动，headless Chrome）
 * ------------------------------------------------------------
 * 覆盖：载入 → 滚轮缩放 → 原创指纹 PSNR → 分块无缝 → 叠加 2 次
 *       → 背景光 → PNG tEXt 写入 → JPG 导出
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8901;
const PORT_CDP = 9343;
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
  function toCb(obj, cb) {
    if (typeof cb === 'function') { setTimeout(function(){ cb(obj); }, 0); return; }
    return Promise.resolve(obj);
  }
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

const PAGE_SCRIPT = `(async function () {
  var out = [];
  var chk = function (n, ok, ex) { out.push({ n: n, ok: !!ok, ex: ex === undefined ? '' : String(ex) }); };
  try {
    if (!window.WG || !WG.annotate) { chk('模块已加载', false, 'WG.annotate 不存在'); return out; }
    var A = WG.annotate, S = A.state;
    chk('模块已加载', true, Object.keys(A).length + ' 个入口');

    /* --- 造一张 1200x800 的测试图（渐变 + 网格 + 文字） --- */
    var cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 800;
    var x = cv.getContext('2d');
    var g = x.createLinearGradient(0, 0, 1200, 800);
    g.addColorStop(0, '#1e3a8a'); g.addColorStop(0.5, '#0ea5e9'); g.addColorStop(1, '#f8fafc');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 800);
    x.fillStyle = 'rgba(255,255,255,.32)';
    for (var i = 0; i < 40; i++) x.fillRect(i * 31, (i * 53) % 800, 2, 800);
    x.fillStyle = 'rgba(15,23,42,.85)';
    x.font = 'bold 62px sans-serif';
    x.fillText('Writer Guard 标注测试', 60, 420);
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
    var file = new File([blob], 'test.png', { type: 'image/png' });

    await A.loadFile(file);
    chk('载入图片（工作分辨率）', S.src && S.src.width === 1200 && S.src.height === 800,
      S.src ? S.src.width + 'x' + S.src.height : 'null');
    chk('自动跑过一遍处理', !!S.base && S.stats.w === 1200, 'psnr=' + (S.stats.psnr || 0).toFixed(1));
    chk('指纹已生成（sha256）', String(S.srcSha || '').length === 64, String(S.srcSha || '').slice(0, 12));

    var psnrAuto = S.stats.psnr;
    chk('自动原创化肉眼无损（PSNR ≥ 40dB）', psnrAuto >= 40, psnrAuto.toFixed(2) + ' dB');
    chk('画面已变化（指纹不同）', psnrAuto < 99, psnrAuto.toFixed(2));

    /* --- 滚轮缩放 --- */
    var c = document.getElementById('an-canvas');
    var w0 = parseFloat(c.style.width);
    var r = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true
    }));
    var w1 = parseFloat(c.style.width);
    chk('滚轮向上放大画布', w1 > w0 * 1.1, w0.toFixed(0) + 'px → ' + w1.toFixed(0) + 'px');

    var hud = document.getElementById('an-hud');
    c.dispatchEvent(new MouseEvent('mousemove', {
      clientX: r.left + 30, clientY: r.top + 30, bubbles: true
    }));
    await new Promise(function (res) { setTimeout(res, 120); });
    chk('悬浮显示倍率/坐标/取色', /%/.test(hud.textContent) && /#/.test(hud.textContent), hud.textContent);

    c.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true
    }));
    chk('连续滚轮继续放大', parseFloat(c.style.width) > w1, parseFloat(c.style.width).toFixed(0) + 'px');

    A.setZoom(1);
    chk('缩放回到 100%', Math.abs(S.z - 1) < 0.001 && c.style.width === '1200px', c.style.width);

    /* --- 分块融合：无缝 --- */
    S.P.slice.on = true;
    S.P.slice.count = 6;
    S.P.slice.feather = 60;
    S.P.fp.strength = 'std';
    A.apply(true);
    var stitch = S.stats.stitch;
    chk('分 6 块后接缝不可见（≤1.4×）', stitch > 0 && stitch <= 1.4, '×' + stitch.toFixed(2));
    chk('分块后仍然无损', S.stats.psnr >= 40, S.stats.psnr.toFixed(2) + ' dB');

    /* --- 网格模式也平滑 --- */
    S.P.slice.mode = 'grid';
    A.apply(true);
    chk('网格分块同样无缝', S.stats.stitch <= 1.4, '×' + S.stats.stitch.toFixed(2));
    S.P.slice.mode = 'strip';

    /* --- 叠加 2 次 --- */
    document.getElementById('btn-sl-add').click();
    await new Promise(function (res) { setTimeout(res, 400); });
    chk('叠加到 2 次', S.rounds === 2, 'rounds=' + S.rounds);
    chk('叠加 2 次后画质仍在线（≥38dB）', S.stats.psnr >= 38, S.stats.psnr.toFixed(2) + ' dB');
    chk('叠加后按钮文案同步', /2/.test(document.getElementById('sl-rounds').textContent),
      document.getElementById('sl-rounds').textContent);

    /* --- 继续叠加到 5 次：画质不许衰减（幅度按 1/√n 收敛） --- */
    var sigOf = function (canvas) {
      var d = canvas.getContext('2d').getImageData(0, 0, 40, 40).data;
      var h = 0;
      for (var i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0;
      return h;
    };
    var sigs = [sigOf(c)];
    var psnrs = [S.stats.psnr];
    for (var kk = 0; kk < 3; kk++) {
      document.getElementById('btn-sl-add').click();
      await new Promise(function (res) { setTimeout(res, 380); });
      sigs.push(sigOf(c));
      psnrs.push(S.stats.psnr);
    }
    chk('叠加到 5 次', S.rounds === 5, 'rounds=' + S.rounds);
    chk('叠 5 次画质不衰减（PSNR ≥ 40dB）', S.stats.psnr >= 40,
      psnrs.map(function (v) { return v.toFixed(1); }).join(' → '));
    chk('叠加后画质与第 1 次基本持平（≤3dB）', Math.abs(S.stats.psnr - psnrs[0]) <= 3,
      psnrs[0].toFixed(1) + ' → ' + S.stats.psnr.toFixed(1));
    chk('每叠加一次画面确实换了一套指纹', sigs[0] !== sigs[4], sigs.join(','));

    /* --- 返回上一次 --- */
    var undoBtn = document.getElementById('btn-sl-undo');
    chk('有「返回上一次」按钮', !!undoBtn);
    if (undoBtn) {
      undoBtn.click();
      await new Promise(function (res) { setTimeout(res, 380); });
      chk('点返回退到 4 次', S.rounds === 4, 'rounds=' + S.rounds);
      chk('返回后次数文案同步', /4/.test(document.getElementById('sl-rounds').textContent),
        document.getElementById('sl-rounds').textContent);

      undoBtn.click(); await new Promise(function (res) { setTimeout(res, 380); });
      undoBtn.click(); await new Promise(function (res) { setTimeout(res, 380); });
      undoBtn.click(); await new Promise(function (res) { setTimeout(res, 380); });
      chk('连退 3 次回到 1 次', S.rounds === 1, 'rounds=' + S.rounds);
      chk('退到底后按钮置灰', undoBtn.disabled === true, String(undoBtn.disabled));
      undoBtn.click();
      await new Promise(function (res) { setTimeout(res, 220); });
      chk('退到底再点不会越界', S.rounds === 1, 'rounds=' + S.rounds);

      /* 回到 2 次，后面用例沿用 */
      document.getElementById('btn-sl-add').click();
      await new Promise(function (res) { setTimeout(res, 380); });
      chk('可以再次叠加回去', S.rounds === 2, 'rounds=' + S.rounds);
    }

    /* --- 背景光 --- */
    var gradBefore = 0, gradAfter = 0;
    function gradEnergy(cv) {
      var d = cv.getContext('2d').getImageData(0, 0, 1200, 800).data;
      var sum = 0, n = 0;
      for (var y = 0; y < 800; y += 3) {
        for (var xx = 0; xx < 1197; xx += 3) {
          var i = (y * 1200 + xx) * 4;
          sum += Math.abs(d[i] - d[i + 12]) + Math.abs(d[i + 1] - d[i + 13]) + Math.abs(d[i + 2] - d[i + 14]);
          n += 3;
        }
      }
      return n ? sum / n : 0;
    }
    var before = 0, after = 0;
    (function () {
      var d = c.getContext('2d').getImageData(0, 0, 1200, 800).data;
      for (var i = 0; i < d.length; i += 4000) before += d[i] + d[i + 1] + d[i + 2];
    })();
    gradBefore = gradEnergy(c);
    S.P.look.glowOn = true;
    S.P.look.glow = 70;
    S.P.look.glowSize = 80;
    S.P.look.glowColor = '#ffe9b8';
    A.apply(true);
    (function () {
      var d = c.getContext('2d').getImageData(0, 0, 1200, 800).data;
      for (var i = 0; i < d.length; i += 4000) after += d[i] + d[i + 1] + d[i + 2];
    })();
    gradAfter = gradEnergy(c);
    chk('背景光生效（画面变亮）', after > before, before + ' → ' + after);
    chk('加强光不糊细节（梯度保留 ≥85%）', gradAfter >= gradBefore * 0.85,
      gradBefore.toFixed(2) + ' → ' + gradAfter.toFixed(2) + ' (' + Math.round(gradAfter / gradBefore * 100) + '%)');

    /* --- 滤镜强度自定义 --- */
    S.P.look.glowOn = false;
    S.P.look.sat = 130;
    S.P.look.temp = 20;
    S.P.look.vig = 40;
    A.apply(true);
    chk('滤镜强度可调（饱和度/色温/暗角）', S.stats.psnr > 10 && S.stats.psnr < 42, S.stats.psnr.toFixed(2) + ' dB');

    /* --- 恢复干净参数，测 PNG tEXt --- */
    S.P.look.sat = 100; S.P.look.temp = 0; S.P.look.vig = 0;
    S.P.look.glowOn = false;
    S.P.slice.on = false;
    S.rounds = 1;
    A.apply(true);

    var out1 = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
    var buf1 = await out1.arrayBuffer();
    var withText = A.injectPngText(buf1, [['Software', 'Writer Guard · 截图标注'], ['Seed', String(S.seed)]]);
    var txt = new TextDecoder('utf-8').decode(new Uint8Array(withText));
    chk('PNG 已写入处理标记（tEXt）', txt.indexOf('tEXt') > 0 && txt.indexOf('Writer Guard') > 0,
      Math.round(withText.byteLength / 1024) + ' KB');
    chk('写入后仍是合法 PNG（签名+尾巴）', (function () {
      var u = new Uint8Array(withText);
      return u[0] === 137 && u[1] === 80 && u[u.length - 12] === 0 && u[u.length - 8] === 73;
    })(), '');

    /* --- JPG 导出 --- */
    var jpg = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.94); });
    chk('JPG 导出可用', !!jpg && jpg.size > 20000, jpg ? Math.round(jpg.size / 1024) + ' KB' : 'null');

    /* --- 报告面板 --- */
    chk('报告区已填数', /\\d/.test(document.getElementById('fp-size').textContent) &&
      /dB|一致/.test(document.getElementById('fp-psnr').textContent),
      document.getElementById('fp-size').textContent + ' / ' + document.getElementById('fp-psnr').textContent);

    /* --- 图形可拖动 --- */
    A.setZoom(1);
    var rc = c.getBoundingClientRect();
    var sc = c.width / (rc.width || 1);
    function pt(x, y) {
      return { clientX: rc.left + x / sc, clientY: rc.top + y / sc };
    }
    A.state.ops.length = 0;
    document.querySelector('.tool-btn[data-tool="arrow"]').click();
    var a0 = pt(100, 100);
    var a1 = pt(300, 200);
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: a0.clientX, clientY: a0.clientY, button: 0, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: a1.clientX, clientY: a1.clientY, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mouseup', { clientX: a1.clientX, clientY: a1.clientY, bubbles: true }));
    chk('先画一条箭头', A.state.ops.length === 1, 'ops=' + A.state.ops.length);

    document.querySelector('.tool-btn[data-tool="select"]').click();
    var m0 = pt(200, 150);
    var m1 = pt(260, 210);
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: m0.clientX, clientY: m0.clientY, button: 0, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: m1.clientX, clientY: m1.clientY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: m1.clientX, clientY: m1.clientY, bubbles: true }));
    var movedOp = A.state.ops[0];
    chk('移动工具能拖动箭头到新位置',
      Math.abs(movedOp.x1 - 160) < 6 && Math.abs(movedOp.y1 - 160) < 6,
      Math.round(movedOp.x1) + ',' + Math.round(movedOp.y1));
    chk('拖动时给出选中框', A.state.sel === 0, 'sel=' + A.state.sel);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    chk('Delete 删除选中的图形', A.state.ops.length === 0, 'ops=' + A.state.ops.length);

    /* Alt+拖动 在任何工具下都能挪 */
    A.state.ops.push({ type: 'rect', x1: 400, y1: 300, x2: 560, y2: 420, color: '#e5484d', w: 3 });
    document.querySelector('.tool-btn[data-tool="arrow"]').click();
    var r0 = pt(480, 360);
    var r1 = pt(520, 400);
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: r0.clientX, clientY: r0.clientY, button: 0, altKey: true, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: r1.clientX, clientY: r1.clientY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: r1.clientX, clientY: r1.clientY, bubbles: true }));
    chk('Alt+拖动也能挪矩形', Math.abs(A.state.ops[0].x1 - 440) < 6, Math.round(A.state.ops[0].x1));
  } catch (e) {
    chk('脚本异常', false, (e && e.message) || String(e));
  }
  return out;
})()`;

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgannotate-' + Date.now(),
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
  let topCtx = null;

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Runtime.executionContextCreated') {
      const c = m.params.context;
      if (c.auxData && c.auxData.isDefault && c.auxData.frameId === page.id) topCtx = c;
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
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#annotate' });
  await sleep(3600);

  if (!topCtx) {
    const r = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    if (!r.result) { console.log('FAIL: 拿不到执行上下文'); server.close(); chrome.kill(); process.exit(1); }
  }

  const res = await send('Runtime.evaluate', {
    expression: PAGE_SCRIPT,
    returnByValue: true,
    awaitPromise: true,
    contextId: topCtx ? topCtx.id : undefined,
  });

  const val = res.result && res.result.result && res.result.result.value;
  let pass = 0;
  let fail = 0;
  if (!val) {
    console.log('FAIL: 脚本没有返回值');
    console.log(JSON.stringify(res.result, null, 2).slice(0, 1200));
    fail = 1;
  } else {
    val.forEach((t) => {
      const line = (t.ok ? 'PASS ' : 'FAIL ') + t.n + (t.ex ? '  [' + t.ex + ']' : '');
      console.log(line);
      if (t.ok) pass++; else fail++;
    });
  }

  console.log('\nRESULT: ' + pass + ' pass / ' + fail + ' fail');
  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})();
