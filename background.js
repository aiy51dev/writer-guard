/* ============================================================
 * Writer Guard · 后台服务
 * ============================================================ */
'use strict';

const WORKBENCH_URL = 'workbench/workbench.html';
const WELCOME_URL = 'welcome.html';

function openWorkbench() {
  const url = chrome.runtime.getURL(WORKBENCH_URL);
  chrome.tabs.query({}, (tabs) => {
    const found = (tabs || []).find((t) => t.url && t.url.startsWith(url));
    if (found && found.id != null) {
      chrome.tabs.update(found.id, { active: true });
      if (found.windowId != null) chrome.windows.update(found.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'WG_OPEN_WORKBENCH') {
    openWorkbench();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'WG_GET_DICT_META') {
    // 从打包的词库文件里读元信息
    fetch(chrome.runtime.getURL('data/dict.js'))
      .then((r) => r.text())
      .then((text) => {
        const vMatch = text.match(/version:\s*'([^']+)'/);
        const redlineCount = (text.match(/id:\s*'crack'|id:\s*'netdisk'|id:\s*'proxy'|id:\s*'induce'|id:\s*'clickbait'|id:\s*'promise'|id:\s*'trademark'|id:\s*'external'/g) || []).length;
        sendResponse({
          version: vMatch ? vMatch[1] : 'unknown',
          redline: redlineCount || 8,
          ai: 5,
        });
      })
      .catch(() => sendResponse({ version: 'unknown', redline: 8, ai: 5 }));
    return true;
  }

  /* ---------- 公众号通道 ---------- */

  if (msg.type === 'WG_WX_IP') {
    getPublicIp().then((ip) => sendResponse({ ok: !!ip, ip: ip }));
    return true;
  }

  if (msg.type === 'WG_WX_TEST') {
    verifyBind().then(sendResponse);
    return true;
  }

  if (msg.type === 'WG_WX_OPEN_EDITOR') {
    openWxEditor().then(sendResponse).catch((e) => sendResponse({ ok: false, msg: e.message }));
    return true;
  }

  if (msg.type === 'WG_WX_PUSH') {
    wxPushDraft(msg.payload || {}).then(sendResponse).catch((e) => sendResponse({ ok: false, msg: e.message || '推送异常' }));
    return true;
  }

  /* ---------- 豆包联动 ---------- */

  if (msg.type === 'WG_IMG_TO_WX') {
    doubaoImgToWx(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, msg: e.message || '转发异常' }));
    return true;
  }

  /* 编辑台没接 API 时，把整段提示词推给豆包对话框，让豆包来写 */
  if (msg.type === 'WG_DOUBAO_ASK') {
    doubaoAsk(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, msg: e.message || '推送异常' }));
    return true;
  }

  /* 工作台右侧豆包侧窗：跨域 iframe 里的 content script 有时没注入
   * （扩展重载后旧 iframe 还挂着），这里直接从后台注入填充函数兜底。
   * 注意：只注入调用方自己的标签页，不碰别的页面。 */
  if (msg.type === 'WG_DOUBAO_FILL_FRAME') {
    (async () => {
      const tabId = sender && sender.tab && sender.tab.id;
      if (tabId == null) {
        sendResponse({ ok: false, msg: '拿不到工作台标签页' });
        return;
      }
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          func: doubaoFillInline,
          args: [String(msg.prompt || ''), msg.send !== false],
        });
        const hit = (res || []).map((x) => x && x.result).find((v) => v && v.ok);
        sendResponse(hit || { ok: false, msg: '豆包那一帧里没找到输入框' });
      } catch (e) {
        sendResponse({ ok: false, msg: '注入失败：' + ((e && e.message) || '未知错误') });
      }
    })();
    return true;
  }

  /* ---------- 内置应用（沙箱页）的网络反代 ---------- */

  if (msg.type === 'WG_STUDIO_FETCH') {
    studioFetch(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: (e && e.message) || '请求异常' }));
    return true;
  }

  /* 内置应用里填的公众号标题 → 写进公众号编辑器的标题框 */
  if (msg.type === 'WG_SET_WX_TITLE') {
    setWxTitleEverywhere(msg.title).then(sendResponse).catch((e) => sendResponse({ ok: false, msg: e.message || '写入异常' }));
    return true;
  }

  if (msg.type === 'WG_SEL_TO_WRITER') {
    const text = String(msg.text || '');
    if (!text.trim()) {
      sendResponse({ ok: false, msg: '没有选中内容' });
      return true;
    }
    chrome.storage.local.set({ wg_writer_inbox: { text: text, ts: Date.now() } }, () => {
      openWorkbench();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'WG_DOUBAO_WIN') {
    openDoubaoWindow().then(sendResponse).catch((e) => sendResponse({ ok: false, msg: e.message || '开窗失败' }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_URL) });
  }
});

/* ============================================================
 * AI 接口：每 24 小时静默复验一次
 * 失败只改标记，不弹通知、不打扰
 * ============================================================ */

const AI_ALARM = 'wg-ai-recheck';
const AI_STORE_KEY = 'wg_aiConfig';
const AI_INTERVAL_MS = 24 * 60 * 60 * 1000;

function ensureAIAlarm() {
  try {
    chrome.alarms.create(AI_ALARM, {
      delayInMinutes: 3,
      periodInMinutes: 24 * 60,
    });
  } catch (e) { /* ignore */ }
}

chrome.runtime.onInstalled.addListener(ensureAIAlarm);
chrome.runtime.onStartup.addListener(ensureAIAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === AI_ALARM) recheckAI();
});

async function verifyAIKey(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!base || !cfg.key) return { ok: false, msg: '配置不完整' };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + cfg.key,
  };

  try {
    const res = await fetch(base + '/models', { method: 'GET', headers });
    if (res.ok) return { ok: true, msg: '连接正常' };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, msg: 'Key 已失效（' + res.status + '）' };
    }
  } catch (e) { /* 继续试 chat */ }

  try {
    const res2 = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    if (res2.ok) return { ok: true, msg: '连接正常' };
    if (res2.status === 401 || res2.status === 403) {
      return { ok: false, msg: 'Key 已失效（' + res2.status + '）' };
    }
    return { ok: false, msg: '复验失败（' + res2.status + '）' };
  } catch (e2) {
    return { ok: false, msg: '连不上：' + (e2.message || '网络错误') };
  }
}

async function recheckAI() {
  try {
    const data = await chrome.storage.local.get(AI_STORE_KEY);
    const cfg = data && data[AI_STORE_KEY];
    if (!cfg || !cfg.key || !cfg.baseUrl) return;

    // 不到 24 小时不重复打网络
    if (cfg.lastCheck && Date.now() - cfg.lastCheck < AI_INTERVAL_MS) return;

    const r = await verifyAIKey(cfg);

    cfg.verified = !!r.ok;
    cfg.lastCheck = Date.now();
    cfg.lastMsg = r.msg;

    await chrome.storage.local.set({ [AI_STORE_KEY]: cfg });
    // 静默：不弹通知、不动角标
  } catch (e) { /* 后台任务失败不影响任何功能 */ }
}
/* ============================================================
 * 公众号通道
 *
 * 编辑台的「推送草稿箱」走这里，而不是在页面里直接 fetch：
 *   - api.weixin.qq.com 不给浏览器 CORS 头，页面里调必失败；
 *     后台 service worker 有 host 权限，不受同源限制。
 *   - access_token 一天只能刷有限次，新 token 会让旧 token 失效，
 *     所以内存里缓存，2 小时内复用。
 *
 * 「写入编辑器」不走这里：那条路是在已登录页面上直接排版，零配置。
 * ============================================================ */

const WX_API = 'https://api.weixin.qq.com/cgi-bin';
const WX_BIND_KEY = 'wg_wxBind';

let wxToken = { appId: '', token: '', exp: 0 };

async function readBind() {
  try {
    const d = await chrome.storage.local.get(WX_BIND_KEY);
    const v = d && d[WX_BIND_KEY];
    return (v && typeof v === 'object') ? v : {};
  } catch (e) {
    return {};
  }
}

async function getPublicIp() {
  const urls = ['https://api4.ipify.org', 'https://api.ipify.org'];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) continue;
      const t = (await r.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return t;
    } catch (e) { /* 换下一个 */ }
  }
  return '';
}

function tokenError(errmsg) {
  const msg = String(errmsg || '');
  const ip = (msg.match(/invalid ip\s+([\d.]+)/i) || [])[1] || '';
  return { ok: false, code: 40164, ip: ip, msg: ip ? ('IP 不在白名单：' + ip) : 'IP 不在白名单' };
}

async function wxGetToken(appId, secret) {
  const now = Date.now();
  if (wxToken.token && wxToken.appId === appId && wxToken.exp > now + 120000) {
    return { ok: true, token: wxToken.token };
  }

  const url = WX_API + '/token?grant_type=client_credential&appid=' +
    encodeURIComponent(appId) + '&secret=' + encodeURIComponent(secret);

  let data;
  try {
    data = await (await fetch(url, { cache: 'no-store' })).json();
  } catch (e) {
    return { ok: false, msg: '连不上微信接口：' + (e.message || '网络错误') };
  }

  if (data.errcode) {
    if (data.errcode === 40164) return tokenError(data.errmsg);
    return { ok: false, code: data.errcode, msg: data.errmsg || ('errcode ' + data.errcode) };
  }
  if (!data.access_token) {
    return { ok: false, msg: '微信返回异常：' + JSON.stringify(data).slice(0, 160) };
  }

  wxToken = {
    appId: appId,
    token: data.access_token,
    exp: now + (Number(data.expires_in) || 7200) * 1000,
  };
  return { ok: true, token: wxToken.token };
}

async function verifyBind() {
  const cfg = await readBind();
  if (!cfg.appId || !cfg.secret) return { ok: false, msg: 'AppID / AppSecret 还没填' };

  const t = await wxGetToken(cfg.appId, cfg.secret);
  if (!t.ok) {
    if (t.code === 40164 && !t.ip) {
      const ip = await getPublicIp();
      if (ip) t.ip = ip;
    }
    return t;
  }
  return { ok: true, msg: '接口连通' };
}

/* dataURL → Blob（service worker 里没有 FileReader，只能手搓） */
function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1];
  const isB64 = !!m[2];
  const body = m[3];

  try {
    if (!isB64) return new Blob([decodeURIComponent(body)], { type: mime });
    const bin = atob(body);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (e) {
    return null;
  }
}

function pickFilename(type, fallback) {
  const t = String(type || '');
  if (t.includes('png')) return 'cover.png';
  if (t.includes('gif')) return 'cover.gif';
  if (t.includes('webp')) return 'cover.webp';
  return fallback || 'cover.jpg';
}

/* 封面 → 永久素材 media_id（草稿的 thumb_media_id 必须是它） */
async function wxUploadCover(token, cover) {
  let blob = null;
  let name = 'cover.jpg';

  if (/^data:image\//i.test(cover)) {
    blob = dataUrlToBlob(cover);
    name = pickFilename(blob && blob.type, 'cover.jpg');
  } else if (/^https?:\/\//i.test(cover)) {
    try {
      const r = await fetch(cover, { cache: 'no-store' });
      if (!r.ok) return { ok: false, msg: '封面下载失败 HTTP ' + r.status };
      blob = await r.blob();
      name = pickFilename(blob.type, 'cover.jpg');
    } catch (e) {
      return { ok: false, msg: '封面下载失败：' + (e.message || '网络错误') };
    }
  } else {
    return { ok: false, msg: '封面地址不认识：' + String(cover).slice(0, 40) };
  }

  if (!blob) return { ok: false, msg: '封面数据为空' };
  if (blob.size > 10 * 1024 * 1024) return { ok: false, msg: '封面超过 10MB，先压缩再传' };

  const form = new FormData();
  form.append('media', blob, name);

  let d;
  try {
    d = await (await fetch(WX_API + '/material/add_material?access_token=' + token + '&type=image', {
      method: 'POST',
      body: form,
    })).json();
  } catch (e) {
    return { ok: false, msg: '封面上传失败：' + (e.message || '网络错误') };
  }

  if (d.errcode) return { ok: false, code: d.errcode, msg: d.errmsg || ('封面素材错误 ' + d.errcode) };
  if (!d.media_id) return { ok: false, msg: '封面素材上传返回异常' };
  return { ok: true, media_id: d.media_id };
}

function needUpload(src) {
  if (!src) return false;
  if (/^data:image\//i.test(src)) return true;
  if (!/^https?:\/\//i.test(src)) return false;
  return !/mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn|res\.wx\.qq\.com/i.test(src);
}

/* 正文里的外链图和 dataURL 图，一律换到微信 CDN，否则会被屏蔽 */
async function wxRewriteBodyImages(token, html) {
  const found = [];
  String(html || '').replace(/\bsrc="([^"]+)"/g, (m, u) => { found.push(u); return m; });

  const uniq = Array.from(new Set(found)).filter(needUpload);
  if (!uniq.length) return html;

  const map = {};

  for (const src of uniq) {
    let blob = null;
    if (/^data:image\//i.test(src)) {
      blob = dataUrlToBlob(src);
    } else {
      try {
        const r = await fetch(src, { cache: 'no-store' });
        if (!r.ok) continue;
        blob = await r.blob();
      } catch (e) { continue; }
    }
    if (!blob) continue;

    const name = 'body' + (blob.type.includes('png') ? '.png' : blob.type.includes('gif') ? '.gif' : '.jpg');
    const form = new FormData();
    form.append('media', blob, name);

    try {
      const d = await (await fetch(WX_API + '/media/uploadimg?access_token=' + token, {
        method: 'POST',
        body: form,
      })).json();
      if (d.url) map[src] = d.url;
    } catch (e) { /* 单张失败不影响整篇 */ }
  }

  if (!Object.keys(map).length) return html;

  return String(html).replace(/(\bsrc=")([^"]+)(")/g, (m, a, u, b) => (
    map[u] ? a + map[u] + b : m
  ));
}

async function wxPushDraft(payload) {
  const appId = String(payload.appId || '').trim();
  const secret = String(payload.secret || '').trim();
  const html = String(payload.html || '');
  const cover = String(payload.cover || '');

  if (!appId || !secret) return { ok: false, msg: 'AppID / AppSecret 缺失' };
  if (!html) return { ok: false, msg: '正文是空的' };
  if (!cover) return { ok: false, msg: '缺少封面图' };

  // 草稿接口对正文长度有限制，超了直接说清楚，别让用户面对一句 errcode
  if (html.length > 20000) {
    return { ok: false, msg: '正文渲染后超过 2 万字符（微信草稿接口上限），建议拆成上下篇' };
  }

  let title = String(payload.title || '').trim();
  if (!title) return { ok: false, msg: '标题是空的' };
  let titleWarn = '';
  if (title.length > 64) {
    title = title.slice(0, 64);
    titleWarn = '标题超过 64 字，已自动截断。';
  }

  const t = await wxGetToken(appId, secret);
  if (!t.ok) {
    if (t.code === 40164 && !t.ip) t.ip = await getPublicIp();
    return t;
  }

  const c = await wxUploadCover(t.token, cover);
  if (!c.ok) return c;

  const content = await wxRewriteBodyImages(t.token, html);

  const article = {
    title: title,
    author: String(payload.author || '').slice(0, 16),
    digest: String(payload.digest || '').slice(0, 120),
    content: content,
    thumb_media_id: c.media_id,
    show_cover_pic: 1,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };

  let d;
  try {
    d = await (await fetch(WX_API + '/draft/add?access_token=' + t.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ articles: [article] }),
    })).json();
  } catch (e) {
    return { ok: false, msg: '推送失败：' + (e.message || '网络错误') };
  }

  if (d.errcode) {
    if (d.errcode === 40164) return tokenError(d.errmsg);
    if (d.errcode === 45009) return { ok: false, code: d.errcode, msg: '接口调用超过当天限额（45009），明天再试或改用「写入编辑器」' };
    return { ok: false, code: d.errcode, msg: (d.errmsg || '推送失败') + '（errcode ' + d.errcode + '）' };
  }

  return {
    ok: true,
    media_id: d.media_id,
    msg: (titleWarn ? titleWarn : '') + '草稿已进草稿箱',
  };
}

/* 打开发文编辑页：优先复用已登录的标签页和它的 token */
async function openWxEditor() {
  const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
  const editorTab = (tabs || []).find((t) => /appmsg_edit|action=edit/i.test(t.url || ''));

  if (editorTab) {
    await chrome.tabs.update(editorTab.id, { active: true });
    if (editorTab.windowId != null) chrome.windows.update(editorTab.windowId, { focused: true });
    return { ok: true, tabId: editorTab.id };
  }

  let token = '';
  const anyTab = (tabs || [])[0];
  if (anyTab && anyTab.url) {
    try {
      token = new URL(anyTab.url).searchParams.get('token') || '';
    } catch (e) { token = ''; }
  }

  if (anyTab && token) {
    const url = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&token=' +
      encodeURIComponent(token) + '&lang=zh_CN';
    await chrome.tabs.update(anyTab.id, { url: url, active: true });
    return { ok: true, tabId: anyTab.id };
  }

  if (anyTab) {
    await chrome.tabs.update(anyTab.id, { active: true });
    return { ok: false, tabId: anyTab.id, msg: '已切到公众号页面：点「新的创作 → 图文消息」打开发布页，再点一次「写入」' };
  }

  const nt = await chrome.tabs.create({ url: 'https://mp.weixin.qq.com/' });
  return { ok: false, tabId: nt.id, msg: '已打开公众号后台：登录后新建图文消息，再点一次「写入」' };
}

/* ============================================================
 * 豆包联动
 *
 * ① 图片：豆包页面上点「插到公众号」→ 这里负责找公众号编辑页
 *    并把图喂进去。图的数据源优先 dataURL（豆包页 fetch 成功），
 *    失败就用后台 fetch 兜底（host 权限不受页面 CORS 限制）。
 * ② 选中文字：存进 wg_writer_inbox，然后拉起工作台，
 *    编辑台监听 storage 变化自动回填正文。
 * ③ 独立窗口：把豆包开成靠右半屏的独立窗口，工作台挤到左半屏。
 * ============================================================ */

async function fetchAsDataUrl(src) {
  if (/^data:image\//i.test(src)) return src;
  const r = await fetch(src, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  if (blob.size > 9 * 1024 * 1024) throw new Error('图片超过 9MB');
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('图片读取失败'));
    fr.readAsDataURL(blob);
  });
}

/* 找一个真的开着图文编辑器的公众号标签页 */
async function findWxEditorTab() {
  const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
  const sorted = (tabs || []).sort((a, b) => {
    const ea = /appmsg|appmsgpreview|action=edit/i.test(a.url || '') ? 1 : 0;
    const eb = /appmsg|appmsgpreview|action=edit/i.test(b.url || '') ? 1 : 0;
    return eb - ea;
  });

  for (const t of sorted) {
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: 'WG_PING_EDITOR' });
      if (r && r.ok) return { tab: t, editor: true };
    } catch (e) { /* 该页没注入或没编辑器，换下一个 */ }
  }
  return sorted.length ? { tab: sorted[0], editor: false } : null;
}

async function doubaoImgToWx(payload) {
  let dataUrl = String(payload.dataUrl || '');
  const src = String(payload.src || '');

  if (!dataUrl && src) {
    try {
      dataUrl = await fetchAsDataUrl(src);
    } catch (e) {
      return { ok: false, msg: '图片拉取失败（' + e.message + '），可右键复制图片后到编辑器 Ctrl+V' };
    }
  }
  if (!dataUrl) return { ok: false, msg: '图片数据为空' };

  const found = await findWxEditorTab();
  if (!found) {
    return { ok: false, msg: '没找到公众号标签页：先打开 mp.weixin.qq.com 的图文编辑页' };
  }
  if (!found.editor) {
    return { ok: false, msg: '公众号页开着但没进图文编辑器，先点「新的创作 → 图文消息」再试' };
  }

  try {
    const r = await chrome.tabs.sendMessage(found.tab.id, {
      type: 'WG_INSERT_IMAGE',
      dataUrl: dataUrl,
      name: payload.name || 'doubao.png',
      alt: payload.alt || '',
    });
    return r || { ok: false, msg: '插入无响应' };
  } catch (e) {
    return { ok: false, msg: '编辑页没响应，刷新公众号页面再试' };
  }
}

/* ============================================================
 * 编辑台 → 豆包对话
 * ------------------------------------------------------------
 * 没有配置 API Key 时，把「起标题 / 写正文 / 降 AI 味 / 生成摘要」
 * 这类请求整段推到豆包对话框里，由豆包来写。
 *   ① 找已经打开的豆包标签页（没有就开一个）
 *   ② 交给 content/doubao.js 把提示词塞进输入框并发送
 *   ③ 内容脚本没注入 / 没找到输入框 → chrome.scripting 直接往
 *      页面里注入填充函数再试一次（技能面板用的同一条管线）
 *   ④ 全都失败 → 返回失败，让工作台退到「复制提示词」
 * ============================================================ */

async function findDoubaoTab() {
  const re = /^https:\/\/(www\.)?doubao\.com\//;
  try {
    const tabs = await chrome.tabs.query({ url: ['https://www.doubao.com/*', 'https://doubao.com/*'] });
    const hit = (tabs || []).find((t) => re.test(t.url || '') && t.id != null);
    if (hit) return hit;
  } catch (e) { /* 查询语法不支持就全量过一遍 */ }

  const all = await chrome.tabs.query({});
  const hit = (all || []).find((t) => re.test(t.url || '') && t.id != null);
  return hit || null;
}

/* 注入用的填充函数：必须自包含（不能引用外部闭包），逻辑同 content/doubao.js */
async function doubaoFillInline(prompt, autoSend) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* 这个函数会被注入到「这个标签页的所有 frame」里。
   * 如果工作台是嵌在公众号页面里的，公众号编辑器也是 contenteditable，
   * 不设防就会把提示词填进正文。所以第一件事先认域名，不是豆包就直接退出。 */
  const host = String(location.hostname || '');
  if (!/(^|\.)doubao\.com$/i.test(host)) return { ok: false, skip: true, msg: '不是豆包页' };

  function vis(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function findInput() {
    const sels = [
      '[data-testid="chat_input_input"]',
      'textarea[placeholder]',
      'textarea',
      '[contenteditable="true"]',
    ];
    for (const s of sels) {
      let list = [];
      try { list = Array.from(document.querySelectorAll(s)); } catch (e) { continue; }
      const cands = list.filter(vis)
        .filter((el) => el.clientWidth > 120 && el.clientHeight >= 20)
        .filter((el) => {
          const ph = el.getAttribute && (el.getAttribute('placeholder') || '');
          return !/搜|search/i.test(ph || '');
        });
      if (cands.length) {
        cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
        return cands[0];
      }
    }
    return null;
  }

  async function fill(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      try { el.focus(); } catch (e) { /* ignore */ }
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const cur = el.value || '';
      const next = (cur && !/\s$/.test(cur) ? cur + '\n\n' : cur) + text;
      if (desc && desc.set) desc.set.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'value';
    }

    let t = el;
    if (!t.isContentEditable) {
      const nested = t.querySelector('[contenteditable="true"]');
      if (nested) t = nested;
    }
    try { t.focus(); } catch (e) { /* ignore */ }
    try {
      const sel = window.getSelection();
      const rg = document.createRange();
      rg.selectNodeContents(t);
      rg.collapse(false);
      sel.removeAllRanges();
      sel.addRange(rg);
    } catch (e) { /* ignore */ }

    /* ① 粘贴管线（Lexical/ProseMirror 都认） */
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      t.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch (e) { /* 继续下一档 */ }
    await sleep(320);
    if ((t.textContent || '').indexOf(text.slice(0, 8)) >= 0) return 'paste';

    /* ② execCommand insertText */
    try { document.execCommand('insertText', false, text); } catch (e) { /* ignore */ }
    await sleep(200);
    if ((t.textContent || '').indexOf(text.slice(0, 8)) >= 0) return 'exec';

    return null;
  }

  let input = null;
  for (let i = 0; i < 20; i++) {
    input = findInput();
    if (input) break;
    await sleep(400);
  }
  if (!input) return { ok: false, msg: '没找到豆包输入框' };

  const mode = await fill(input, prompt);
  if (!mode) return { ok: false, msg: '插不进豆包输入框' };

  let sent = false;
  if (autoSend) {
    await sleep(500);
    const sels = ['[data-testid="chat_input_send_button"]', '[data-testid="send_button"]', 'button[aria-label*="发送"]'];
    let btn = null;
    for (const s of sels) {
      let list = [];
      try { list = Array.from(document.querySelectorAll(s)); } catch (e) { continue; }
      btn = list.filter(vis).find((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (btn) break;
    }
    if (btn) {
      btn.click();
      sent = true;
    } else {
      ['keydown', 'keypress', 'keyup'].forEach((t) => {
        input.dispatchEvent(new KeyboardEvent(t, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
      });
    }
  }
  return { ok: true, mode: mode, sent: sent };
}

async function doubaoAsk(payload) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) return { ok: false, msg: '提示词是空的' };

  let tab = await findDoubaoTab();
  let created = false;
  let lastErr = '';

  if (!tab) {
    /* 工作台内置侧窗已经失败过才走到这里：
     * 只借用「已经开着的」豆包标签页，绝不新开一个网页版打断用户 */
    if (payload.noCreate) {
      return { ok: false, noTab: true, msg: '没有已打开的豆包标签页' };
    }
    if (payload.popup) {
      /* 用户主动点的「右侧小窗」：420 宽 popup 贴屏幕右侧，
       * 不是全尺寸标签页，也不改当前标签页，观感就是一条侧边栏 */
      try {
        const win = await chrome.windows.getLastFocused({ populate: false });
        const W = 430;
        const H = Math.max(560, Math.min(920, (win && win.height ? win.height - 90 : 760)));
        const left = (win && win.left != null && win.width) ? Math.max(0, win.left + win.width - W - 18) : undefined;
        const top = (win && win.top != null) ? win.top + 36 : undefined;
        const nw = await chrome.windows.create({
          url: 'https://www.doubao.com/chat/', type: 'popup',
          width: W, height: H, left: left, top: top, focused: true,
        });
        tab = (nw && nw.tabs && nw.tabs[0]) || null;
        if (!tab && nw && nw.id != null) {
          const list = await chrome.tabs.query({ windowId: nw.id });
          tab = (list || [])[0] || null;
        }
        if (!tab) return { ok: false, msg: '小窗没拿到标签页' };
        created = true;
      } catch (e) {
        return { ok: false, msg: '打不开豆包小窗：' + (e.message || '未知错误') };
      }
    } else {
      try {
        tab = await chrome.tabs.create({ url: 'https://www.doubao.com/chat/', active: true });
        created = true;
      } catch (e) {
        return { ok: false, msg: '打不开豆包标签页：' + (e.message || '未知错误') };
      }
    }
    /* 新标签页要等页面脚本跑起来，content script 才会应答 */
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'WG_DOUBAO_PING' });
        if (r && r.ok) break;
      } catch (e) { /* 还没就绪，继续等 */ }
    }
  } else if (!payload.popup) {
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (e) { /* ignore */ }
  }

  /* ① 优先走页面里的内容脚本（和技能面板同一条管线） */
  try {
    const r = await chrome.tabs.sendMessage(tab.id, {
      type: 'WG_DOUBAO_ASK',
      prompt: prompt,
      send: payload.send !== false,
    });
    if (r && r.ok) return Object.assign({ created: created, tabId: tab.id }, r);
    lastErr = (r && r.msg) || '豆包页脚本没找到输入框';
  } catch (e) {
    lastErr = '豆包页脚本没注入（' + ((e && e.message) || '无响应') + '）';
  }

  /* ② 兜底：直接往豆包页面（含所有子框架）注入填充函数 */
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: doubaoFillInline,
      args: [prompt, payload.send !== false],
    });
    const hit = (res || []).map((x) => x && x.result).find((v) => v && v.ok);
    if (hit) return { ok: true, mode: hit.mode, sent: hit.sent, created: created, tabId: tab.id, via: 'scripting' };
    if (hit && hit.msg) lastErr = hit.msg;
  } catch (e) {
    lastErr = '注入填充失败：' + ((e && e.message) || '未知');
  }

  return { ok: false, created: created, msg: lastErr || '豆包页没响应' };
}


/* 把工作台挤到左半屏，豆包独立窗占右半屏 */
async function openDoubaoWindow() {
  const DOUBAO_URL = 'https://www.doubao.com/chat/';
  const doubaoRe = new RegExp('^https://(www\\.)?doubao\\.com');

  const wins = await chrome.windows.getAll({ populate: true });
  const existing = (wins || []).find((w) =>
    (w.tabs || []).some((t) => doubaoRe.test(t.url || '')));
  if (existing && existing.id != null) {
    await chrome.windows.update(existing.id, { focused: true });
    return { ok: true, existed: true };
  }

  let half = 720;
  let left = null;
  let top = null;
  let height = 820;

  try {
    const last = await chrome.windows.getLastFocused({ populate: false });
    if (last && last.left != null && last.width) {
      half = Math.max(480, Math.floor(last.width / 2));
      left = last.left + last.width - half;
      top = last.top;
      height = last.height;
      // 工作台窗口收窄到左半屏，让两扇门并排
      await chrome.windows.update(last.id, { width: last.width - half, left: last.left });
    }
  } catch (e) { /* 拿不到参考窗口就按默认开 */ }

  await chrome.windows.create({
    url: DOUBAO_URL,
    type: 'popup',
    width: half,
    height: height,
    left: left != null ? left : undefined,
    top: top != null ? top : undefined,
  });
  return { ok: true, existed: false };
}

/* ============================================================
 * 内置应用（studio 沙箱页）的网络反代
 * ------------------------------------------------------------
 * 沙箱页是 opaque origin，直连第三方 API 会被 CORS 挡；
 * 后台有 host_permissions，转一道就能通，还能顺手把
 * 二进制响应（音频/视频）用 base64 带回去。
 * ============================================================ */

function toBase64(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

async function studioFetch(msg) {
  const url = String(msg.url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '只支持 http(s) 请求' };

  const method = String(msg.method || 'GET').toUpperCase();
  const headers = {};
  Object.keys(msg.headers || {}).forEach((k) => {
    // 这几个头由浏览器自己管，手写会被拒绝
    if (/^(host|content-length|connection|origin|referer|user-agent)$/i.test(k)) return;
    headers[k] = msg.headers[k];
  });

  const init = { method, headers };
  if (msg.body != null && method !== 'GET' && method !== 'HEAD') init.body = msg.body;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 220000);
  init.signal = ctrl.signal;

  try {
    const res = await fetch(url, init);
    const buf = await res.arrayBuffer();
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) return;
      outHeaders[k] = v;
    });

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
      bodyB64: toBase64(new Uint8Array(buf)),
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络请求失败' };
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
 * 把标题写进公众号编辑器
 * ------------------------------------------------------------
 * 智录笔记里填好公众号标题后，直接投到正在编辑的那篇文章的标题框。
 * 找不到编辑页就返回失败，让前端提示「先把图文编辑页打开」。
 * ============================================================ */

async function setWxTitleEverywhere(title) {
  const text = String(title || '').trim();
  if (!text) return { ok: false, msg: '标题是空的' };

  const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
  const list = tabs || [];
  if (!list.length) return { ok: false, msg: '没有打开公众号后台，标题已存到编辑台，写入正文时会一起带上' };

  const target = list.find((t) => /appmsg_edit|action=edit/i.test(t.url || '')) || list[0];

  try {
    const r = await chrome.tabs.sendMessage(target.id, { type: 'WG_SET_TITLE', title: text });
    if (r && r.ok) return { ok: true, title: text, tabId: target.id };
    return { ok: false, msg: (r && r.msg) || '标题框没找到：先打开「图文消息」编辑页，或刷新一下页面' };
  } catch (e) {
    /* 扩展重载后旧页面里的内容脚本已经失效，这里是最常见的原因 */
    return { ok: false, msg: '公众号页面还没接上：刷新一下编辑页，再点插入' };
  }
}
