/* ============================================================
 * 情绪导演 · API Key 兜底测试（CDP 驱动）
 * ------------------------------------------------------------
 * 场景：用户没有单独填 Key，页面应自动复用「工作台设置里配好的那套 API」。
 *   ① 父窗口广播 WG_AI_CFG → iframe 收到 → 顶部出现「已用工作台配置」标记
 *   ② 点「生成」时请求打到 team 的 baseUrl + model + Bearer key
 *   ③ 自己填了 Key → 优先用 Agnes 官方接口，标记消失
 *   ④ 两边都没有 → 明确提示，不发请求
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8906;
const PORT_CDP = 9352;
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

const TEAM = {
  key: 'sk-team-xyz-123',
  baseUrl: 'https://team.example.com/v1/',
  model: 'team-gpt-x',
};
const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--window-size=1400,900',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgemotion-' + Date.now(),
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
      return { __error: (res.exceptionDetails.text || '') + ' ' +
        String((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || '').slice(0, 240) };
    }
    return res.result ? res.result.value : undefined;
  }

  let topCtx = null;
  let emoCtx = null;
  for (const c of contexts) {
    if (!c.aux.isDefault) continue;
    const v = await evalIn(c, 'location.href');
    if (typeof v !== 'string') continue;
    if (v.indexOf('studio-harness') >= 0) topCtx = c;
    if (v.indexOf('emotion.html') >= 0) emoCtx = c;
  }

  const out = [];
  let pass = 0;
  let fail = 0;
  const chk = (n, ok, ex) => {
    if (ok) { pass++; out.push('PASS  ' + n + (ex ? '  [' + ex + ']' : '')); }
    else { fail++; out.push('FAIL  ' + n + (ex ? '  ::  ' + ex : '')); }
  };

  if (!topCtx || !emoCtx) {
    chk('测试台与情绪导演都加载完成', false, 'top=' + !!topCtx + ' emotion=' + !!emoCtx);
  } else {
    /* ---------- ① 父窗口广播团队 API ---------- */
    await evalIn(topCtx, `window.__setAI(${JSON.stringify(TEAM)})`);
    await sleep(600);

    chk('iframe 收到团队 API', await evalIn(emoCtx,
      `(function(){var t=window.wgGetTeamAI&&window.wgGetTeamAI();return !!(t&&t.model==='team-gpt-x');})()`));

    chk('顶部出现「已用工作台配置」标记', await evalIn(emoCtx,
      `(function(){var el=document.getElementById('aiSource');return !!el && !el.hidden && /team-gpt-x/.test(el.textContent);})()`),
      await evalIn(emoCtx, `(document.getElementById('aiSource')||{}).textContent || ''`));

    /* ---------- ② 不填 Key 直接生成 ---------- */
    await evalIn(topCtx, 'window.__fetchCalls.length = 0');
    await evalIn(emoCtx, `(function(){
      document.getElementById('inputText').value = '场景：深夜便利店\\n角色：店员（女，24岁）';
      document.getElementById('btnGenerate').click();
      return true;
    })()`);
    await sleep(1600);

    const calls1 = await evalIn(topCtx, 'window.__fetchCalls.slice()') || [];
    const c1 = calls1[calls1.length - 1] || {};
    chk('已发出生成请求', calls1.length > 0, 'calls=' + calls1.length);
    chk('请求打到团队 baseUrl', String(c1.url || '') === 'https://team.example.com/v1/chat/completions', c1.url);
    chk('用团队的模型名', /team-gpt-x/.test(String(c1.body || '')), String(c1.body || '').slice(0, 60));
    const auth1 = JSON.stringify(c1.headers || {});
    chk('带上团队的 Key', /sk-team-xyz-123/.test(auth1), auth1.slice(0, 90));
    chk('生成结果已回填', await evalIn(emoCtx,
      `(document.getElementById('outputText').value||'').indexOf('导演词') >= 0`),
      String(await evalIn(emoCtx, `(document.getElementById('outputText').value||'').slice(0, 30)`)));

    /* ---------- ③ 自己填 Key：优先 Agnes ---------- */
    await evalIn(topCtx, 'window.__fetchCalls.length = 0');
    await evalIn(emoCtx, `(function(){
      var el = document.getElementById('apiKey');
      el.value = 'sk-own-777';
      el.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    })()`);
    await sleep(200);
    chk('填了自己的 Key，标记自动隐藏', await evalIn(emoCtx,
      `!!document.getElementById('aiSource').hidden`));

    await evalIn(emoCtx, `document.querySelector('[onclick="verifyKey()"]').click()`);
    await sleep(900);
    const calls2 = await evalIn(topCtx, 'window.__fetchCalls.slice()') || [];
    const c2 = calls2[calls2.length - 1] || {};
    chk('自己的 Key 走 Agnes 官方接口', String(c2.url || '') === AGNES_BASE + '/chat/completions', c2.url);
    chk('用 Agnes 的默认模型', /agnes-2\.0-flash/.test(String(c2.body || '')), String(c2.body || '').slice(0, 60));
    chk('用自己的 Key', /sk-own-777/.test(JSON.stringify(c2.headers || {})));

    /* ---------- ④ 两边都没有：明确提示、不发请求 ---------- */
    await evalIn(topCtx, 'window.__setAI(null); window.__fetchCalls.length = 0');
    await evalIn(emoCtx, `(function(){
      var el = document.getElementById('apiKey');
      el.value = '';
      el.dispatchEvent(new Event('input', {bubbles:true}));
      document.getElementById('btnGenerate').click();
      return true;
    })()`);
    await sleep(700);
    const calls3 = await evalIn(topCtx, 'window.__fetchCalls.slice()') || [];
    chk('没 Key 时不会乱发请求', calls3.length === 0, 'calls=' + calls3.length);
    chk('没 Key 时给出明确提示', await evalIn(emoCtx,
      `/API Key|工作台/.test((document.getElementById('toast')||{}).textContent || '')`),
      await evalIn(emoCtx, `(document.getElementById('toast')||{}).textContent || 'no toast'`));
  }

  console.log('');
  out.forEach((l) => console.log(l));
  console.log('');
  console.log('RESULT: ' + pass + ' pass / ' + fail + ' fail');
  console.log('');

  try { ws.close(); } catch (e) { /* ignore */ }
  server.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})();
