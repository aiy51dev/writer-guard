/* ============================================================
 * Writer Guard · 内置独立应用（智录笔记 / 情绪导演）
 * ------------------------------------------------------------
 * 两个应用是原样的独立 HTML，放在 studio/ 下作为 MV3 沙箱页，
 * 用 iframe 嵌进工作台。沙箱页拿不到 chrome.* API，
 * 所以能力（存储 / 跨域请求 / 下载 / 投递到编辑台）全在这里代劳。
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  if (!WG) return;

  const LS_KEY = 'wg_studio_ls';
  const TAG = '__wgStudio';

  const STUDIOS = {
    zhilu: {
      frame: 'studio-zhilu',
      tip: 'studio-zhilu-tip',
      newBtn: 'studio-zhilu-new',
      reloadBtn: 'studio-zhilu-reload',
      label: '智录笔记',
    },
    emotion: {
      frame: 'studio-emotion',
      tip: 'studio-emotion-tip',
      newBtn: 'studio-emotion-new',
      reloadBtn: 'studio-emotion-reload',
      label: '情绪导演',
    },
  };

  let lsAll = null;          /* { app: { key: value } } */
  let lsLoading = null;
  let writeChain = Promise.resolve();

  function readStore() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([LS_KEY], (res) => {
          resolve((res && res[LS_KEY]) || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  function loadLS() {
    if (lsAll) return Promise.resolve(lsAll);
    if (lsLoading) return lsLoading;
    lsLoading = readStore().then((all) => {
      lsAll = all;
      return lsAll;
    });
    return lsLoading;
  }

  /* ------------------------------------------------------------
   * 写档：每次都以磁盘上的最新副本为基准做合并
   * ------------------------------------------------------------
   * 以前是「读一次缓存 → 整包写回」，页面一多开（侧边栏一个、
   * 公众号页浮层一个）就会拿旧副本把别人刚存的键覆盖掉，
   * 表现就是「关掉再打开，数据全没了」。现在改成
   * 读-合并-写，并用 promise 链把并发写入排队。
   * ------------------------------------------------------------ */

  function writeLS(app, set, del) {
    writeChain = writeChain.then(() => new Promise((resolve) => {
      readStore().then((all) => {
        const box = all[app] || (all[app] = {});
        Object.keys(set || {}).forEach((k) => { box[k] = set[k]; });
        (del || []).forEach((k) => { delete box[k]; });

        try {
          chrome.storage.local.set({ [LS_KEY]: all }, () => {
            const err = chrome.runtime.lastError;
            if (err) {
              const msg = String(err.message || '');
              WG.toast(/quota|QUOTA/i.test(msg)
                ? '存档失败：空间不足，清理一些旧截图/模板再试'
                : '存档失败：' + msg);
            } else {
              lsAll = all;
            }
            resolve();
          });
        } catch (e) {
          WG.toast('存档失败：' + (e.message || '未知错误'));
          resolve();
        }
      });
    }));
  }

  /* ------------------------------------------------------------
   * 懒加载 iframe（带握手看门狗 + 自动重试）
   * ------------------------------------------------------------
   * Edge 下偶尔会先给一页「已阻止/空白」，刷新就好——这属于加载竞态。
   * 这里给每次加载挂一个看门狗：2.5 秒内没收到 WG_READY 就换 URL 重试，
   * 最多 3 次；仍然失败才把「重试 / 新窗口」按钮亮出来。
   * ------------------------------------------------------------ */

  const bridged = {};        /* app -> true 表示已握手 */
  const attempts = {};       /* app -> 第几次 */
  const watchdogs = {};      /* app -> timer */

  function tipOf(name) {
    const cfg = STUDIOS[name];
    return cfg ? document.getElementById(cfg.tip) : null;
  }

  function showTip(name, text, withActions) {
    const tip = tipOf(name);
    if (!tip) return;
    tip.hidden = false;
    tip.style.pointerEvents = withActions ? 'auto' : 'none';
    if (!withActions) {
      tip.textContent = text;
      return;
    }
    tip.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = text;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试';
    retry.className = 'btn btn-sm';
    retry.style.cssText = 'margin-left:10px';
    retry.onclick = () => { attempts[name] = 0; loadFrame(name, true); };
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = '新窗口打开';
    open.className = 'btn btn-sm btn-ghost';
    open.style.cssText = 'margin-left:8px';
    open.onclick = () => {
      window.open(chrome.runtime.getURL('workbench/workbench.html#' + name), '_blank');
    };
    tip.appendChild(label);
    tip.appendChild(retry);
    tip.appendChild(open);
  }

  function hideTip(name) {
    const tip = tipOf(name);
    if (tip) { tip.hidden = true; tip.style.pointerEvents = 'none'; }
  }

  function loadFrame(name, force) {
    const cfg = STUDIOS[name];
    if (!cfg) return;
    const frame = document.getElementById(cfg.frame);
    if (!frame) return;

    const n = (attempts[name] = (attempts[name] || 0) + 1);
    bridged[name] = false;

    showTip(name, n === 1 ? '正在加载' + cfg.label + '…' : '正在重试第 ' + (n - 1) + ' 次…');

    clearTimeout(watchdogs[name]);
    watchdogs[name] = setTimeout(() => {
      if (bridged[name]) return;
      if (n < 3) {
        loadFrame(name, true);
      } else {
        showTip(name, cfg.label + '没有加载成功（浏览器拦了一次），点这里重试：', true);
      }
    }, 2500);

    /* 换 URL 强制绕过上一次的失败缓存 */
    frame.src = frame.dataset.src + (force || n > 1 ? '?r=' + n + '&t=' + Date.now() : '');
  }

  function ensureLoaded(name) {
    const cfg = STUDIOS[name];
    if (!cfg) return;
    const frame = document.getElementById(cfg.frame);
    if (!frame) return;
    if (frame.getAttribute('src')) return;
    loadFrame(name, false);
  }

  function reload(name) {
    attempts[name] = 0;
    loadFrame(name, true);
  }

  /* ------------------------------------------------------------
   * 投递到编辑台 / 检测台
   * ------------------------------------------------------------ */

  /* 智录笔记的截图是 dataURL。以前直接塞进 Markdown，正文变成一坨
   * 几十万字符的「图片代码」，预览也重排到卡死。
   * 现在正文里只有 `![截图](wgimg:key)`，真图存这里：
   *   内存 WG.imgStore（渲染马上要用）+ chrome.storage（刷新后还在） */
  const IMGS_KEY = 'writerImgs';
  const IMG_MAX = 40;                 /* 最多留 40 张 */
  const IMG_BYTES = 18 * 1024 * 1024; /* 总字符上限，别把 storage 写爆 */

  function imgStore() {
    if (!WG.imgStore) WG.imgStore = {};
    return WG.imgStore;
  }

  function loadImgs() {
    try {
      const all = WG.Store.get(IMGS_KEY, null);
      if (all && typeof all === 'object') {
        Object.keys(all).forEach((k) => { imgStore()[k] = all[k]; });
      }
    } catch (e) { /* ignore */ }
    return imgStore();
  }

  function saveImgs(patch) {
    const store = imgStore();
    Object.keys(patch || {}).forEach((k) => { store[k] = patch[k]; });

    /* 代号里带时间戳，按 key 排序就是新旧顺序；超了先丢最旧的 */
    const keys = Object.keys(store).sort();
    let total = keys.reduce((n, k) => n + String(store[k] || '').length, 0);
    while (keys.length > 1 && (keys.length > IMG_MAX || total > IMG_BYTES)) {
      const k = keys.shift();
      total -= String(store[k] || '').length;
      delete store[k];
    }
    try { WG.Store.set(IMGS_KEY, store); } catch (e) { /* 存不下也不影响本次预览 */ }
  }

  function pushToWriter(md, title, imgs) {
    const ta = document.getElementById('wgw-md');
    if (!ta) return;

    const text = String(md || '').trim();
    if (!text) return;

    let n = 0;
    if (imgs && typeof imgs === 'object') {
      n = Object.keys(imgs).length;
      if (n) { loadImgs(); saveImgs(imgs); }
    }

    const cur = (ta.value || '').trim();
    ta.value = cur ? cur.replace(/\s+$/, '') + '\n\n---\n\n' + text : text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    const t = document.getElementById('wgw-title');
    if (t && title && !t.value.trim()) {
      t.value = title;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /* 图片刚入库，预览要按新图重排一次（input 事件的防抖可能早于入库） */
    if (n && WG.writerRefresh) setTimeout(WG.writerRefresh, 60);

    WG.switchView('writer');
    WG.toast((cur ? '已追加到编辑台（' + text.length + ' 字符' : '已放到编辑台，可以继续改')
      + (n ? '，' + n + ' 张截图会按排版显示' : '') + (cur ? '）' : ''));
  }

  /* 把标题写进公众号编辑器的标题框（走后台找到公众号标签页再投递） */
  function setWxTitle(title) {
    const text = String(title || '').trim();
    if (!text) return;

    /* 顺手同步到编辑台的标题栏，避免两边不一致 */
    const t = document.getElementById('wgw-title');
    if (t) {
      t.value = text;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }

    try {
      chrome.runtime.sendMessage({ type: 'WG_SET_WX_TITLE', title: text }, (r) => {
        if (chrome.runtime.lastError) {
          WG.toast('标题已存到编辑台，但没连上公众号后台：' + (chrome.runtime.lastError.message || ''));
          return;
        }
        if (r && r.ok) {
          WG.toast('标题已插入公众号编辑器' + (r.title ? '：' + r.title : ''));
        } else {
          WG.toast((r && r.msg) || '没找到公众号编辑页，标题已存到编辑台，写入时自动带上');
        }
      });
    } catch (e) {
      WG.toast('标题已存到编辑台，写入正文时会一起带上');
    }
  }

  function pushToCompliance(text) {
    const ta = document.getElementById('in-body');
    if (!ta) return;
    ta.value = String(text || '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    WG.switchView('compliance');
    setTimeout(() => {
      const btn = document.getElementById('btn-scan');
      if (btn) btn.click();
    }, 160);
    WG.toast('已送检测台');
  }

  /* ------------------------------------------------------------
   * 下载落盘（沙箱里 a[download] 可能被拦）
   * ------------------------------------------------------------ */

  function saveBlob(d) {
    try {
      const bin = atob(d.bodyB64 || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const blob = new Blob([bytes], { type: d.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.filename || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      WG.toast('已导出 ' + a.download);
    } catch (e) {
      WG.toast('导出失败：' + (e.message || '未知错误'));
    }
  }

  /* ------------------------------------------------------------
   * 跨域请求：转后台（扩展后台有主机权限，不受 CORS 限制）
   * ------------------------------------------------------------ */

  function doFetch(m, win) {
    const back = (payload) => {
      try {
        win.postMessage(Object.assign({ [TAG]: 'PARENT', type: 'WG_FETCH_RES', id: m.id }, payload), '*');
      } catch (e) { /* ignore */ }
    };

    let timer = setTimeout(() => back({ ok: false, error: '后台请求超时' }), 230000);

    try {
      chrome.runtime.sendMessage({
        type: 'WG_STUDIO_FETCH',
        url: m.url,
        method: m.method,
        headers: m.headers,
        body: m.body,
      }, (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          return back({ ok: false, error: chrome.runtime.lastError.message || '后台无响应' });
        }
        if (!r) return back({ ok: false, error: '后台无响应' });
        back(r);
      });
    } catch (e) {
      clearTimeout(timer);
      back({ ok: false, error: e.message || '后台无响应' });
    }
  }

  /* ------------------------------------------------------------
   * 消息桥
   * ------------------------------------------------------------ */

  function frameWindows() {
    return Object.keys(STUDIOS)
      .map((k) => {
        const f = document.getElementById(STUDIOS[k].frame);
        return f && f.contentWindow ? f.contentWindow : null;
      })
      .filter(Boolean);
  }

  function onMessage(e) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    const app = d[TAG];
    if (app !== 'zhilu' && app !== 'emotion') return;

    /* 只认自己家的 iframe */
    const wins = frameWindows();
    if (!wins.length || wins.indexOf(e.source) < 0) return;

    switch (d.type) {
      case 'WG_READY':
        bridged[app] = true;
        attempts[app] = 0;
        clearTimeout(watchdogs[app]);
        hideTip(app);
        /* 握手一律读磁盘最新值，别用可能过期的缓存 */
        readStore().then((all) => {
          lsAll = all;
          try {
            e.source.postMessage({
              [TAG]: 'PARENT',
              type: 'WG_BRIDGE_HELLO',
              ls: all[app] || {},
              /* 团队/工作台里已经配好的 API，内置应用留空时直接拿来用 */
              ai: (WG.Store && WG.Store.get('aiConfig', null)) || null,
            }, '*');
          } catch (err) { /* ignore */ }
        });
        break;

      case 'WG_SET_WX_TITLE':
        setWxTitle(d.title);
        break;

      case 'WG_LS_WRITE':
        writeLS(app, d.set, d.del);
        break;

      case 'WG_FETCH':
        doFetch(d, e.source);
        break;

      case 'WG_DOWNLOAD':
        saveBlob(d);
        break;

      case 'WG_TO_WRITER':
        pushToWriter(d.md, d.title, d.imgs);
        break;

      case 'WG_TO_COMPLIANCE':
        pushToCompliance(d.text);
        break;

      case 'WG_LOG':
        console.warn('[studio:' + app + ']', d.message, d.where || '');
        break;

      default:
        break;
    }
  }

  /* ------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------ */

  /* ------------------------------------------------------------
   * API 配置变更：推给已打开的内置应用，不用重开也能用上
   * ------------------------------------------------------------ */

  function broadcastAI(cfg) {
    const ai = (cfg && cfg.key && cfg.baseUrl && cfg.model) ? cfg : null;
    frameWindows().forEach((w) => {
      try { w.postMessage({ [TAG]: 'PARENT', type: 'WG_AI_CFG', ai: ai }, '*'); } catch (e) { /* ignore */ }
    });
  }

  function initStudio() {
    window.addEventListener('message', onMessage);

    /* 让「设置」页存完 Key 直接广播过来 */
    WG.studioAIChanged = broadcastAI;

    /* 多开时保持同步：另一个编辑台写了档，这边缓存跟着更新 */
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[LS_KEY]) return;
        lsAll = changes[LS_KEY].newValue || {};
      });
    } catch (e) { /* ignore */ }

    /* 懒加载：切到这个视图才载入，避免一开工作台就拉两个大页面 */
    const origSwitch = WG.switchView;
    WG.switchView = function (name) {
      origSwitch(name);
      if (STUDIOS[name]) ensureLoaded(name);
    };

    Object.keys(STUDIOS).forEach((name) => {
      const cfg = STUDIOS[name];

      const nb = document.getElementById(cfg.newBtn);
      if (nb) {
        nb.addEventListener('click', () => {
          window.open(chrome.runtime.getURL('workbench/workbench.html#' + name), '_blank');
        });
      }

      const rb = document.getElementById(cfg.reloadBtn);
      if (rb) rb.addEventListener('click', () => reload(name));
    });

    /* 直接以 #zhilu / #emotion 打开时，路由已经跑过了，补一次 */
    const hash = (location.hash || '').replace('#', '');
    if (STUDIOS[hash]) ensureLoaded(hash);

    /* 预热存储，省得第一个请求等 */
    loadLS();
    /* 上次发过来还没渲染的截图，先装进内存图库 */
    loadImgs();
  }

  WG.initStudio = initStudio;
  WG.Studio = {
    toWriter: pushToWriter,
    toCompliance: pushToCompliance,
    setWxTitle: setWxTitle,
    open: (name) => { WG.switchView(name); ensureLoaded(name); },
    imgs: imgStore,
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
