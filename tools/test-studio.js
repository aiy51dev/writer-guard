/* ============================================================
 * Studio 内置应用集成测试（CDP 驱动）
 * ------------------------------------------------------------
 * 1. 起本地静态服务（扩展目录）
 * 2. headless Chrome 打开 tests/studio-harness.html
 * 3. harness 用 sandbox iframe 载入 studio 两个页面（= 扩展沙箱页环境）
 * 4. 用 CDP（含 OOPIF 会话）进入 iframe 的执行上下文做断言
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8899;
const PORT_CDP = 9341;
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
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/tests/studio-harness.html';
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

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgstudio-test-' + Date.now(),
    'about:blank',
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    await sleep(350);
    try {
      list = await (await fetch('http://127.0.0.1:' + PORT_CDP + '/json/list')).json();
      if (list && list.length) break;
    } catch (e) { /* 等 Chrome 起来 */ }
  }
  if (!list) { console.log('FAIL: CDP 没起来'); server.close(); chrome.kill(); process.exit(1); }

  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0;
  const waits = new Map();
  const contexts = [];      /* { id, sessionId, aux } */
  const sessions = new Set();

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Target.attachedToTarget') {
      const s = m.params.sessionId;
      sessions.add(s);
      send('Runtime.enable', {}, s);
      return;
    }
    if (m.method === 'Runtime.executionContextCreated') {
      contexts.push({ id: m.params.context.id, sessionId: m.sessionId || null, aux: m.params.context.auxData || {} });
      return;
    }
    if (m.method === 'Runtime.executionContextsCleared') {
      for (let i = contexts.length - 1; i >= 0; i--) {
        if (contexts[i].sessionId === (m.sessionId || null)) contexts.splice(i, 1);
      }
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

  await sleep(10000);   /* 两个页面都不小，等它们跑完 */

  async function evalIn(ctx, expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      contextId: ctx.id,
      returnByValue: true,
      awaitPromise: true,
    }, ctx.sessionId);
    const res = r.result || {};
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      return { __error: (d.text || '') + ' ' + String((d.exception && d.exception.description) || '').slice(0, 160) };
    }
    return res.result ? res.result.value : undefined;
  }

  /* 找到顶层 / 两个 iframe 的默认上下文 */
  let topCtx = null;
  const frameCtx = {};
  for (const c of contexts) {
    if (!c.aux.isDefault) continue;
    const v = await evalIn(c, 'location.href');
    if (typeof v !== 'string') continue;
    if (v.indexOf('studio-harness') >= 0) topCtx = c;
    if (v.indexOf('emotion.html') >= 0) frameCtx.emotion = c;
    if (v.indexOf('zhilu.html') >= 0) frameCtx.zhilu = c;
  }

  const out = [];
  const check = (name, ok, extra) => out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
  check('两个 iframe 都拿到执行上下文', !!frameCtx.emotion && !!frameCtx.zhilu,
    'emotion=' + !!frameCtx.emotion + ' zhilu=' + !!frameCtx.zhilu + ' contexts=' + contexts.length);
  if (!topCtx) { console.log('FAIL: 找不到测试台上下文'); }

  /* ---------- 情绪导演 ---------- */
  if (frameCtx.emotion) {
    const e = frameCtx.emotion;
    check('情绪导演：桥接已握手', await evalIn(e, 'window.WGStudio && WGStudio.isBridged()') === true);
    check('情绪导演：localStorage 不抛错', await evalIn(e, '(function(){try{localStorage.setItem("t","1");return localStorage.getItem("t")==="1";}catch(err){return "throw:"+err.name}})()') === true);
    check('情绪导演：四种素材类型按钮', await evalIn(e, 'document.querySelectorAll(".type-btn").length') === 4);
    check('情绪导演：入口按钮已挂载', await evalIn(e, 'document.querySelectorAll(".panel .btn-row button").length >= 4'));

    const fetched = await evalIn(e, `(async function(){
      try {
        const r = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({model:'agnes-2.0-flash',messages:[{role:'user',content:'hi'}]}) });
        const j = await r.json();
        return JSON.stringify({ ok: r.ok, status: r.status, bridged: j.bridged, echo: j.echo });
      } catch (err) { return 'throw:' + err.message; }
    })()`);
    check('情绪导演：跨域 fetch 走扩展反代', typeof fetched === 'string' && fetched.indexOf('"bridged":true') >= 0, String(fetched).slice(0, 130));

    await evalIn(e, `document.getElementById('outputText').value = '## 测试导演词\\n\\n### 时间线\\n- [脸] 面部：嘴角先抖了一下'; true`);
    await evalIn(e, `(function(){
      const b = Array.from(document.querySelectorAll('.panel .btn-row button')).find(function(x){ return x.textContent.indexOf('发到编辑台') >= 0; });
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(500);
    const gotWriter = topCtx ? await evalIn(topCtx, 'window.__lastWriter ? JSON.stringify(window.__lastWriter) : null') : null;
    check('情绪导演：一键发到编辑台', typeof gotWriter === 'string' && gotWriter.indexOf('测试导演词') >= 0, String(gotWriter).slice(0, 100));
  }

  /* ---------- 智录笔记 ---------- */
  if (frameCtx.zhilu) {
    const z = frameCtx.zhilu;
    check('智录笔记：桥接已握手', await evalIn(z, 'window.WGStudio && WGStudio.isBridged()') === true);
    check('智录笔记：localStorage 兜底可用', await evalIn(z, '(function(){try{localStorage.setItem("zt","2");return localStorage.getItem("zt")==="2";}catch(err){return "throw:"+err.name}})()') === true);
    check('智录笔记：种子数据回填 API Key', await evalIn(z, '(document.getElementById("apiKey")||{}).value') === 'sk-seed-test-123');
    check('智录笔记：种子数据回填水印预设', await evalIn(z, '(function(){try{return JSON.parse(localStorage.getItem("zhilu_wm_presets")||"[]").length;}catch(e){return -1}})()') === 3);
    check('智录笔记：confirm/prompt 已接管', await evalIn(z, 'typeof wgConfirm === "function" && typeof wgPrompt === "function"'));
    check('智录笔记：顶栏按钮渲染', await evalIn(z, 'document.querySelectorAll(".top-bar button").length >= 5'));
    check('智录笔记：精简后顶栏按钮不超过 7 个', await evalIn(z, `(function(){
      var n = document.querySelectorAll(".top-bar button").length;
      return n >= 5 && n <= 7;
    })()`), await evalIn(z, 'document.querySelectorAll(".top-bar button").length'));
    check('智录笔记：AI优化关/合并重复/AI对话 三个按钮已移除', await evalIn(z, `(function(){
      var t = document.querySelector('.top-bar');
      var txt = t ? t.textContent : '';
      return txt.indexOf('AI优化关') < 0 && txt.indexOf('合并重复笔记') < 0 && txt.indexOf('AI对话助手') < 0;
    })()`), await evalIn(z, `(document.querySelector('.top-bar')||{}).textContent || ''`));
    check('智录笔记：封面画布存在', await evalIn(z, '!!document.getElementById("coverCanvas")'));
    check('智录笔记：视频/字幕控件存在', await evalIn(z, '!!document.getElementById("videoFile") && !!document.getElementById("srtFile")'));
    check('智录笔记：视频理解面板存在', await evalIn(z, '!!document.getElementById("vpDropZone") && !!document.getElementById("adPrompt")'));

    await evalIn(z, `(function(){
      const root = document.getElementById('articleContent');
      if (root) root.innerHTML = '<h2>小节标题</h2><p>这是一段<strong>加粗</strong>的文字。</p><ul><li>要点一</li><li>要点二</li></ul>';
      return true;
    })()`);
    await evalIn(z, `(function(){
      const b = Array.from(document.querySelectorAll('.top-bar button')).find(function(x){ return x.textContent.indexOf('发到编辑台') >= 0; });
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(500);
    const md = topCtx ? await evalIn(topCtx, 'window.__lastWriter ? window.__lastWriter.md : null') : null;
    check('智录笔记：正文转 Markdown 发到编辑台',
      typeof md === 'string' && md.indexOf('## 小节标题') >= 0 && md.indexOf('- 要点一') >= 0 && md.indexOf('**加粗**') >= 0,
      String(md || '').replace(/\n/g, '⏎').slice(0, 100));

    await evalIn(z, `(function(){
      const b = Array.from(document.querySelectorAll('.top-bar button')).find(function(x){ return x.textContent.indexOf('送合规检测') >= 0; });
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(400);
    const cmp = topCtx ? await evalIn(topCtx, 'window.__lastCmp ? window.__lastCmp.slice(0,40) : null') : null;
    check('智录笔记：送合规检测', typeof cmp === 'string' && cmp.length > 0, String(cmp));

    await evalIn(z, `(function(){
      const blob = new Blob(['hello-wg'], {type:'text/plain'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wg-test.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    })()`);
    await sleep(800);
    const dl = topCtx ? await evalIn(topCtx, 'window.__lastDownload ? JSON.stringify(window.__lastDownload) : null') : null;
    check('智录笔记：导出下载走中转', typeof dl === 'string' && dl.indexOf('wg-test.txt') >= 0, String(dl));

    /* 确认弹窗：真的渲染出来，点确定能拿到 true */
    await evalIn(z, `(function(){ window.__confirmResult = 'pending'; wgConfirm('测试确认框').then(function(v){ window.__confirmResult = String(v); }); return true; })()`);
    await sleep(400);
    const dlgBox = await evalIn(z, `(function(){
      const t = Array.from(document.querySelectorAll('div')).filter(function(d){ return d.textContent === '请确认'; });
      if (!t.length) return 0;
      const ok = Array.from(t[0].parentElement.querySelectorAll('button')).find(function(b){ return b.textContent === '确定'; });
      if (ok) ok.click();
      return 1;
    })()`);
    check('智录笔记：确认弹窗渲染并可点确定', dlgBox === 1, 'rendered=' + dlgBox);
    await sleep(300);
    check('智录笔记：确认回调返回 true', await evalIn(z, 'window.__confirmResult') === 'true');

    /* ---------- SRT 上传（沙箱里 File System Access API 被拦，走桥接替代） ---------- */
    check('智录笔记：文件选择器已接管',
      await evalIn(z, 'window.showOpenFilePicker.toString().indexOf("pickFileDialog") >= 0 || window.showOpenFilePicker.toString().indexOf("files.map") >= 0'));
    await evalIn(z, `(function(){ var b = document.getElementById('watchDirBtn'); if (b) b.click(); return !!b; })()`);
    await sleep(500);
    check('智录笔记：点「📄 SRT」弹出文件选择框',
      await evalIn(z, 'document.querySelectorAll("[data-wg-filepicker]").length') === 1);

    await evalIn(z, `(function(){
      var mask = document.querySelector('[data-wg-filepicker]');
      if (!mask) return 'no-dialog';
      var input = mask.querySelector('input[type=file]');
      var srt = '1\\n00:00:01,000 --> 00:00:03,000\\n第一句字幕\\n\\n2\\n00:00:04,000 --> 00:00:06,500\\n第二句字幕\\n\\n3\\n00:00:07,000 --> 00:00:09,000\\n第三句字幕\\n';
      var dt = new DataTransfer();
      dt.items.add(new File([srt], 'test.srt', { type: 'text/plain' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'fed';
    })()`);
    await sleep(1200);
    const srtTxt = await evalIn(z, '(document.getElementById("srtStatus")||{}).textContent');
    const subCount = await evalIn(z, 'typeof subtitleItems !== "undefined" ? subtitleItems.length : -1');
    const listed = await evalIn(z, 'document.querySelectorAll("#subtitleListContainer .subtitle-item").length');
    const countTxt = await evalIn(z, '(document.getElementById("subtitleCount")||{}).textContent');
    check('智录笔记：SRT 解析出 3 条字幕', subCount === 3, 'subtitleItems=' + subCount + ' status=' + srtTxt);
    check('智录笔记：字幕列表已渲染', listed === 3, 'items=' + listed + ' count=' + countTxt);
    check('智录笔记：选择框已关闭', await evalIn(z, 'document.querySelectorAll("[data-wg-filepicker]").length') === 0);

    /* 视频按钮走的是同一个接管通道，accept 要按类型过滤 */
    await evalIn(z, `(function(){ var b = Array.from(document.querySelectorAll('button')).find(function(x){ return x.textContent.indexOf('📁 视频') >= 0; }); if (b) b.click(); return !!b; })()`);
    await sleep(400);
    const vAccept = await evalIn(z, `(function(){ var m = document.querySelector('[data-wg-filepicker]'); if (!m) return 'no-dialog'; var i = m.querySelector('input[type=file]'); return i ? i.accept : 'no-input'; })()`);
    check('智录笔记：视频按钮弹框且按类型过滤', typeof vAccept === 'string' && vAccept.indexOf('.mp4') >= 0, String(vAccept));
    await evalIn(z, `(function(){ var m = document.querySelector('[data-wg-filepicker]'); if (m) { var b = m.querySelector('button'); if (b) b.click(); } return true; })()`);

    /* ---------- 公众号标题栏（替换原来那两行说明文字） ---------- */
    check('智录笔记：标题栏已替换原说明文字',
      await evalIn(z, `!!document.querySelector('.__wg_titlebar') && getComputedStyle(document.querySelector('.article-meta')).display === 'none'`));
    await evalIn(z, `(function(){
      var i = document.getElementById('__wg_title_input');
      i.value = '三个动作让短视频不油腻';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('__wg_title_btn').click();
      return true;
    })()`);
    await sleep(400);
    const titleMsg = await evalIn(topCtx, `JSON.stringify(window.__msgs.filter(function(m){ return m.indexOf('WG_SET_WX_TITLE') >= 0; }).length)`);
    const titleKept = await evalIn(z, `localStorage.getItem('zhilu_wx_title')`);
    const oldTitleSync = await evalIn(z, `document.querySelector('.article-title').textContent`);
    check('智录笔记：标题插入按钮发出投递消息', Number(titleMsg) >= 1, 'count=' + titleMsg);
    check('智录笔记：标题写入本地存档（重开还在）', titleKept === '三个动作让短视频不油腻', String(titleKept));
    check('智录笔记：标题同步回文章头', oldTitleSync === '三个动作让短视频不油腻', String(oldTitleSync));
  }

  if (topCtx) out.push('消息流水: ' + await evalIn(topCtx, 'JSON.stringify(window.__msgs.slice(0, 12))'));

  console.log(out.join('\n'));
  const fails = out.filter((l) => l.indexOf('FAIL') === 0).length;
  console.log('\nRESULT: ' + (out.filter((l) => /^(PASS|FAIL)/.test(l)).length - fails) + ' pass / ' + fails + ' fail');

  ws.close();
  chrome.kill();
  server.close();
  process.exit(fails ? 1 : 0);
})();
