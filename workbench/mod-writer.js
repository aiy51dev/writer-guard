/* ============================================================
 * Writer Guard · 编辑台
 *
 * 把开源 skill「md-to-wechat」的工作流搬进扩展：
 *   Markdown → 本地排版 → 三种交付方式
 *   ① 复制排版（富文本进剪贴板，粘贴进任何编辑器）
 *   ② 写入公众号编辑器（在已登录的 mp.weixin.qq.com 里直接排版，零配置）
 *   ③ 推送到草稿箱（官方接口，需 AppID/AppSecret + IP 白名单）
 *
 * 与「封面设计」「检测台」互通：
 *   - 封面设计器导出的最后一张图，这里可直接拿来当推送封面
 *   - 一键把正文送去检测台跑红线
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;

  const DOC_KEY = 'writerDoc';
  const DRAFTS_KEY = 'writerDrafts';
  const BIND_KEY = 'wxBind';
  const COVER_KEY = 'coverLast';

  const S = {
    md: '',
    theme: 'ink',
    device: 'phone',
    cover: '',
    coverKind: '',
    _coverDirty: false,
    _coverKeep: '',
    _coverKindKeep: '',
    html: '',
    timer: null,
    saveTimer: null,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function hasChrome() {
    return typeof chrome !== 'undefined' && chrome.tabs;
  }

  /* ============================================================
   * 配置
   * ============================================================ */

  function loadBind() {
    const c = WG.Store.get(BIND_KEY, null);
    return (c && typeof c === 'object') ? c : {};
  }

  function saveBind(patch) {
    const next = Object.assign(loadBind(), patch || {});
    WG.Store.set(BIND_KEY, next);
    renderBindState();
    return next;
  }

  function bindReady() {
    const c = loadBind();
    return !!(c.appId && c.secret);
  }

  function renderBindState() {
    const pill = $('#wgw-bind-state');
    const state = $('#wx-state');
    const c = loadBind();
    const on = !!(c.appId && c.secret);

    [pill, state].forEach((el) => {
      if (!el) return;
      el.textContent = on ? (c.verified ? '已连接' : '已配置') : '未绑定';
      el.className = 'pill ' + (on ? (c.verified ? 'pill-good' : 'pill-warn') : '');
    });

    const tip = $('#wx-msg');
    if (tip && on && !tip.textContent) {
      tip.textContent = c.verified ? '接口可用，可直接推草稿' : '已填写凭据，点「保存并检测」验证一次';
    }
  }

  /* ============================================================
   * 草稿存取
   * ============================================================ */

  function loadDoc() {
    const d = WG.Store.get(DOC_KEY, null);
    if (!d || typeof d !== 'object') return null;
    return d;
  }

  function persistDoc() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => {
      const doc = {
        title: ($('#wgw-title') || {}).value || '',
        author: ($('#wgw-author') || {}).value || '',
        digest: ($('#wgw-digest') || {}).value || '',
        hiddenText: ($('#wgw-hidden') || {}).value || '',
        theme: S.theme,
        md: S.md,
        ts: Date.now(),
      };
      /* 封面可能是 1~2MB 的 dataURL：跟着每次输入写盘会把存储拖卡。
       * 只有封面真的变过（上传/选设计器/填 URL/清除）才把它写进去 */
      if (S._coverDirty) {
        doc.cover = S.cover;
        doc.coverKind = S.coverKind;
        S._coverKeep = S.cover;
        S._coverKindKeep = S.coverKind;
        S._coverDirty = false;
      } else {
        /* 没动过封面也要带上旧值，不然整包覆盖会把封面抹掉 */
        doc.cover = S._coverKeep;
        doc.coverKind = S._coverKindKeep;
      }
      WG.Store.set(DOC_KEY, doc);
    }, 600);
  }

  function drafts() {
    const list = WG.Store.get(DRAFTS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveDraft() {
    const title = (($('#wgw-title') || {}).value || '').trim() ||
      firstHeading(S.md) || '未命名 ' + WG.fmtTime(Date.now());
    if (!S.md.trim()) return WG.toast('正文还是空的');

    const list = drafts();
    const same = list.find((x) => x.title === title);
    if (same) {
      same.md = S.md;
      same.theme = S.theme;
      same.ts = Date.now();
    } else {
      list.unshift({ id: WG.uid('dr'), title: title, md: S.md, theme: S.theme, ts: Date.now() });
    }
    WG.Store.set(DRAFTS_KEY, list.slice(0, 30));
    renderDrafts();
    WG.toast('已存入本地草稿');
  }

  function renderDrafts() {
    const box = $('#wgw-drafts');
    if (!box) return;
    const list = drafts();
    const count = $('#wgw-draft-count');
    if (count) count.textContent = list.length + ' 篇';

    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有草稿。写完点「存入草稿」，下次打开不会丢。</div>';
      return;
    }

    box.innerHTML = list.map((d) => (
      '<div class="wgw-draft" data-id="' + d.id + '">' +
        '<div class="wgw-draft-main">' +
          '<b>' + WG.esc(d.title) + '</b>' +
          '<span>' + WG.esc(WG.fmtTime(d.ts)) + ' · ' + WG.MD2WX.stats(d.md).words + ' 字</span>' +
        '</div>' +
        '<div class="wgw-draft-acts">' +
          '<button class="btn btn-sm" data-act="load">打开</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="del">删</button>' +
        '</div>' +
      '</div>'
    )).join('');
  }

  function firstHeading(md) {
    const m = String(md || '').match(/^\s{0,3}#\s+(.+)$/m);
    return m ? m[1].trim() : '';
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function renderThemes() {
    const box = $('#wgw-themes');
    if (!box) return;
    box.innerHTML = WG.MD2WX.THEMES.map((t) => (
      '<button class="wgw-theme' + (t.id === S.theme ? ' is-on' : '') + '" data-theme="' + t.id + '"' +
        ' title="' + WG.esc(t.desc) + '">' +
        '<span class="wgw-theme-dot" style="background:' + t.accent + '"></span>' +
        '<span class="wgw-theme-name">' + WG.esc(t.name) + '</span>' +
      '</button>'
    )).join('');
  }

  function updateStats() {
    const el = $('#wgw-stats');
    if (!el) return;
    const st = WG.MD2WX.stats(S.md);
    const imgs = (S.md.match(/\]\(\s*wgimg:/g) || []).length;
    el.textContent = st.words + ' 字 · 约 ' + st.minutes + ' 分钟读完' + (imgs ? ' · ' + imgs + ' 张图' : '');
    el.title = imgs
      ? '正文里的 ![截图1](wgimg:...) 只是图片占位，不占空间；排版预览、复制、写入公众号时都会换成真图'
      : '';
  }

  /* ------------------------------------------------------------
   * 智录笔记发过来的截图：正文里只有 `![截图](wgimg:key)` 短代号，
   * 真图在图片库里（内存 WG.imgStore + storage.writerImgs）。
   * 渲染 / 复制 / 写入前把代号换成真图，正文本身保持干净。
   * ------------------------------------------------------------ */

  const IMGS_KEY = 'writerImgs';

  function imgsOf() {
    const mem = (WG.imgStore && typeof WG.imgStore === 'object') ? WG.imgStore : {};
    let disk = null;
    try { disk = WG.Store.get(IMGS_KEY, null); } catch (e) { disk = null; }
    return Object.assign({}, (disk && typeof disk === 'object') ? disk : {}, mem);
  }

  /* 统一出口：任何要出 HTML 的地方都走这里，别再各自 render */
  function renderMd(md) {
    return WG.MD2WX.render(md == null ? S.md : md, { theme: S.theme, imgs: imgsOf() });
  }

  /* 外部（智录笔记投递 / 图库更新）改了图，让预览立刻重排 */
  WG.writerRefresh = function () { renderPreview(true); };

  function renderPreview(force) {
    const paper = $('#wgw-preview');
    if (!paper) return;

    const ta = $('#wgw-md');
    const md = ta ? ta.value : '';

    /* 同一内容 + 同一主题 + 同一设备不重排：
     * 打开页面 / 切页 / 调高度时大量重复调用，这里挡掉就是卡顿的大头 */
    const sig = md + '\u0001' + S.theme + '\u0001' + S.device;
    if (!force && sig === S.renderSig) { S.md = md; return; }
    S.renderSig = sig;
    S.md = md;

    S.html = S.md.trim() ? renderMd() : '';

    paper.innerHTML = S.html || '<div class="wgw-placeholder">左边写 Markdown，这里实时排版。<br>也可以把 .md 文件拖进来。</div>';

    const stage = $('#wgw-stage');
    if (stage) stage.classList.toggle('is-wide', S.device === 'wide');

    fitPhone();
    renderArticleHead();
    updateStats();

    // 标题空着的时候，用正文第一个一级标题兜底
    const titleEl = $('#wgw-title');
    if (titleEl && !titleEl.value.trim()) {
      const h = firstHeading(S.md);
      if (h) titleEl.value = h;
    }

    persistDoc();
  }

  /* 预览区比手机矮时按比例缩小手机壳（zoom 保持内部排版不变），太矮就出滚动条 */
  function fitPhone() {
    const stage = $('#wgw-stage');
    const phone = $('#wgw-phone');
    if (!stage || !phone) return;
    if (S.device !== 'phone') { phone.style.zoom = ''; return; }
    const avail = stage.clientHeight - 24;
    const scale = Math.max(0.55, Math.min(1, avail / 766));
    phone.style.zoom = scale < 0.99 ? scale.toFixed(3) : '';
  }

  /* 手机预览顶部的「标题 / 作者 / 日期」，跟推送草稿用的是同一份数据 */
  function renderArticleHead() {
    const title = (($('#wgw-title') || {}).value || '').trim() || firstHeading(S.md);
    const author = (($('#wgw-author') || {}).value || '').trim() ||
      (loadBind().author || '').trim() || '公众号';

    const tEl = $('#wgw-pv-title');
    if (tEl) tEl.textContent = title || '（还没写标题）';

    const aEl = $('#wgw-pv-author');
    if (aEl) aEl.textContent = author;

    const dEl = $('#wgw-pv-date');
    if (dEl) {
      const d = new Date();
      dEl.textContent = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
  }

  function scheduleRender() {
    clearTimeout(S.timer);
    /* 长文重排慢：输入防抖按篇幅自适应，长稿多等一等，短稿跟手 */
    const ta = $('#wgw-md');
    const len = ta ? ta.value.length : 0;
    S.timer = setTimeout(renderPreview, len > 12000 ? 420 : 220);
  }

  /* ============================================================
   * 工具栏
   * ============================================================ */

  function wrapSelection(before, after, placeholder) {
    const ta = $('#wgw-md');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const picked = ta.value.slice(start, end) || placeholder || '';
    const next = ta.value.slice(0, start) + before + picked + after + ta.value.slice(end);
    ta.value = next;
    ta.focus();
    const caret = start + before.length;
    ta.setSelectionRange(caret, caret + picked.length);
    renderPreview();
  }

  function prefixLines(prefix) {
    const ta = $('#wgw-md');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = ta.value.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = ta.value.length;

    const block = ta.value.slice(lineStart, lineEnd) || '';
    const lines = block.split('\n');
    const out = lines.map((l, i) => {
      if (typeof prefix === 'function') return prefix(l, i);
      return prefix + l;
    }).join('\n');

    ta.value = ta.value.slice(0, lineStart) + out + ta.value.slice(lineEnd);
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + out.length);
    renderPreview();
  }

  function applyTool(kind) {
    const ta = $('#wgw-md');
    if (!ta) return;

    switch (kind) {
      case 'h2': prefixLines('## '); break;
      case 'h3': prefixLines('### '); break;
      case 'bold': wrapSelection('**', '**', '加粗文字'); break;
      case 'green': wrapSelection('==', '==', '关键词'); break;
      case 'purple': wrapSelection('~~', '~~', '长尾词'); break;
      case 'quote': prefixLines('> '); break;
      case 'ul': prefixLines('- '); break;
      case 'ol': prefixLines((l, i) => (i + 1) + '. '); break;
      case 'code': wrapSelection('`', '`', 'code'); break;
      case 'img': wrapSelection('![图注](', ')', 'https://'); break;
      case 'link': wrapSelection('[', '](https://)', '链接文字'); break;
      case 'hr': {
        const start = ta.selectionStart;
        const pre = ta.value.slice(0, start).replace(/\n*$/, '');
        const post = ta.value.slice(start).replace(/^\n*/, '');
        ta.value = pre + (pre ? '\n\n' : '') + '---\n\n' + post;
        ta.focus();
        renderPreview();
        break;
      }
      default: break;
    }
  }

  /* ============================================================
   * 交付方式 ①：复制排版
   * ============================================================ */

  /* btn：可选，传了就在复制成功/失败后临时改按钮文案，给个明确回音 */
  async function copyRich(btn) {
    if (!S.md.trim()) { WG.toast('正文还是空的'); return false; }

    const label = btn ? btn.textContent : '';
    const flash = (text) => {
      if (!btn) return;
      btn.textContent = text;
      btn.disabled = true;
      setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1400);
    };

    const tail = hiddenTailHtml();
    const html = renderMd() + tail;
    const plain = WG.MD2WX.plainText(S.md);

    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
      flash('已复制 ✓');
      WG.toast('排版已复制' + (tail ? '（含隐形字数代码）' : '') + '，去公众号编辑器正文里 Ctrl+V');
      return true;
    } catch (e) { /* 走降级 */ }

    // 降级：选中预览区直接 execCommand('copy')，拷的是带样式的富文本
    try {
      const paper = $('#wgw-preview');
      const range = document.createRange();
      range.selectNodeContents(paper);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      if (ok) {
        flash('已复制 ✓');
        WG.toast('排版已复制，去编辑器正文里 Ctrl+V');
        return true;
      }
    } catch (e) { /* ignore */ }

    WG.toast('复制被浏览器拦了，手动选中右侧预览再 Ctrl+C');
    return false;
  }

  /* ============================================================
   * 交付方式 ②：写入公众号编辑器
   * ============================================================ */

  async function sendToTab(tabId, msg, tries) {
    const n = tries || 10;
    for (let i = 0; i < n; i++) {
      try {
        const r = await chrome.tabs.sendMessage(tabId, msg);
        if (r) return r;
      } catch (e) { /* 内容脚本还没注入，等一下再试 */ }
      await sleep(600);
    }
    return null;
  }

  async function writeToEditor() {
    if (!hasChrome()) return WG.toast('这里不是扩展环境，用「复制排版」吧');
    if (!S.md.trim()) return WG.toast('正文还是空的');

    const btn = $('#wgw-write');
    const setBusy = (on, text) => {
      if (!btn) return;
      btn.disabled = on;
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = on ? text : btn.dataset.label;
    };

    setBusy(true, '正在找公众号页面…');

    try {
      const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
      const editorTab = (tabs || []).find((t) => /appmsg_edit|action=edit/i.test(t.url || ''));

      let tabId = null;

      if (editorTab) {
        tabId = editorTab.id;
        await chrome.tabs.update(tabId, { active: true });
        if (editorTab.windowId != null) chrome.windows.update(editorTab.windowId, { focused: true });
      } else {
        setBusy(true, '正在打开图文编辑页…');
        const r = await new Promise((res) => {
          chrome.runtime.sendMessage({ type: 'WG_WX_OPEN_EDITOR' }, (v) => res(v || {}));
        });
        tabId = r.tabId || null;
        if (!r.ok && r.msg) {
          WG.toast(r.msg);
          setBusy(false);
          return;
        }
        await sleep(1200);
      }

      if (!tabId) { WG.toast('没找到公众号标签页'); setBusy(false); return; }

      setBusy(true, '正在写入编辑器…');

      const title = (($('#wgw-title') || {}).value || '').trim();
      const tail = hiddenTailHtml();
      const r = await sendToTab(tabId, {
        type: 'WG_INSERT_HTML',
        html: renderMd() + tail,
        title: title,
      }, 14);

      if (r && r.ok) {
        WG.toast('已写入公众号编辑器（' + (r.mode === 'paste' ? '模拟粘贴' : r.mode === 'exec' ? '插入命令' : '直接写入') + '）'
          + (tail && r.chars ? ' · 编辑器现计 ' + r.chars + ' 字' : ''));
      } else {
        WG.toast((r && r.msg) || '写入失败：先在编辑页正文里点一下再试');
      }
    } catch (e) {
      WG.toast('写入失败：' + (e.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }

  /* ============================================================
   * 交付方式 ③：推送到草稿箱
   * ============================================================ */

  function resolveCover() {
    if (S.cover) return { cover: S.cover, from: '你选的封面' };
    const mdImg = WG.MD2WX.firstImage(S.md, imgsOf());
    if (mdImg) return { cover: mdImg, from: '正文第一张图' };
    const c = loadBind();
    if (c.cover) return { cover: c.cover, from: '绑定设置里的默认封面' };
    return { cover: '', from: '' };
  }

  async function pushDraft() {
    if (!hasChrome()) return WG.toast('这里不是扩展环境');
    if (!S.md.trim()) return WG.toast('正文还是空的');
    if (!bindReady()) {
      WG.toast('还没绑定公众号：设置 → 公众号绑定，填 AppID / AppSecret');
      return;
    }

    const title = (($('#wgw-title') || {}).value || '').trim();
    if (!title) return WG.toast('先填标题');

    const cv = resolveCover();
    if (!cv.cover) {
      WG.toast('缺少封面图：微信草稿必须带封面，先上传一张或用正文第一张图');
      return;
    }

    const btn = $('#wgw-push');
    const msgEl = $('#wgw-push-msg');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '推送中…'; }
    if (msgEl) msgEl.textContent = '正在上传封面和正文图片，大图会慢一点…';

    try {
      const cfg = loadBind();
      const payload = {
        appId: cfg.appId,
        secret: cfg.secret,
        title: title,
        author: (($('#wgw-author') || {}).value || '').trim() || cfg.author || '',
        digest: (($('#wgw-digest') || {}).value || '').trim() || WG.MD2WX.digest(S.md, 100),
        html: renderMd(),
        cover: cv.cover,
      };

      const r = await new Promise((res) => {
        chrome.runtime.sendMessage({ type: 'WG_WX_PUSH', payload: payload }, (v) => res(v || { ok: false, msg: '后台无响应' }));
      });

      if (r && r.ok) {
        if (msgEl) msgEl.textContent = '✅ 已进草稿箱（media_id ' + String(r.media_id || '').slice(0, 12) + '…）';
        WG.toast('草稿已推送，去公众号后台 → 草稿箱查看');
      } else {
        const info = r && r.code === 40164
          ? 'IP 不在白名单。微信看到的 IP：' + (r.ip || '见提示') + '，把它加到「设置与开发 → 基本配置 → API IP 白名单」'
          : ((r && r.msg) || '推送失败');
        if (msgEl) msgEl.textContent = '❌ ' + info;
        WG.toast('推送失败：' + info);
      }
    } catch (e) {
      if (msgEl) msgEl.textContent = '❌ ' + (e.message || '未知错误');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || '推送草稿箱'; }
    }
  }

  /* ============================================================
   * 封面
   * ============================================================ */

  function renderCover() {
    const box = $('#wgw-cover-preview');
    const state = $('#wgw-cover-state');
    if (!box) return;

    if (!S.cover) {
      box.innerHTML = '<span class="wgw-cover-empty">未选封面</span>';
      if (state) state.textContent = '不选的话，优先用正文第一张图';
      return;
    }

    box.innerHTML = '<img src="' + WG.esc(S.cover) + '" alt="封面">';
    if (state) state.textContent = S.coverKind === 'last' ? '用封面设计器最近导出的那张'
      : S.coverKind === 'upload' ? '本地上传（已压缩到 900px 内）'
      : '网络图片';
  }

  function pickFromDesigner() {
    const last = WG.Store.get(COVER_KEY, null);
    if (!last || !last.url) return WG.toast('封面设计器还没导出过图片：先去「封面设计」做一张并导出');
    S.cover = last.url;
    S.coverKind = 'last';
    S._coverDirty = true;
    renderCover();
    persistDoc();
    WG.toast('已用最近导出的封面');
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxW = 900;
          const scale = Math.min(1, maxW / img.width);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL('image/jpeg', 0.92));
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      img.src = url;
    });
  }

  async function uploadCover(file) {
    if (!file) return;
    try {
      S.cover = await compressImage(file);
      S.coverKind = 'upload';
      S._coverDirty = true;
      renderCover();
      persistDoc();
      WG.toast('封面已就绪');
    } catch (e) {
      WG.toast('封面读取失败：' + e.message);
    }
  }

  /* ============================================================
   * 与检测台互通
   * ============================================================ */

  function sendToScanner() {
    if (!S.md.trim()) return WG.toast('正文还是空的');
    const titleEl = $('#in-title');
    const bodyEl = $('#in-body');
    if (titleEl) titleEl.value = (($('#wgw-title') || {}).value || '').trim();
    if (bodyEl) bodyEl.value = WG.MD2WX.plainText(S.md);
    WG.switchView('compliance');
    try {
      if (typeof WG.runScan === 'function') WG.runScan();
    } catch (e) { /* ignore */ }
    WG.toast('已送进检测台');
  }

  /* ============================================================
   * AI 助手
   * 复用「团队设置 → AI 平台接入」里配置的模型
   * （OpenAI / DeepSeek / GLM / Kimi / 通义 / 豆包 / 自定义兼容接口）
   * 没配 Key 时按钮会引导去设置页。
   * ============================================================ */

  const AI_PROMPTS = {
    titles: {
      temperature: 0.9,
      maxTokens: 500,
      build: (ctx) => ([
        { role: 'system', content: '你是公众号标题高手。要求：信息型标题，具体、有获得感，不用标题党词汇（震惊/绝了/手慢无），不夸大，16-28 字。直接输出 6 个候选标题，一行一个，不要序号、不要解释。' },
        { role: 'user', content: '文章内容要点：\n' + ctx.body },
      ]),
    },
    article: {
      temperature: 0.75,
      maxTokens: 2400,
      build: (ctx) => ([
        { role: 'system', content: '你是公众号写手，输出 Markdown 正文。要求：\n1. 口语化、短段落（1-3 句一段），不写「首先/其次/综上」模板腔；\n2. 关键词用 ==关键词== 标绿底，长尾词用 ~~长尾词~~ 标紫底，加粗用 **星号**；\n3. 适当用小标题（##）和列表组织；\n4. 严禁编造数据、案例、荣誉、奖项和引用来源；没把握的就写模糊表述；\n5. 直接输出正文，不要开场白和解释。' },
        { role: 'user', content: '标题：' + ctx.title + '\n\n要点/素材（可直接使用，也可以按逻辑重组）：\n' + ctx.body },
      ]),
    },
    rewrite: {
      temperature: 0.7,
      maxTokens: 1200,
      build: (ctx) => ([
        { role: 'system', content: '你是公众号编辑。改写用户给的段落：更口语、更有信息量，删掉空话套话，保留事实，保持 Markdown 格式。直接输出改写后的文本，不要解释。' },
        { role: 'user', content: ctx.body },
      ]),
    },
    deai: {
      temperature: 0.7,
      maxTokens: 2600,
      build: (ctx) => ([
        { role: 'system', content: '你是去 AI 味的编辑。把这篇公众号文章改得不像 AI 写的：去掉模板腔（首先/其次/最后/综上/总而言之）、排比堆砌、空洞总结和车轱辘话；句子长短错落，加入口语表达；保留全部事实、结构和 Markdown 语法（包括 ==绿底== 和 ~~紫底~~ 标记）；严禁编造新事实。直接输出全文 Markdown，不要解释。' },
        { role: 'user', content: ctx.body },
      ]),
    },
    digest: {
      temperature: 0.6,
      maxTokens: 200,
      build: (ctx) => ([
        { role: 'system', content: '为公众号文章写摘要：80 字以内，一句话说清文章价值和看点，不堆关键词，不以「本文」开头。直接输出摘要文本。' },
        { role: 'user', content: ctx.body },
      ]),
    },
  };

  function aiReady() {
    return typeof WG.AI !== 'undefined' && WG.AI.isReady();
  }

  /* 点 Markdown 卡头的绿点：直接跳到「团队设置 → AI 平台接入」 */
  function openAiSettings() {
    WG.switchView('settings');
    setTimeout(() => {
      const card = document.getElementById('card-ai');
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('is-flash');
      setTimeout(() => card.classList.remove('is-flash'), 1700);
    }, 80);
  }

  /* ------------------------------------------------------------
   * AI 结果区：默认收在「起标题」后面的小三角里
   *   · 有内容才显示三角
   *   · ▾ 展开 / ▸ 收起，点候选标题用完自动收起
   * ------------------------------------------------------------ */

  function aiToggleEl() {
    return $('#wgw-ai-toggle');
  }

  function syncAiToggle() {
    const out = $('#wgw-ai-out');
    const tg = aiToggleEl();
    if (!tg) return;
    const has = !!(out && out.innerHTML.trim());
    const open = has && out.classList.contains('is-open');
    tg.hidden = !has;
    tg.classList.toggle('is-on', open);
    tg.textContent = open ? '▾' : '▸';
    tg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setAiOut(html, open) {
    const out = $('#wgw-ai-out');
    if (!out) return;
    out.innerHTML = html || '';
    out.classList.toggle('is-open', !!html && !!open);
    syncAiToggle();
  }

  function toggleAiOut(force) {
    const out = $('#wgw-ai-out');
    if (!out || !out.innerHTML.trim()) {
      WG.toast('还没有 AI 结果：先点「起标题」等它出 6 个');
      return;
    }
    const open = force == null ? !out.classList.contains('is-open') : !!force;
    out.classList.toggle('is-open', open);
    syncAiToggle();
  }

  function renderAiIdle() {
    const state = $('#wgw-ai-state');
    const dot = $('#wgw-ai-dot');
    const ready = aiReady();

    if (state) state.textContent = ready ? '' : '未接 API · 点按钮直接走豆包';
    if (dot) {
      dot.classList.toggle('is-on', ready);
      dot.title = ready ? 'AI 已连接 · 点击查看配置' : 'AI 未配置 · 点击去配置（不配也能用：按钮会把提示词推给豆包）';
    }
    setAiOut('', false);
  }

  function aiOutLoading(text) {
    setAiOut('<span class="wgw-ai-loading">' + WG.esc(text || 'AI 正在写…') + '</span>', true);
  }

  function aiOutClear() {
    setAiOut('', false);
    renderAiIdle();
  }

  function parseTitles(text) {
    return String(text || '').split('\n')
      .map((l) => l.trim())
      .map((l) => l.replace(/^\d+[.、)）]\s*/, '').replace(/^[-*]\s*/, ''))
      .filter((l) => l.length > 3 && l.length < 60)
      .slice(0, 6);
  }

  /* ------------------------------------------------------------
   * 没接 API 时的兜底：把整段提示词推给豆包对话框
   * ------------------------------------------------------------
   * 用户只需要点「起标题 / 写正文 / 降 AI 味」，提示词自动带着
   * 正文内容落到豆包输入框并发送；豆包写完，选中回答点
   * 「→ 编辑台」就能回填。不配 Key 也能干活。
   * ------------------------------------------------------------ */

  const AI_ACTION = {
    titles: '起标题', article: '写正文', rewrite: '改写这段', deai: '降 AI 味', digest: '写摘要',
  };

  function doubaoPrompt(kind, ctx) {
    const spec = AI_PROMPTS[kind];
    const msgs = (spec && spec.build(ctx)) || [];
    const pick = (role) => {
      const m = msgs.find((x) => x.role === role);
      return (m && m.content) || '';
    };
    const sys = pick('system');
    const user = pick('user');
    const head = '帮我给这篇公众号文章' + (AI_ACTION[kind] || '处理') + '。\n\n'
      + (sys ? '写作要求：\n' + sys + '\n\n' : '');
    return head + user;
  }

  function askBackground(payload) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(payload, (r) => {
          const err = chrome.runtime.lastError;
          if (err) return res({ ok: false, msg: err.message || '后台无响应' });
          res(r || { ok: false, msg: '后台无响应' });
        });
      } catch (e) {
        res({ ok: false, msg: e.message || '后台无响应' });
      }
    });
  }

  async function pushToDoubao(kind, ctx) {
    const prompt = doubaoPrompt(kind, ctx);
    const state = $('#wgw-ai-state');
    const setState = (t) => { if (state) state.textContent = t || ''; };

    setState('正在推给右侧豆包…');

    /* 只走工作台右侧的豆包侧窗（和「技能面板」点一下填进对话框是同一条管线）。
     * 不会再开网页版豆包、也不会把当前标签页切走。 */
    let r = null;
    if (WG.doubaoDock && typeof WG.doubaoDock.push === 'function') {
      r = await Promise.race([
        WG.doubaoDock.push(prompt, { send: true }),
        new Promise((res) => setTimeout(() => res({ ok: false, timeout: true, msg: '侧窗 28 秒没回音' }), 28000)),
      ]);
    } else {
      r = { ok: false, msg: '豆包侧窗没加载起来' };
    }
    setState('');

    if (r && r.ok) {
      WG.toast(r.sent
        ? '已发到右侧豆包，等它写完（选中回答点「→ 编辑台」回填）'
        : '提示词已填进右侧豆包输入框，按回车发送');
      setAiOut('<span class="wgw-ai-hint">已推到右侧豆包面板。豆包那边写好后，选中它给的'
        + (kind === 'titles' ? '标题' : kind === 'digest' ? '摘要' : '正文')
        + '，点浮出的「→ 编辑台」就能直接回填。</span>', true);
      return true;
    }

    /* 侧窗彻底不可用时的兜底：用户点了才在右侧开一个豆包小窗（不是全屏网页版） */
    S._lastPrompt = prompt;

    /* 侧窗没就绪：不偷偷开网页版，把原因说清楚，给一个「你说开才开」的小窗入口 */
    const why = (r && r.msg) || '未知原因';
    WG.copy(prompt);
    WG.toast('侧窗豆包没就绪（' + why + '）。提示词已复制，也可以点下面的「小窗豆包」');
    setAiOut('<span class="wgw-ai-hint">右侧豆包没就绪：' + WG.esc(why) + '。'
      + '提示词已复制到剪贴板；如果侧窗一直白屏（没登录 / 被浏览器拦），可以</span>'
      + '<button class="btn btn-sm" data-act="doubao-popup" style="margin-left:6px">在右侧小窗打开豆包</button>', true);
    return false;
  }

  /* 用户主动点的兜底：在屏幕右侧开一个 420 宽的豆包小窗（popup，无地址栏，不抢全屏），
   * 然后把提示词填进去。不点就永远不弹。 */
  async function openDoubaoPopup() {
    const prompt = S._lastPrompt || '';
    if (!prompt) return WG.toast('先点一次上面的 AI 按钮，才有提示词');
    WG.toast('正在右侧打开豆包小窗…');
    const r = await askBackground({ type: 'WG_DOUBAO_ASK', prompt: prompt, send: true, popup: true });
    if (r && r.ok) {
      WG.toast(r.sent ? '已发到右侧豆包小窗，等它写完' : '提示词已填进豆包小窗，按回车发送');
    } else {
      WG.toast('小窗没打开：' + ((r && r.msg) || '未知原因') + '（提示词还在剪贴板里）');
    }
  }

  async function aiRun(kind) {
    const ta = $('#wgw-md');
    const md = ta ? ta.value : '';
    const title = (($('#wgw-title') || {}).value || '').trim();

    if (kind === 'article' && !title && !md.trim()) {
      return WG.toast('先写个标题或几行要点，AI 才有得发挥');
    }
    if (kind !== 'article' && kind !== 'titles' && !md.trim()) {
      return WG.toast('正文还是空的');
    }
    if (kind === 'rewrite') {
      const sel = md.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (!sel) return WG.toast('先在正文里选中一段再点改写');
    }

    const ctx = {
      title: title || firstHeading(md) || '未定标题',
      body: kind === 'article'
        ? (md.trim() || '（还没有素材，按标题自由发挥，控制在 900 字左右）')
        : md.slice(0, 6000),
    };
    if (kind === 'rewrite') {
      ctx.body = md.slice(ta.selectionStart, ta.selectionEnd);
    }

    /* 没配 API → 推给豆包对话，而不是弹一句「去配置」就完事 */
    if (!aiReady()) {
      await pushToDoubao(kind, ctx);
      return;
    }

    const spec = AI_PROMPTS[kind];
    const state = $('#wgw-ai-state');
    const busyLabel = { titles: '起标题中…', article: '写正文中…', rewrite: '改写中…', deai: '降 AI 味中…', digest: '生成摘要中…' }[kind] || '处理中…';
    if (state) state.textContent = busyLabel;
    aiOutLoading(busyLabel + ' 大稿子会等十几秒');

    try {
      const reply = await WG.AI.chat(spec.build(ctx), {
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        timeout: 90000,
      });

      if (kind === 'titles') {
        const list = parseTitles(reply);
        if (!list.length) throw new Error('没解析出候选标题，换个说法再试');
        setAiOut('<div class="wgw-ai-titles">' + list.map((t) => (
          '<button class="wgw-ai-title" data-title="' + WG.esc(t) + '">' + WG.esc(t) + '</button>'
        )).join('') + '</div>', true);
        WG.toast('出 ' + list.length + ' 个候选标题，点一个直接用');
      } else if (kind === 'digest') {
        const el = $('#wgw-digest');
        if (el) el.value = reply.replace(/^["「]|["」]$/g, '').trim();
        aiOutClear();
        persistDoc();
        WG.toast('摘要已填好');
      } else if (kind === 'article') {
        if (!confirm('用 AI 生成的正文替换当前编辑区内容？')) { aiOutClear(); return; }
        ta.value = reply.trim();
        const h = firstHeading(reply);
        if (h && $('#wgw-title') && !$('#wgw-title').value.trim()) $('#wgw-title').value = h;
        renderPreview();
        aiOutClear();
        WG.toast('正文已生成，记得过一遍事实');
      } else if (kind === 'deai') {
        if (!confirm('用降过 AI 味的全文替换当前编辑区内容？（原文在本地草稿里可先存一份）')) { aiOutClear(); return; }
        ta.value = reply.trim();
        renderPreview();
        aiOutClear();
        WG.toast('已降 AI 味');
      } else if (kind === 'rewrite') {
        ta.value = md.slice(0, ta.selectionStart) + reply.trim() + md.slice(ta.selectionEnd);
        renderPreview();
        aiOutClear();
        WG.toast('选中的段落已改写');
      }

      if (state) state.textContent = '';
    } catch (e) {
      setAiOut('<span class="wgw-ai-err">❌ ' + WG.esc(e.message || 'AI 调用失败') + '</span>', true);
      if (state) state.textContent = '';
    }
  }

  function initAiBar() {
    const bar = $('#wgw-aibar');
    if (!bar) return;
    renderAiIdle();

    // 卡头绿点：AI 状态 + 一键去配置
    const dot = $('#wgw-ai-dot');
    if (dot) {
      renderAiIdle();
      dot.addEventListener('click', () => {
        openAiSettings();
        WG.toast(aiReady() ? 'AI 已连接，可在这里更换平台或 Key' : '在这里填 API Key，支持豆包 / DeepSeek / GLM / Kimi / 通义');
      });
    }

    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ai]');
      if (b) aiRun(b.dataset.ai);
    });

    /* 「起标题」后面那个小三角：展开 / 收起候选标题，不占编辑区 */
    const tg = aiToggleEl();
    if (tg) tg.addEventListener('click', () => toggleAiOut());

    const out = $('#wgw-ai-out');
    if (out) {
      out.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="doubao-popup"]')) { openDoubaoPopup(); return; }
        const t = e.target.closest('.wgw-ai-title');
        if (t) {
          const el = $('#wgw-title');
          if (el) el.value = t.dataset.title;
          persistDoc();
          /* 选完就收起来，把正文让出来 */
          toggleAiOut(false);
          WG.toast('标题已用：' + t.dataset.title);
        }
      });
    }
  }

  /* ============================================================
   * 隐形字数
   *
   * 用户只粘贴纯文本；点「确定」时才包成隐形代码：
   *   - 插进公众号正文末尾（编辑器计入字数，读者不可见）
   *   - 富文本复制进剪贴板，手动粘也一样
   * 代码按 135 编辑器同款思路生成：font-size:0，再加透明色兜底。
   * ============================================================ */

  function hiddenCount(text) {
    return String(text || '').replace(/\s/g, '').length;
  }

  function buildHiddenHtml(text) {
    /* 注意：不能再用 height:0 + overflow:hidden 包着。
     * 公众号编辑器（ProseMirror）里，零高溢出裁剪块会把光标卡死，
     * 插完之后光标落不进后面的内容，整段都没法编辑。
     * 改成 font-size:0 撑出零高度（视觉同样是 0px），
     * 并在后面补一个空段落，保证光标有地方落、回车能换行。 */
    return '<section data-role="outer" style="margin:0;padding:0;line-height:0;font-size:0;">' +
      '<span style="font-size:0;line-height:0;color:transparent;opacity:0;">' + WG.esc(text) + '</span>' +
      '</section>' +
      '<p><br></p>';
  }
  WG.buildHiddenHtml = buildHiddenHtml;   /* 测试用 */

  /* 隐形字数开关了就跟着正文一起走：复制 / 写入编辑器都带 */
  function hiddenTailHtml() {
    const raw = (($('#wgw-hidden') || {}).value || '').trim();
    return raw ? buildHiddenHtml(raw) : '';
  }

  function renderHiddenCount() {
    const ta = $('#wgw-hidden');
    const el = $('#wgw-hidden-count');
    if (!ta || !el) return;
    const n = hiddenCount(ta.value);
    el.textContent = n
      ? n + ' 字 · 读者看不到，编辑器会计入字数'
      : '读者看不到，但编辑器会计入字数';
  }

  async function hiddenApply() {
    const ta = $('#wgw-hidden');
    const raw = ((ta || {}).value || '').trim();
    const n = hiddenCount(raw);
    if (!n) return WG.toast('先粘贴要隐藏的文字');

    const html = buildHiddenHtml(raw);
    const stateEl = $('#wgw-hidden-state');
    const set = (t) => { if (stateEl) stateEl.textContent = t; };

    /* ① 复制：富文本优先（粘进编辑器就是隐形代码），失败退纯文本源码 */
    let copied = '';
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      copied = '已复制，手动粘贴也可用';
    } catch (e) {
      try {
        await navigator.clipboard.writeText(html);
        copied = '已复制 HTML 源码，可粘进公众号编辑器';
      } catch (e2) { copied = ''; }
    }

    /* ② 插入公众号编辑器正文末尾 */
    if (!hasChrome()) {
      set(copied ? copied + ' · 当前不是扩展环境，只能复制' : '复制失败，浏览器没给剪贴板权限');
      return WG.toast(copied ? '已复制' : '复制失败');
    }

    const btn = $('#wgw-hidden-go');
    const setBusy = (on, text) => {
      if (!btn) return;
      btn.disabled = on;
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = on ? text : btn.dataset.label;
    };

    setBusy(true, '正在找公众号页面…');
    try {
      const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
      const editorTab = (tabs || []).find((t) => /appmsg_edit|action=edit/i.test(t.url || ''));

      let tabId = editorTab ? editorTab.id : null;
      if (!tabId) {
        const r = await new Promise((res) => {
          chrome.runtime.sendMessage({ type: 'WG_WX_OPEN_EDITOR' }, (v) => res(v || {}));
        });
        tabId = r.tabId || null;
        if (!r.ok && r.msg) {
          WG.toast(r.msg + (copied ? '；' + copied : ''));
          set('没打开编辑页' + (copied ? ' · ' + copied : ''));
          return;
        }
        await sleep(1200);
      }

      if (!tabId) {
        WG.toast('没找到公众号标签页' + (copied ? '；' + copied : ''));
        return;
      }

      setBusy(true, '正在写入…');
      const r = await sendToTab(tabId, { type: 'WG_INSERT_HTML', html: html, plain: raw, title: '' });

      if (r && r.ok) {
        const done = '已追加到正文末尾 · 隐形 ' + n + ' 字'
          + (r.chars ? ' · 编辑器现计 ' + r.chars + ' 字' : '')
          + (r.mode === 'clipboard' ? '（剪贴板兜底）' : '')
          + (copied ? ' · ' + copied : '');
        set(done);
        WG.toast('隐形文字已插入，去编辑器看字数有没有 +' + n);
      } else {
        const why = r && r.msg ? r.msg : '编辑页没响应';
        set('插入失败：' + why + (copied ? ' · ' + copied : ''));
        WG.toast('插入失败：' + why);
      }
    } finally {
      setBusy(false);
    }
  }

  /* ============================================================
   * 初始化
   * ============================================================ */

  function initWriter() {
    if (typeof WG.MD2WX === 'undefined') {
      console.error('[WG] 排版引擎没加载');
      return;
    }

    const doc = loadDoc();
    if (doc) {
      if ($('#wgw-title')) $('#wgw-title').value = doc.title || '';
      if ($('#wgw-author')) $('#wgw-author').value = doc.author || '';
      if ($('#wgw-digest')) $('#wgw-digest').value = doc.digest || '';
      if ($('#wgw-hidden')) $('#wgw-hidden').value = doc.hiddenText || '';
      S.md = doc.md || '';
      S.theme = doc.theme || 'ink';
      S.cover = doc.cover || '';
      S._coverKeep = S.cover;
      S._coverKindKeep = doc.coverKind || '';
      S.coverKind = doc.coverKind || '';
      if ($('#wgw-md')) $('#wgw-md').value = S.md;
    } else if ($('#wgw-md') && !$('#wgw-md').value) {
      $('#wgw-md').value = [
        '## 在这里写正文',
        '',
        '把 `==关键词==` 标成绿底，把 `~~长尾词~~` 标成紫底，这两个写法和你公众号助手的语法一致。',
        '',
        '- 支持标题、列表、引用、表格、代码块',
        '- 图片用 `![图注](https://...)`，图注会自动居中显示',
        '',
        '> 右边是真实排版效果，换主题会实时重排。',
      ].join('\n');
      S.md = $('#wgw-md').value;
    }

    renderThemes();
    renderDrafts();
    renderCover();
    renderBindState();
    renderPreview();
    initAiBar();

    const md = $('#wgw-md');
    if (md) {
      md.addEventListener('input', scheduleRender);
      md.addEventListener('paste', () => setTimeout(scheduleRender, 30));

      // 拖 .md 进来
      md.addEventListener('dragover', (e) => { e.preventDefault(); md.classList.add('is-drop'); });
      md.addEventListener('dragleave', () => md.classList.remove('is-drop'));
      md.addEventListener('drop', async (e) => {
        e.preventDefault();
        md.classList.remove('is-drop');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        if (!/\.(md|markdown|txt)$/i.test(f.name)) return WG.toast('只认 .md / .markdown / .txt');
        md.value = await f.text();
        renderPreview();
        WG.toast('已载入 ' + f.name);
      });
    }

    ['wgw-title', 'wgw-author', 'wgw-digest'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          persistDoc();
          if (id !== 'wgw-digest') renderArticleHead();
        });
      }
    });

    // 隐形字数
    renderHiddenCount();
    const hiddenTa = $('#wgw-hidden');
    if (hiddenTa) {
      hiddenTa.addEventListener('input', () => {
        renderHiddenCount();
        persistDoc();
      });
    }
    const hiddenGo = $('#wgw-hidden-go');
    if (hiddenGo) hiddenGo.addEventListener('click', hiddenApply);
    const hiddenClear = $('#wgw-hidden-clear');
    if (hiddenClear) {
      hiddenClear.addEventListener('click', () => {
        const ta = $('#wgw-hidden');
        if (ta) ta.value = '';
        renderHiddenCount();
        persistDoc();
        WG.toast('已清空');
      });
    }

    /* 豆包「→ 编辑台」回填：后台把选中的回答写进 wg_writer_inbox */
    let inboxTs = 0;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.wg_writer_inbox) return;
        const v = changes.wg_writer_inbox.newValue;
        if (!v || !v.text || v.ts === inboxTs) return;
        inboxTs = v.ts;
        const box = $('#wgw-md');
        if (!box) return;
        box.value = box.value ? box.value.replace(/\s*$/, '') + '\n\n' + v.text : v.text;
        renderPreview();
        WG.toast('豆包内容已回填编辑台');
      });
    } catch (e) { /* 非扩展环境 */ }

    const tools = $('#wgw-tools');
    if (tools) {
      tools.addEventListener('click', (e) => {
        const b = e.target.closest('[data-md]');
        if (b) applyTool(b.dataset.md);
      });
    }

    const themes = $('#wgw-themes');
    if (themes) {
      themes.addEventListener('click', (e) => {
        const b = e.target.closest('[data-theme]');
        if (!b) return;
        S.theme = b.dataset.theme;
        renderThemes();
        renderPreview();
      });
    }

    const devPhone = $('#wgw-dev-phone');
    const devWide = $('#wgw-dev-wide');
    const setDevice = (d) => {
      S.device = d;
      if (devPhone) devPhone.classList.toggle('is-on', d === 'phone');
      if (devWide) devWide.classList.toggle('is-on', d === 'wide');
      renderPreview();
    };
    if (devPhone) devPhone.addEventListener('click', () => setDevice('phone'));
    if (devWide) devWide.addEventListener('click', () => setDevice('wide'));
    setDevice(S.device);
    window.addEventListener('resize', fitPhone);

    // 导入 .md
    const importBtn = $('#wgw-import');
    const fileInput = $('#wgw-file');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        const text = await f.text();
        const ta = $('#wgw-md');
        if (ta) ta.value = text;
        const h = firstHeading(text);
        if (h && $('#wgw-title') && !$('#wgw-title').value.trim()) $('#wgw-title').value = h;
        renderPreview();
        WG.toast('已导入 ' + f.name);
        fileInput.value = '';
      });
    }

    const clearBtn = $('#wgw-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('清空正文？本地草稿里如果存过，还能找回。')) return;
        const ta = $('#wgw-md');
        if (ta) ta.value = '';
        const t = $('#wgw-title');
        if (t) t.value = '';
        renderPreview();
      });
    }

    // 编辑区高度：默认「自定义」（滑杆记住的 px 直接生效），
    // 按钮 cycle 标准 → 加高 → 占满 → 自定义；选择和 px 都持久化
    const H_KEY = 'writerPaneH';
    const H_PX_KEY = 'writerPaneHPx';
    const H_MODES = ['std', 'tall', 'max', 'custom'];
    const H_LABEL = { std: '高度·标准', tall: '高度·加高', max: '高度·占满', custom: '高度·自定义' };
    const hSplit = document.querySelector('.wgw-split');
    const hBtn = $('#wgw-height');
    const hPop = $('#wgw-hpop');
    const hRange = $('#wgw-hrange');
    const hVal = $('#wgw-hval');
    let paneH = 'custom';     /* 没存过档就用自定义 */
    let paneHPx = 900;
    try {
      const saved = WG.Store.get(H_KEY, 'custom');
      if (H_MODES.indexOf(saved) >= 0) paneH = saved;
      const savedPx = Number(WG.Store.get(H_PX_KEY, 900));
      if (savedPx >= 560 && savedPx <= 1200) paneHPx = savedPx;
    } catch (e) { /* 默认档 */ }

    function applyPaneH() {
      if (hSplit) {
        hSplit.classList.remove('h-tall', 'h-max', 'h-custom');
        if (paneH === 'tall' || paneH === 'max') hSplit.classList.add('h-' + paneH);
        if (paneH === 'custom') {
          hSplit.classList.add('h-custom');
          hSplit.style.setProperty('--wgw-pane-h', paneHPx + 'px');
        }
      }
      if (hVal) hVal.textContent = paneHPx;
      if (hRange) hRange.value = paneHPx;
      if (hBtn) hBtn.textContent = H_LABEL[paneH];
      /* 滑杆弹层只在用户主动切到自定义时弹出，加载页面不弹 */
      // 预览缩放依赖容器高度，档位变了要重算
      if (typeof fitPhone === 'function') fitPhone();
    }

    if (hBtn) {
      hBtn.addEventListener('click', () => {
        paneH = H_MODES[(H_MODES.indexOf(paneH) + 1) % H_MODES.length];
        try { WG.Store.set(H_KEY, paneH); } catch (e) { /* 存不上也无妨 */ }
        applyPaneH();
        if (hPop) hPop.hidden = paneH !== 'custom';
      });
    }
    if (hRange) {
      hRange.addEventListener('input', () => {
        paneHPx = Number(hRange.value) || 900;
        if (hVal) hVal.textContent = paneHPx;
        if (hSplit) hSplit.style.setProperty('--wgw-pane-h', paneHPx + 'px');
        if (typeof fitPhone === 'function') fitPhone();
        try { WG.Store.set(H_PX_KEY, paneHPx); } catch (e) { /* ignore */ }
        /* 拖滑杆 = 在用自定义档：把档位也切过去并存档，
         * 不然刷新后还停在标准档，自定义高度就"丢了" */
        if (paneH !== 'custom') {
          paneH = 'custom';
          if (hSplit) { hSplit.classList.add('h-custom'); hSplit.classList.remove('h-tall', 'h-max'); }
          if (hBtn) hBtn.textContent = H_LABEL.custom;
          try { WG.Store.set(H_KEY, 'custom'); } catch (e) { /* ignore */ }
        }
      });
    }
    const hDone = $('#wgw-hdone');
    if (hDone) hDone.addEventListener('click', () => { if (hPop) hPop.hidden = true; });
    applyPaneH();

    const copyBtn = $('#wgw-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => { copyRich(copyBtn); });

    /* 排版预览表头的「复制」：就在「写入编辑器」前面，
     * 不用切公众号标签页、也不会碰标题栏，粘进正文最稳 */
    const copyTop = $('#wgw-copy-top');
    if (copyTop) copyTop.addEventListener('click', () => { copyRich(copyTop); });

    const writeBtn = $('#wgw-write');
    if (writeBtn) writeBtn.addEventListener('click', writeToEditor);

    const pushBtn = $('#wgw-push');
    if (pushBtn) pushBtn.addEventListener('click', pushDraft);

    const scanBtn = $('#wgw-scan');
    if (scanBtn) scanBtn.addEventListener('click', sendToScanner);

    const saveBtn = $('#wgw-save');
    if (saveBtn) saveBtn.addEventListener('click', saveDraft);

    // 封面
    const coverPick = $('#wgw-cover-pick');
    const coverFile = $('#wgw-cover-file');
    if (coverPick && coverFile) {
      coverPick.addEventListener('click', () => coverFile.click());
      coverFile.addEventListener('change', () => {
        uploadCover(coverFile.files && coverFile.files[0]);
        coverFile.value = '';
      });
    }

    const lastBtn = $('#wgw-cover-last');
    if (lastBtn) lastBtn.addEventListener('click', pickFromDesigner);

    const coverUrl = $('#wgw-cover-url');
    if (coverUrl) {
      coverUrl.addEventListener('change', () => {
        const v = coverUrl.value.trim();
        if (!v) return;
        S.cover = v;
        S.coverKind = 'url';
        S._coverDirty = true;
        renderCover();
        persistDoc();
      });
    }

    const coverClear = $('#wgw-cover-clear');
    if (coverClear) {
      coverClear.addEventListener('click', () => {
        S.cover = '';
        S.coverKind = '';
        S._coverDirty = true;
        if (coverUrl) coverUrl.value = '';
        renderCover();
        persistDoc();
      });
    }

    // 草稿列表
    const draftBox = $('#wgw-drafts');
    if (draftBox) {
      draftBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const row = btn.closest('.wgw-draft');
        const id = row && row.dataset.id;
        const list = drafts();
        const item = list.find((x) => x.id === id);
        if (!item) return;

        if (btn.dataset.act === 'load') {
          const ta = $('#wgw-md');
          if (ta) ta.value = item.md;
          if ($('#wgw-title')) $('#wgw-title').value = item.title;
          S.theme = item.theme || S.theme;
          renderThemes();
          renderPreview();
          WG.toast('已打开草稿');
        } else if (btn.dataset.act === 'del') {
          WG.Store.set(DRAFTS_KEY, list.filter((x) => x.id !== id));
          renderDrafts();
          WG.toast('已删除');
        }
      });
    }

    initBind();
  }

  /* ============================================================
   * 设置页：公众号绑定
   * ============================================================ */

  function initBind() {
    const appId = $('#wx-appid');
    const secret = $('#wx-secret');
    const author = $('#wx-author');
    const cover = $('#wx-cover');
    if (!appId) return;

    const c = loadBind();
    appId.value = c.appId || '';
    if (secret) secret.value = c.secret || '';
    if (author) author.value = c.author || '';
    if (cover) cover.value = c.cover || '';

    const msg = (t) => { const el = $('#wx-msg'); if (el) el.textContent = t; };

    const saveBtn = $('#wx-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const cfg = saveBind({
          appId: appId.value.trim(),
          secret: secret ? secret.value.trim() : '',
          author: author ? author.value.trim() : '',
          cover: cover ? cover.value.trim() : '',
        });

        if (!cfg.appId || !cfg.secret) { msg('AppID / AppSecret 还没填完'); return; }
        msg('正在验证…');

        const r = await new Promise((res) => {
          chrome.runtime.sendMessage({ type: 'WG_WX_TEST' }, (v) => res(v || { ok: false, msg: '后台无响应' }));
        });

        saveBind({ verified: !!r.ok, lastMsg: r.msg || '' });
        if (r.ok) {
          msg('✅ 接口连通，可以推草稿了');
          WG.toast('公众号已绑定');
        } else if (r.code === 40164) {
          msg('⚠️ IP 不在白名单，微信看到的 IP：' + (r.ip || '见提示'));
        } else {
          msg('❌ ' + (r.msg || '验证失败'));
        }
      });
    }

    const ipBtn = $('#wx-ip');
    if (ipBtn) {
      ipBtn.addEventListener('click', async () => {
        msg('正在查询…');
        const r = await new Promise((res) => {
          chrome.runtime.sendMessage({ type: 'WG_WX_IP' }, (v) => res(v || {}));
        });
        msg(r.ip ? '本机公网 IP：' + r.ip + '（加到公众号后台的 API IP 白名单）' : '查询失败，检查网络');
      });
    }
  }

  WG.initWriter = initWriter;

})(typeof globalThis !== 'undefined' ? globalThis : this);
