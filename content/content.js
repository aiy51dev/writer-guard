/* ============================================================
 * Writer Guard · 注入脚本
 * 在公众号图文编辑页实时检测正文与标题，给出阻断级提示。
 * 只读检测，不改动编辑器 DOM，避免干扰发布流程。
 * ============================================================ */
(function () {
  'use strict';

  if (window.__WG_CONTENT_LOADED__) return;
  window.__WG_CONTENT_LOADED__ = true;

  const DICT = window.WG_DICT || {};
  const state = {
    open: false,
    lastReport: null,
    timer: null,
    editor: null,
    categories: [],
    aiFixBackup: null,
  };

  /* ---------- 编辑器定位 ---------- */

  /* 正文编辑器的「高分」选择器：命中就基本确定是正文 */
  const BODY_SELECTORS = [
    '.ProseMirror[contenteditable="true"]',
    '.ProseMirror',
    '#js_editor [contenteditable="true"]',
    '.edui-body-container',
    '.rich_media_content',
    '[data-editor] [contenteditable="true"]',
    'body[contenteditable="true"]',
    '[contenteditable="true"]',
  ];

  /* 标题 / 摘要 / 作者这些「短字段」永远不能当正文。
   * 之前写入跑到标题栏，就是空正文时按「文字最多」排序把标题选走了。 */
  const FIELD_SELECTORS = [
    '#js_title',
    '.js_title',
    '.title_input',
    '.appmsg_title',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="摘要"]',
    'input[placeholder*="摘要"]',
    'textarea[placeholder*="作者"]',
    'input[placeholder*="作者"]',
  ];

  const TITLE_SELECTORS = FIELD_SELECTORS.concat([
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
  ]);

  function isFieldEl(el) {
    if (!el || el.nodeType !== 1) return false;
    for (const sel of FIELD_SELECTORS) {
      try {
        if (el.matches(sel)) return true;
        const near = el.closest(sel);
        if (near) return true;
      } catch (e) { /* 老内核不支持 matches/closest 也没关系 */ }
    }
    return false;
  }

  function textLen(el) {
    try {
      return String(el.innerText || el.textContent || '').trim().length;
    } catch (e) { return 0; }
  }

  function rectOf(el) {
    try {
      const r = el.getBoundingClientRect();
      return { w: r.width || 0, h: r.height || 0 };
    } catch (e) { return { w: 0, h: 0 }; }
  }

  /* 把一个候选记进表里：算面积、命中强度，给个分 */
  function scoreEditor(el, frame) {
    if (!el || el.nodeType !== 1) return null;
    if (el.getAttribute('contenteditable') === 'false') return null;
    if (isFieldEl(el)) return null;

    const r = rectOf(el);
    const area = r.w * r.h;
    const tag = (el.tagName || '').toUpperCase();

    /* 太小的可编辑块（开关标签、小按钮）不是正文；但 iframe 里的 body
     * 可能量出来是 0，那种就只看标签 */
    if (!frame && (area < 4000 || r.h < 24 || r.w < 80)) return null;
    if (!frame && el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null;

    let score = 0;
    for (const sel of BODY_SELECTORS) {
      try {
        if (el.matches(sel)) { score += (sel === '[contenteditable="true"]' ? 60 : 1200); break; }
      } catch (e) { /* ignore */ }
    }
    if (tag === 'BODY') score += 300;              // iframe 里的编辑区
    if (frame) score += 80;                        // 传统 UEditor 正文常在 iframe
    score += Math.min(area / 400, 700);            // 面积越大越像正文
    score += Math.min(textLen(el) * 2, 260);       // 有内容的优先，但压不过面积

    return { el, frame: !!frame, score, w: Math.round(r.w), h: Math.round(r.h), len: textLen(el) };
  }

  /* 收集候选：主文档 + 同源 iframe（含一层嵌套），按分数从高到低 */
  function editorCandidates() {
    const out = [];
    const push = (el, frame) => {
      if (!el || out.some((c) => c.el === el)) return;
      const c = scoreEditor(el, frame);
      if (c) out.push(c);
    };

    const scanDoc = (doc, frame) => {
      if (!doc) return;
      for (const sel of BODY_SELECTORS) {
        let list = [];
        try { list = Array.from(doc.querySelectorAll(sel)); } catch (e) { continue; }
        list.forEach((el) => push(el, frame));
      }
    };

    scanDoc(document, false);

    // 同源 iframe：老版 UEditor 的正文就在里头
    try {
      Array.from(document.querySelectorAll('iframe')).forEach((f) => {
        let doc = null;
        try { doc = f.contentDocument; } catch (e) { return; }
        if (!doc || !doc.documentElement) return;
        scanDoc(doc, true);
      });
    } catch (e) { /* ignore */ }

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function findEditor() {
    const list = editorCandidates();
    return list.length ? list[0].el : null;
  }

  /**
   * 拿一个「当前还活在页面上」的编辑器。
   * 公众号编辑器会动态重建，缓存的 state.editor 可能已经脱离文档，
   * 用失效元素改写会静默失败，所以每次都验一下再用。
   */
  /* 这个编辑区现在还「在页面上」吗？
   * 注意 iframe 里的正文：iframe 被移除后，它自己的 document 里
   * contains(body) 依然为 true（游离的浏览上下文），必须再查 frameElement。 */
  function editorAlive(el) {
    if (!el || el.nodeType !== 1 || !el.isContentEditable) return false;
    const doc = el.ownerDocument;
    if (!doc) return false;
    if (!doc.contains(el)) return false;
    if (doc === document) return true;
    let frame = null;
    try { frame = doc.defaultView && doc.defaultView.frameElement; } catch (e) { frame = null; }
    return !!(frame && document.contains(frame));
  }

  function getLiveEditor() {
    const cached = state.editor;
    if (cached && editorAlive(cached) && !isFieldEl(cached)) {
      return cached;
    }
    const fresh = findEditor();
    if (fresh) state.editor = fresh;
    return fresh;
  }

  function findTitle() {
    for (const sel of TITLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        const v = el.value || el.innerText || '';
        return { el, value: v };
      }
    }
    return { el: null, value: '' };
  }

  /* ---------- 检测核心 ---------- */

  function scanRedline(text) {
    const hits = [];
    if (!text) return hits;
    const rules = (typeof DICT.getRules === 'function')
      ? DICT.getRules(state.categories)
      : (DICT.redline || []);

    for (const group of rules) {
      for (const raw of group.patterns) {
        // 兼容两种写法：裸正则，或 { re, to } 带替换词
        const pat = (raw instanceof RegExp) ? { re: raw, to: '' } : raw;
        const src = pat.re;
        if (!src) continue;

        const local = new RegExp(src.source, src.flags.includes('g') ? src.flags : src.flags + 'g');
        let m;
        while ((m = local.exec(text)) !== null) {
          hits.push({
            groupId: group.id,
            groupName: group.name,
            category: group.category || 'common',
            level: group.level,
            why: group.why,
            suggest: group.suggest,
            word: m[0],
            swap: pat.to || '',
            index: m.index,
            context: contextAround(text, m.index, m[0].length),
          });
          if (++hits.length > 400) break;
          if (m[0].length === 0) local.lastIndex++;
        }
      }
    }
    return hits;
  }

  function contextAround(text, index, len) {
    const start = Math.max(0, index - 18);
    const end = Math.min(text.length, index + len + 18);
    return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
  }

  function scanAITrace(text) {
    const groups = [];
    let totalHits = 0;
    for (const group of DICT.aiTrace || []) {
      const words = [];
      for (const re of group.patterns) {
        const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m;
        while ((m = local.exec(text)) !== null) {
          words.push(m[0]);
          if (words.length > 120) break;
        }
      }
      if (words.length) {
        totalHits += words.length;
        groups.push({ id: group.id, name: group.name, why: group.why, fix: group.fix, count: words.length, words: uniq(words).slice(0, 12) });
      }
    }

    // 句式均匀度：AI 写作句长趋同，真人写作忽长忽短
    const sentences = splitSentences(text);
    const lengths = sentences.map((s) => s.length).filter((n) => n > 0);
    const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    const variance = lengths.length > 1
      ? lengths.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / lengths.length
      : 0;
    const stddev = Math.sqrt(variance);

    // 段落均匀度
    const paras = text.split(/\n{1,}/).map((s) => s.trim()).filter((s) => s.length > 0);
    const pLens = paras.map((p) => p.length);
    const pAvg = pLens.length ? pLens.reduce((a, b) => a + b, 0) / pLens.length : 0;
    const pVar = pLens.length > 1
      ? pLens.reduce((a, b) => a + Math.pow(b - pAvg, 2), 0) / pLens.length
      : 0;
    const pStd = Math.sqrt(pVar);

    const charCount = text.replace(/\s/g, '').length || 1;
    const density = (totalHits / charCount) * 1000; // 每千字命中数

    let score = 0;
    // 短文本用绝对命中数，避免小样本被密度放大
    score += charCount < 220 ? Math.min(45, totalHits * 5) : Math.min(45, density * 5);
    // 只有「中长句且长度趋同」才是 AI 信号，真人短句流不算
    score += (avg >= 18 && stddev > 0 && stddev < 12) ? 20 : (avg >= 18 && stddev < 18) ? 10 : 0;
    score += (pAvg >= 40 && pStd > 0 && pStd < 30) ? 15 : (pAvg >= 40 && pStd < 50) ? 6 : 0;
    score = Math.round(Math.min(100, Math.max(0, score)));

    return {
      groups: groups.sort((a, b) => b.count - a.count),
      totalHits,
      density: Number(density.toFixed(2)),
      sentenceStd: Number(stddev.toFixed(1)),
      sentenceAvg: Number(avg.toFixed(1)),
      paragraphStd: Number(pStd.toFixed(1)),
      paragraphAvg: Number(pAvg.toFixed(1)),
      score,
      verdict: score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low',
      charCount,
    };
  }

  function splitSentences(text) {
    return (text || '').split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  function scanFont(text) {
    const el = state.editor;
    const found = [];
    if (el) {
      const nodes = el.querySelectorAll('*');
      const limit = Math.min(nodes.length, 3000);
      for (let i = 0; i < limit; i++) {
        const cs = getComputedStyle(nodes[i]);
        const ff = cs.fontFamily || '';
        if (ff) found.push(ff);
      }
    }
    const families = new Set();
    found.forEach((ff) => {
      ff.split(',').forEach((part) => {
        const clean = part.trim().replace(/^["']|["']$/g, '');
        if (clean && !/^(serif|sans-serif|monospace|cursive|system-ui|inherit|initial|unset|-apple-system)$/i.test(clean)) {
          families.add(clean);
        }
      });
    });
    const deny = DICT.fonts?.deny || [];
    const risky = [];
    families.forEach((fam) => {
      for (const d of deny) {
        if (fam.toLowerCase().includes(d.toLowerCase())) {
          risky.push(fam);
          break;
        }
      }
    });
    return { families: Array.from(families), risky };
  }

  /* ---------- 综合评分 ---------- */

  function buildReport() {
    state.editor = findEditor();
    const title = findTitle();
    const bodyText = state.editor ? (state.editor.innerText || state.editor.textContent || '') : '';

    const redline = scanRedline((title.value || '') + '\n' + bodyText);
    const ai = scanAITrace(bodyText);
    const font = scanFont(bodyText);

    const blocked = redline.filter((h) => h.level === 'block');
    const warned = redline.filter((h) => h.level === 'warn');

    const checks = [
      { id: 'title', name: '标题无夸张词', pass: !redline.some((h) => h.groupId === 'clickbait' && h.index < (title.value || '').length + 1), score: 12, block: true },
      { id: 'redline', name: '正文无红线词', pass: blocked.length === 0, score: 20, block: true },
      { id: 'ai', name: 'AI 痕迹低于阈值', pass: ai.score < 40, score: 15, block: true },
      { id: 'font', name: '字体全部白名单', pass: font.risky.length === 0, score: 8, block: false },
      { id: 'netdisk', name: '无网盘 / 外链导流', pass: !redline.some((h) => h.groupId === 'netdisk' || h.groupId === 'external'), score: 10, block: true },
      { id: 'env', name: '含测试环境说明', pass: /测试环境|版本[:：]|设备[:：]|实测/.test(bodyText), score: 10, block: false },
      { id: 'negative', name: '含不适合谁', pass: /不适合|不推荐|劝退|别买|慎用/.test(bodyText), score: 8, block: false },
      { id: 'ask', name: '文末有具体提问', pass: /[？?]\s*$/.test(bodyText.trim().slice(-80)) || /留言|说说你/.test(bodyText.slice(-200)), score: 7, block: false },
    ];

    const total = checks.reduce((sum, c) => sum + (c.pass ? c.score : 0), 0);
    const max = checks.reduce((sum, c) => sum + c.score, 0);
    const blockedNow = checks.some((c) => c.block && !c.pass);

    return {
      title: title.value || '',
      bodyText,
      charCount: bodyText.replace(/\s/g, '').length,
      redline,
      blocked,
      warned,
      ai,
      font,
      checks,
      total,
      max,
      percent: Math.round((total / max) * 100),
      blockedNow,
      ts: Date.now(),
    };
  }

  /* ---------- UI ---------- */

  let ui = null;

  function createUI() {
    if (ui) return ui;

    const fabWrap = document.createElement('div');
    fabWrap.className = 'wg-fab-wrap';

    const fab = document.createElement('div');
    fab.className = 'wg-fab';
    fab.title = '发布安全台（点击展开检测面板）';
    fab.innerHTML = '<span class="wg-fab-dot"></span><span class="wg-fab-text">安全台</span>';

    const fabCover = document.createElement('div');
    fabCover.className = 'wg-fab wg-fab-cover';
    fabCover.title = '封面设计（在页面内打开，不跳转）';
    fabCover.innerHTML = '<span class="wg-fab-dot"></span><span class="wg-fab-text">封面</span>';

    /* 豆包侧窗按钮：位置就排在「封面」下面（用户指定） */
    const fabDoubao = document.createElement('div');
    fabDoubao.className = 'wg-fab wg-fab-doubao';
    fabDoubao.title = '豆包侧窗：在右边聊，写好的内容复制回正文';
    fabDoubao.innerHTML = '<span class="wg-fab-dot"></span><span class="wg-fab-text">豆包</span>';

    const fabWriter = document.createElement('div');
    fabWriter.className = 'wg-fab wg-fab-writer';
    fabWriter.title = '编辑台：Markdown 排版 / AI 写作（在页面内打开，不跳转）';
    fabWriter.innerHTML = '<span class="wg-fab-dot"></span><span class="wg-fab-text">编辑台</span>';

    const panel = document.createElement('div');
    panel.className = 'wg-panel';
    panel.innerHTML = `
      <div class="wg-panel-head">
        <div class="wg-panel-title">
          <b>发布安全台</b>
          <span class="wg-panel-sub">实时检测 · 只读不改稿</span>
        </div>
        <button class="wg-close" type="button" title="收起">×</button>
      </div>
      <div class="wg-panel-score">
        <div class="wg-score-ring"><span class="wg-score-num">--</span><small>分</small></div>
        <div class="wg-score-meta">
          <div class="wg-verdict">未检测</div>
          <div class="wg-score-hint">标签：<span class="wg-tags">点「开始检测」扫描当前正文</span></div>
        </div>
      </div>
      <div class="wg-tabs">
        <button class="wg-tab is-on" data-tab="redline">红线 <em>0</em></button>
        <button class="wg-tab" data-tab="ai">AI痕迹 <em>0</em></button>
        <button class="wg-tab" data-tab="checks">清单</button>
        <button class="wg-tab" data-tab="font">字体</button>
      </div>
      <div class="wg-body">
        <div class="wg-view" data-view="redline"></div>
        <div class="wg-view is-hide" data-view="ai"></div>
        <div class="wg-view is-hide" data-view="checks"></div>
        <div class="wg-view is-hide" data-view="font"></div>
      </div>
      <div class="wg-panel-foot">
        <button class="wg-btn wg-btn-ghost" data-act="scan">开始检测</button>
        <button class="wg-btn wg-btn-fix" data-act="ai-fix">降 AI 味</button>
        <button class="wg-btn" data-act="open-workbench">工作台</button>
      </div>
    `;

    document.documentElement.appendChild(fabWrap);
    fabWrap.appendChild(fabCover);
    fabWrap.appendChild(fabDoubao);
    fabWrap.appendChild(fabWriter);
    fabWrap.appendChild(fab);
    document.documentElement.appendChild(panel);

    /* ---------- 右侧豆包侧窗 ---------- */
    const dbWrap = document.createElement('div');
    dbWrap.className = 'wg-db';
    dbWrap.hidden = true;
    dbWrap.innerHTML = `
      <div class="wg-db-head">
        <b>豆包</b>
        <span class="wg-db-sub">在右边问，选中回答复制粘回正文</span>
        <button class="wg-db-btn" type="button" data-db="reload" title="重新加载豆包">↻</button>
        <button class="wg-db-close" type="button" title="收起">×</button>
      </div>
      <iframe class="wg-db-frame" title="豆包"
              data-src="${chrome.runtime.getURL('workbench/doubao-side.html')}"
              allow="clipboard-read; clipboard-write; microphone"></iframe>
    `;
    document.documentElement.appendChild(dbWrap);

    const dbFrame = dbWrap.querySelector('.wg-db-frame');

    /* 侧窗底边永远贴在悬浮按钮组上方（按钮数量会变，别写死 bottom） */
    function dbPlace() {
      try {
        const top = fabWrap.getBoundingClientRect().top;
        const gap = 12;
        const h = window.innerHeight - top + gap;
        dbWrap.style.bottom = Math.round(h) + 'px';
        dbWrap.style.maxHeight = Math.round(top - gap - 16) + 'px';
      } catch (e) { /* ignore */ }
    }

    /* 只切显隐，iframe 一直活着：收起再展开，豆包正在写的回答不会丢。
     * 打开/收起只由用户操作触发：点「豆包」按钮、点 ×、Esc、打开安全台面板。
     * 不做鼠标移开自动收起——用户明确要求「保持一直显示」 */
    function dbSetOpen(v) {
      const open = !!v;
      if (open) dbPlace();
      dbWrap.hidden = !open;
      fabDoubao.classList.toggle('is-on', open);
      if (open && dbFrame && !dbFrame.getAttribute('src')) {
        try { dbFrame.src = dbFrame.dataset.src; } catch (e) { /* ignore */ }
      }
    }

    fabDoubao.addEventListener('click', () => dbSetOpen(dbWrap.hidden));
    dbWrap.querySelector('.wg-db-close').addEventListener('click', () => dbSetOpen(false));
    dbWrap.querySelector('[data-db="reload"]').addEventListener('click', () => {
      try { dbFrame.src = dbFrame.dataset.src; } catch (e) { /* ignore */ }
    });
    window.addEventListener('resize', () => { if (!dbWrap.hidden) dbPlace(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dbWrap.hidden) dbSetOpen(false);
    }, true);

    fab.addEventListener('click', () => toggle(true));
    fabCover.addEventListener('click', () => openStudio('cover', '封面设计 · Writer Guard'));
    fabWriter.addEventListener('click', () => openStudio('writer', '编辑台 · Writer Guard'));
    panel.querySelector('.wg-close').addEventListener('click', () => toggle(false));
    panel.querySelectorAll('.wg-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.wg-tab').forEach((t) => t.classList.remove('is-on'));
        tab.classList.add('is-on');
        panel.querySelectorAll('.wg-view').forEach((v) => {
          v.classList.toggle('is-hide', v.dataset.view !== tab.dataset.tab);
        });
      });
    });
    panel.querySelector('[data-act="scan"]').addEventListener('click', () => {
      // 唯一入口：点了才找编辑器、才扫描
      state.editor = findEditor();
      if (!state.editor) {
        flash('没找到正文编辑区。先在正文里点一下，或刷新页面再试。', 'error');
        const rv = panel.querySelector('[data-view="redline"]');
        if (rv) {
          rv.innerHTML = '<div class="wg-empty">当前页面没找到正文编辑区。<br>'
            + '如果编辑器是刚打开的，等一秒再点「开始检测」；<br>'
            + '一直找不到的话，把公众号编辑页的地址发我，我加对应的识别规则。</div>';
        }
        return;
      }
      const r = buildReport();
      state.lastReport = r;
      render(r);
      flash('检测完成 · 评分 ' + r.percent);
    });
    panel.querySelector('[data-act="ai-fix"]').addEventListener('click', (e) => {
      if (state.aiFixBackup != null) undoAIFix(e.currentTarget);
      else applyAIFix(e.currentTarget);
    });
    panel.querySelector('[data-act="open-workbench"]').addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ type: 'WG_OPEN_WORKBENCH' });
      } catch (err) {
        window.open(chrome.runtime.getURL('workbench/workbench.html'));
      }
    });

    ui = { fab, fabCover, fabDoubao, fabWrap, panel, dbWrap, dbSetOpen, dbFrame };

    /* 面板一建好就先放上「还没检测」的空状态，别留一块空白 */
    try { renderIdle(); } catch (err) { /* ignore */ }

    /* 自检：改写引擎没挂上（多半是扩展没重新加载），直接标在按钮上 */
    try {
      if (!window.WG || !window.WG.Rewriter) {
        const fixBtn = panel.querySelector('[data-act="ai-fix"]');
        if (fixBtn) {
          fixBtn.textContent = '降 AI 味 (未加载)';
          fixBtn.title = '改写引擎没注入：去 chrome://extensions 重新加载扩展，再刷新本页';
          fixBtn.classList.add('is-dead');
        }
      }
    } catch (e) { /* ignore */ }
    return ui;
  }

  /* ============================================================
   * 一键降 AI 味：改写当前编辑器内容并写回
   * ============================================================ */

  function flash(msg, kind) {
    if (!ui) return;
    let el = ui.panel.querySelector('.wg-flash');
    if (!el) {
      el = document.createElement('div');
      el.className = 'wg-flash';
      const head = ui.panel.querySelector('.wg-panel-head');
      if (head && head.nextSibling) head.parentNode.insertBefore(el, head.nextSibling);
      else ui.panel.insertBefore(el, ui.panel.firstChild);
    }
    el.textContent = msg;
    el.dataset.kind = kind || 'info';
    el.classList.add('is-on');
    clearTimeout(flash._t);
    // 出错的信息多留一会儿，别一闪就没
    flash._t = setTimeout(() => el.classList.remove('is-on'), kind === 'error' ? 7000 : 3600);
  }

  /* 写回编辑器：优先 execCommand insertText（保留编辑器内部状态），失败再降级赋值 */
  function writeBackToEditor(ed, text) {
    try {
      ed.focus();
      const range = document.createRange();
      range.selectNodeContents(ed);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (e) { ok = false; }

      if (!ok) ed.textContent = text;

      try {
        ed.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
        ed.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* ignore */ }

      return true;
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
   * 封面插入编辑器
   * 封面设计器在 iframe 里，画布生成 PNG 后用 postMessage 发过来。
   * 插入按三档降级：模拟粘贴 → execCommand → 剪贴板兜底。
   * ============================================================ */

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'WG_INSERT_COVER') return;

    insertCoverToEditor(d).then((r) => {
      // 回执给封面设计 iframe：让工作台知道到底成没成，而不是一句「正在插入…」
      try {
        if (e.source) {
          e.source.postMessage({
            type: 'WG_INSERT_COVER_ACK',
            token: d.token || '',
            ok: !!(r && r.ok),
            mode: (r && r.mode) || '',
            msg: (r && r.msg) || '',
          }, '*');
        }
      } catch (err) { /* ignore */ }
    }).catch((err) => {
      try {
        if (e.source) {
          e.source.postMessage({
            type: 'WG_INSERT_COVER_ACK',
            token: d.token || '',
            ok: false,
            msg: (err && err.message) || '插入异常',
          }, '*');
        }
      } catch (e2) { /* ignore */ }
    });
  });

  /* ============================================================
   * 编辑台 → 写入公众号正文
   *
   * 工作台是独立扩展页，跨页只能走 chrome.runtime 消息。
   * 插入按三档降级：
   *   ① 模拟 paste 事件（微信编辑器自己的粘贴清洗逻辑最认这个）
   *   ② execCommand('insertHTML')
   *   ③ 直接写 innerHTML 再补一个 input 事件
   * ============================================================ */

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitEditor(timeout) {
    const deadline = Date.now() + (timeout || 9000);
    while (Date.now() < deadline) {
      const ed = getLiveEditor();
      if (ed) return ed;
      await sleep(320);
    }
    return null;
  }

  function setEditorTitle(title) {
    if (!title) return false;
    const t = findTitle();
    if (!t || !t.el) return false;
    const el = t.el;
    /* 兜底防御：万一标题选择器摸到了正文（长文 + 多段），
     * 宁可不写标题，也不能把正文冲掉 */
    const cur = String(('value' in el ? el.value : el.textContent) || '');
    if (cur.trim().length > 120 && !('value' in el)) return false;
    try {
      el.focus();
      if ('value' in el) el.value = title;
      else el.textContent = title;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function titleText() {
    const t = findTitle();
    if (!t || !t.el) return '';
    return String(t.value || (('value' in t.el) ? t.el.value : t.el.textContent) || '');
  }

  function visibleChars(ed) {
    try {
      return String((ed.innerText || ed.textContent || '')).replace(/\s/g, '').length;
    } catch (e) { return 0; }
  }

  async function insertHtmlToEditor(html, title, plain) {
    if (!html) return { ok: false, msg: '排版内容是空的' };

    const ed = await waitEditor(9000);
    if (!ed) {
      return { ok: false, msg: '没找到正文编辑器：先在公众号后台点「新的创作 → 图文消息」打开编辑页' };
    }
    /* 双保险：绝不往标题框 / 摘要框里写正文 */
    if (isFieldEl(ed)) {
      return { ok: false, msg: '刚才定位到的是标题栏：先在公众号「正文」里点一下，再点写入编辑器' };
    }

    const before = ed.innerHTML;
    const beforeChars = visibleChars(ed);
    const titleBefore = titleText();
    const fallbackPlain = plain || html.replace(/<[^>]+>/g, '');
    const grab = (mode) => {
      /* 写完再看一眼：正文该变长；标题突然暴涨 = 写错地方了 */
      const grew = visibleChars(ed) - beforeChars;
      const titleGrew = titleText().length - titleBefore.length;
      if (grew <= 0 && titleGrew > 40) {
        return { ok: false, msg: '内容跑到标题栏去了：先在公众号正文里点一下，再点一次写入' };
      }
      if (title && setEditorTitle(title)) { /* 正文写对地方了才补标题 */ }
      return { ok: true, mode: mode, chars: visibleChars(ed) };
    };

    /* ① 模拟粘贴 */
    try {
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', fallbackPlain);

      caretToEnd(ed);

      let ev = null;
      try {
        ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      } catch (e) {
        ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      }
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (e) { /* ignore */ }
      }

      ed.dispatchEvent(ev);
      await sleep(800);
      if (ed.innerHTML !== before) return grab('paste');
    } catch (e) { /* 下一档 */ }

    /* ② execCommand 插入 */
    try {
      caretToEnd(ed);
      const doc = ed.ownerDocument || document;
      const ok = (doc.execCommand || document.execCommand).call(doc, 'insertHTML', false, html);
      await sleep(450);
      if (ok || ed.innerHTML !== before) return grab('exec');
    } catch (e) { /* 下一档 */ }

    /* ③ 直接写（追加到已有正文后面，别覆盖） */
    try {
      ed.innerHTML = before ? (before + html) : html;
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
      ed.dispatchEvent(new Event('change', { bubbles: true }));
      return grab('direct');
    } catch (e) {
      return { ok: false, msg: '写入失败：' + (e.message || '未知错误') };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'WG_PING_EDITOR') {
      const ed = getLiveEditor();
      sendResponse({ ok: !!ed, url: location.href });
      return true;
    }

    if (msg.type === 'WG_SET_TITLE') {
      /* 单独写标题：编辑页可能刚打开、标题框还没渲染，等一下再试 */
      (async () => {
        let ok = setEditorTitle(msg.title);
        if (!ok) {
          await waitEditor(4000);
          ok = setEditorTitle(msg.title);
        }
        sendResponse(ok
          ? { ok: true, title: msg.title }
          : { ok: false, msg: '没找到标题框：先打开「图文消息」编辑页再点插入' });
      })();
      return true;
    }

    if (msg.type === 'WG_INSERT_HTML') {
      insertHtmlToEditor(msg.html, msg.title, msg.plain)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, msg: e.message || '写入异常' }));
      return true;
    }

    return false;
  });

  /* 等微信把自己的图上传完：img 数量要涨，而且 src 得是真地址 */
  async function waitImgGain(ed, before, timeout) {
    const deadline = Date.now() + (timeout || 6000);
    while (Date.now() < deadline) {
      const imgs = ed.querySelectorAll('img');
      if (imgs.length > before) {
        // 再等一会儿，让 dataURL 占位图换成真实地址（微信上传需要时间）
        await sleep(500);
        return true;
      }
      await sleep(280);
    }
    return false;
  }

  /* blob → dataURL */
  function blobToDataUrl(blob) {
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => res('');
      fr.readAsDataURL(blob);
    });
  }

  /* 把光标挪到正文开头/末尾（execCommand / paste 依赖选区）。
   * 正文可能在同源 iframe 里，Range 和 Selection 都得用那个文档的。 */
  function caretTo(ed, where) {
    const doc = ed.ownerDocument || document;
    const win = doc.defaultView || window;
    try {
      try { win.focus(); } catch (e0) { /* ignore */ }
      ed.focus({ preventScroll: true });
    } catch (e) { try { ed.focus(); } catch (e2) { /* ignore */ } }
    try {
      const range = doc.createRange();
      range.selectNodeContents(ed);
      range.collapse(where === 'start');
      const sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* 选区失败也继续试 */ }
  }

  function caretToEnd(ed) { caretTo(ed, 'end'); }

  /* blob → 正文。四档降级，返回结果对象，由调用方决定怎么提示。
   * opts.atTop=true 时插到正文开头（封面走这条）。 */
  async function insertBlobIntoEditor(blob, opts) {
    const atTop = !!(opts && opts.atTop);
    // 页面刚打开时编辑器可能还没渲染好，等一等再判失败
    const ed = (await waitEditor(2600)) || getLiveEditor();
    if (!ed) return { ok: false, msg: '找不到正文编辑器：先在正文里点一下，或者刷新公众号编辑页再试' };

    const putCaret = () => caretTo(ed, atTop ? 'start' : 'end');
    const before = ed.querySelectorAll('img').length;

    /* ① 构造 paste 事件：最接近真人粘贴，微信编辑器会自己走上传 */
    try {
      const file = new File([blob], 'image.png', { type: blob.type || 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      putCaret();

      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      try {
        Object.defineProperty(ev, 'clipboardData', { value: dt });
      } catch (err) {
        // 某些环境不允许改写，忽略
      }
      ed.dispatchEvent(ev);

      if (await waitImgGain(ed, before, 2600)) {
        return { ok: true, mode: 'paste' };
      }
    } catch (e) { /* 继续下一档 */ }

    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl) return { ok: false, msg: '图片编码失败，重新生成一次封面试试' };

    /* ② insertHTML：ProseMirror 系编辑器比 insertImage 更认这个 */
    try {
      putCaret();
      document.execCommand('insertHTML', false,
        '<img src="' + dataUrl + '" style="max-width:100%;height:auto">');
      if (await waitImgGain(ed, before, 1600)) {
        return { ok: true, mode: 'html' };
      }
    } catch (e) { /* 继续下一档 */ }

    /* ③ execCommand 直接插图（部分编辑器吃这一套） */
    try {
      putCaret();
      document.execCommand('insertImage', false, dataUrl);
      if (await waitImgGain(ed, before, 1600)) {
        return { ok: true, mode: 'exec' };
      }
    } catch (e) { /* 继续下一档 */ }

    /* ④ 兜底：写进剪贴板，让用户自己按 Ctrl+V */
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        // 没有用户手势时 clipboard.write 可能一直挂着，加超时别让流程卡死
        await Promise.race([
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
          new Promise((_, rej) => setTimeout(() => rej(new Error('剪贴板无响应')), 1800)),
        ]);
        return { ok: true, mode: 'clipboard', msg: '图片已复制到剪贴板，在正文里按 Ctrl+V 粘贴' };
      }
    } catch (e) { /* 落到失败 */ }

    return { ok: false, msg: '编辑器没吃下这张图：点一下正文区域，或刷新公众号编辑页再试' };
  }

  async function insertCoverToEditor(d) {
    let blob;
    if (d.buffer) blob = new Blob([d.buffer], { type: d.mime || 'image/png' });
    else if (d.dataUrl) blob = await (await fetch(d.dataUrl)).blob();
    if (!blob) {
      flash('封面数据为空', 'error');
      return { ok: false, msg: '封面数据为空' };
    }

    flash('正在把封面插到正文开头…');
    const r = await insertBlobIntoEditor(blob, { atTop: true });
    if (r.ok) {
      flash(r.mode === 'clipboard' ? r.msg : '封面已插入正文开头', r.mode === 'clipboard' ? 'warn' : 'info');
      refreshAfterFix();
    } else {
      flash(r.msg, 'error');
    }
    return r;
  }

  /* 豆包生成的图片，经后台转发进来（dataURL） */
  async function insertImageFromDoubao(msg) {
    try {
      if (!msg.dataUrl || !/^data:image\//i.test(msg.dataUrl)) {
        return { ok: false, msg: '图片数据为空' };
      }
      const blob = await (await fetch(msg.dataUrl)).blob();
      return await insertBlobIntoEditor(blob);
    } catch (e) {
      return { ok: false, msg: e.message || '插入异常' };
    }
  }

  /* 把编辑器里第一处命中的词换成建议词 */
  function applySwapInEditor(h) {
    const ed = getLiveEditor();
    if (!ed) return flash('找不到编辑器：先在正文里点一下', 'error');

    const text = ed.innerText || '';
    const word = h.word;
    if (!word) return;

    const isDel = /（删除|整段删除）/.test(h.swap || '');
    const to = isDel ? '' : String(h.swap).replace(/（[^）]*）/g, '').trim();

    const idx = text.indexOf(word);
    if (idx < 0) return flash('编辑器里已经找不到「' + word + '」了', 'warn');

    const next = text.slice(0, idx) + to + text.slice(idx + word.length);
    if (!writeBackToEditor(ed, next)) return flash('写回失败，去工作台改更稳', 'error');

    // 备份点在改写前就已经丢了，这里重新记一份供撤销
    flash(isDel ? '已删除「' + word + '」' : '「' + word + '」→「' + to + '」');
    refreshAfterFix();
  }

  function refreshAfterFix() {
    setTimeout(() => {
      const rep = buildReport();
      state.lastReport = rep;
      if (state.open) render(rep);
    }, 320);
  }

  function applyAIFix(btn) {
    const R = window.WG && window.WG.Rewriter;
    if (!R) return flash('改写引擎没加载：去 chrome://extensions 点一下刷新，然后 Ctrl+Shift+R', 'error');

    const ed = getLiveEditor();
    if (!ed) return flash('没找到编辑器：先在正文里点一下，再点这个按钮', 'error');

    const src = ed.innerText || ed.textContent || '';
    if (!src.trim()) return flash('正文是空的，先写点内容', 'warn');

    const r = R.rewrite(src);
    if (!r.changed) {
      return flash('没找到能自动改的词——问题在句式结构，需要手动调', 'warn');
    }

    state.aiFixBackup = src;

    if (!writeBackToEditor(ed, r.text)) {
      state.aiFixBackup = null;
      return flash('写回编辑器失败：去工作台改写后复制粘贴更稳', 'error');
    }

    if (btn) {
      btn.textContent = '撤销降味';
      btn.classList.add('is-fix-on');
    }
    flash('已改写 ' + r.count + ' 处，通读一遍再发布');
    refreshAfterFix();
  }

  function undoAIFix(btn) {
    if (state.aiFixBackup == null) return flash('没有可撤销的改写', 'warn');
    const ed = getLiveEditor();
    if (!ed) return flash('找不到编辑器', 'error');

    const ok = writeBackToEditor(ed, state.aiFixBackup);
    state.aiFixBackup = null;

    if (btn) {
      btn.textContent = '降 AI 味';
      btn.classList.remove('is-fix-on');
    }
    flash(ok ? '已恢复原文' : '恢复失败，可按 Ctrl+Z 回退');

    try {
      const rep = buildReport();
      state.lastReport = rep;
    } catch (e) { /* ignore */ }
    refreshAfterFix();
  }

  /* ============================================================
   * 封面设计：在公众号页面内以全屏覆盖层打开工作台
   * 不跳标签页，数据仍走同一个 chrome.storage
   * ============================================================ */

  let studioOverlay = null;

  /* 在公众号页面内以全屏覆盖层打开工作台（封面设计 / 编辑台共用） */
  function openStudio(view, label) {
    if (studioOverlay) return;
    /* 全屏覆盖层要盖上来，豆包侧窗先收掉 */
    if (ui && ui.dbSetOpen) ui.dbSetOpen(false);

    studioOverlay = document.createElement('div');
    studioOverlay.className = 'wg-cover-overlay';

    const bar = document.createElement('div');
    bar.className = 'wg-cover-bar';

    const ttl = document.createElement('span');
    ttl.className = 'wg-cover-title';
    ttl.textContent = label || 'Writer Guard';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'wg-cover-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';

    bar.appendChild(ttl);
    bar.appendChild(closeBtn);

    const frame = document.createElement('iframe');
    frame.className = 'wg-cover-frame';
    frame.setAttribute('allow', 'clipboard-write; clipboard-read');
    frame.src = chrome.runtime.getURL('workbench/workbench.html#' + view);

    studioOverlay.appendChild(bar);
    studioOverlay.appendChild(frame);
    document.documentElement.appendChild(studioOverlay);
    document.documentElement.classList.add('wg-studio-open');

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };

    function close() {
      if (studioOverlay) studioOverlay.remove();
      studioOverlay = null;
      document.documentElement.classList.remove('wg-studio-open');
      document.removeEventListener('keydown', onKey, true);
    }

    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
  }

  function toggle(open) {
    createUI();
    state.open = open;
    ui.panel.classList.toggle('is-open', open);
    ui.fabWrap.classList.toggle('is-open', open);
    /* 检测面板从右侧滑出来，豆包侧窗同一区域，先收起别打架 */
    if (open && ui.dbSetOpen) ui.dbSetOpen(false);
    if (open) {
      // 手动模式：打开面板只回显上次结果，不偷偷重扫
      if (state.lastReport) render(state.lastReport);
      else renderIdle();
    }
  }

  /* 未检测时的空状态 */
  function renderIdle() {
    if (!ui) return;
    const p = ui.panel;

    const num = p.querySelector('.wg-score-num');
    if (num) num.textContent = '--';
    const ring = p.querySelector('.wg-score-ring');
    if (ring) ring.dataset.level = 'idle';

    const v = p.querySelector('.wg-verdict');
    if (v) {
      v.textContent = '未检测';
      v.dataset.level = 'idle';
    }
    const tags = p.querySelector('.wg-tags');
    if (tags) tags.textContent = '点下方「开始检测」扫描当前正文';

    p.querySelectorAll('.wg-tab em').forEach((em) => { em.textContent = ''; });

    const rv = p.querySelector('[data-view="redline"]');
    if (rv) {
      rv.innerHTML = '<div class="wg-empty">还没检测。<br>点下方「开始检测」，扫一遍当前编辑器里的内容。</div>';
    }
    const av = p.querySelector('[data-view="ai"]');
    if (av) {
      av.innerHTML = '<div class="wg-empty">还没检测。</div>';
    }
  }

  const LEVEL_LABEL = { block: '必删', warn: '高危', tip: '提示' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(r) {
    if (!ui) return;
    const p = ui.panel;

    // 分数
    p.querySelector('.wg-score-num').textContent = r.percent;
    const ring = p.querySelector('.wg-score-ring');
    ring.dataset.level = r.percent >= 80 ? 'good' : r.percent >= 60 ? 'mid' : 'bad';

    const verdict = p.querySelector('.wg-verdict');
    if (r.blockedNow) {
      verdict.textContent = '存在阻断项，不建议发布';
      verdict.dataset.level = 'bad';
    } else if (r.percent < 80) {
      verdict.textContent = '可发布，但有优化项';
      verdict.dataset.level = 'mid';
    } else {
      verdict.textContent = '通过，可以发布';
      verdict.dataset.level = 'good';
    }

    if (typeof updateFabBadge === 'function') updateFabBadge(r);

    const tags = [];
    if (r.blocked.length) tags.push(`红线 ${r.blocked.length}`);
    if (r.warned.length) tags.push(`警告 ${r.warned.length}`);
    if (r.ai.score >= 40) tags.push(`AI度 ${r.ai.score}`);
    if (!tags.length) tags.push('无命中');
    p.querySelector('.wg-tags').textContent = tags.join(' · ');

    // 角标
    const tabMap = {
      redline: r.redline.length,
      ai: r.ai.totalHits,
    };
    p.querySelectorAll('.wg-tab').forEach((t) => {
      const em = t.querySelector('em');
      if (em) em.textContent = tabMap[t.dataset.tab] ?? '';
    });

    // 红线视图
    const rv = p.querySelector('[data-view="redline"]');
    if (!r.redline.length) {
      rv.innerHTML = '<div class="wg-empty">未命中红线词。继续保持：不给破解版、不放网盘、不做诱导。</div>';
    } else {
      rv.innerHTML = r.redline.slice(0, 80).map((h, i) => {
        const swap = h.swap || '';
        const isDel = /（删除|整段删除）/.test(swap);
        return `
        <div class="wg-item" data-level="${h.level}">
          <div class="wg-item-top">
            <span class="wg-badge" data-level="${h.level}">${LEVEL_LABEL[h.level]}</span>
            <span class="wg-item-name">${esc(h.groupName)}</span>
            <code class="wg-word">${esc(h.word)}</code>
          </div>
          <div class="wg-item-ctx">${esc(h.context)}</div>
          <div class="wg-item-why">${esc(h.why)}</div>
          ${swap ? `<div class="wg-swap ${isDel ? 'is-del' : ''}">
            <span class="wg-swap-label">替换为</span>
            <code class="wg-swap-word">${esc(swap)}</code>
            <button class="wg-swap-btn" data-swap-i="${i}">替换</button>
          </div>` : ''}
          <div class="wg-item-fix">改法：${esc(h.suggest)}</div>
        </div>`;
      }).join('');

      // 点「替换」直接改编辑器里那一处
      rv.onclick = (ev) => {
        const btn = ev.target.closest('.wg-swap-btn');
        if (!btn) return;
        const h = r.redline[Number(btn.dataset.swapI)];
        if (h) applySwapInEditor(h);
      };
    }

    // AI 视图
    const av = p.querySelector('[data-view="ai"]');
    av.innerHTML = `
      <div class="wg-aimeter">
        <div class="wg-aimeter-row">
          <span>AI 度</span><b data-level="${r.ai.verdict}">${r.ai.score}</b>
        </div>
        <div class="wg-bar"><i style="width:${r.ai.score}%;background:${r.ai.score >= 70 ? '#e5484d' : r.ai.score >= 40 ? '#f5a623' : '#30a46c'}"></i></div>
        <div class="wg-metrics">
          <span>命中 ${r.ai.totalHits} 次</span>
          <span>密度 ${r.ai.density}/千字</span>
          <span>句长σ ${r.ai.sentenceStd}</span>
          <span>段长σ ${r.ai.paragraphStd}</span>
        </div>
      </div>
      ${r.ai.groups.length ? r.ai.groups.map((g) => `
        <div class="wg-item" data-level="warn">
          <div class="wg-item-top">
            <span class="wg-badge" data-level="warn">${g.count}</span>
            <span class="wg-item-name">${esc(g.name)}</span>
          </div>
          <div class="wg-item-ctx">${g.words.map((w) => `<code class="wg-word">${esc(w)}</code>`).join(' ')}</div>
          <div class="wg-item-why">${esc(g.why)}</div>
          <div class="wg-item-fix">改法：${esc(g.fix)}</div>
        </div>
      `).join('') : '<div class="wg-empty">未检出明显 AI 痕迹词。</div>'}
      <div class="wg-tipbox">
        <b>句长σ低于 12</b> 说明每句长度太接近，是 AI 生成强信号。做法：故意插一句 5 字以内的短句，再写一句 40 字以上的长句。
      </div>
    `;

    // 清单
    const cv = p.querySelector('[data-view="checks"]');
    cv.innerHTML = r.checks.map((c) => `
      <div class="wg-check ${c.pass ? 'is-pass' : 'is-fail'}">
        <span class="wg-check-ico">${c.pass ? '✓' : '✕'}</span>
        <span class="wg-check-name">${esc(c.name)}</span>
        ${c.block && !c.pass ? '<span class="wg-badge" data-level="block">阻断</span>' : ''}
        <span class="wg-check-score">${c.pass ? c.score : 0}/${c.score}</span>
      </div>
    `).join('') + `<div class="wg-total">合计 ${r.total}/${r.max}</div>`;

    // 字体
    const fv = p.querySelector('[data-view="font"]');
    if (!r.font.families.length) {
      fv.innerHTML = '<div class="wg-empty">未读到编辑器字体（可能编辑器未就绪）。</div>';
    } else {
      fv.innerHTML = `
        <div class="wg-sub">检测到 ${r.font.families.length} 种字体族</div>
        ${r.font.families.map((f) => {
          const risky = r.font.risky.includes(f);
          return `<div class="wg-check ${risky ? 'is-fail' : 'is-pass'}">
            <span class="wg-check-ico">${risky ? '✕' : '✓'}</span>
            <span class="wg-check-name">${esc(f)}</span>
            ${risky ? '<span class="wg-badge" data-level="block">非商用</span>' : ''}
          </div>`;
        }).join('')}
        <div class="wg-tipbox">
          图片里嵌的字体扩展读不到。凡是你自己做的封面、图表，一律只用白名单字体。
        </div>
      `;
    }

    // 悬浮球状态色
    ui.fab.dataset.level = r.blockedNow ? 'bad' : r.percent >= 80 ? 'good' : 'mid';
  }

  /* ---------- 监听 ---------- */


  function updateFabBadge(r) {
    if (!ui) return;
    ui.fab.dataset.level = r.blockedNow ? 'bad' : r.percent >= 80 ? 'good' : 'mid';
    ui.fab.title = r.blockedNow
      ? `存在 ${r.blocked.length} 处必删风险，点击查看`
      : `风险评分 ${r.percent}，点击查看`;
  }

  /* 只找编辑器，不挂任何监听（手动模式下不需要） */
  function observeEditor() {
    return grabEditor();
  }

  function loadCategories() {
    try {
      chrome.storage.local.get(['wg_categories'], (res) => {
        const v = res && res.wg_categories;
        if (Array.isArray(v)) state.categories = v;
        // 手动模式下不在这里触发扫描
      });
    } catch (e) { /* ignore */ }
  }

  function boot() {
    createUI();
    loadCategories();
    // 纯手动模式：不自动找编辑器、不自动扫描，避免持续占用资源。
    // 用户点面板底部「开始检测」时才做一次完整检测。
  }

  /* 手动模式：不再常驻监听编辑器。找编辑器只在点「开始检测」时做一次。 */
  function grabEditor() {
    const t = findEditor();
    if (t) state.editor = t;
    return t;
  }

  // 消息接口：工作台/弹窗可以请求当前页报告
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'WG_GET_REPORT') {
        const r = buildReport();
        state.lastReport = r;
        sendResponse({ ok: true, report: r });
        return true;
      }
      if (msg && msg.type === 'WG_OPEN_PANEL') {
        toggle(true);
        sendResponse({ ok: true });
        return true;
      }
      return false;
    });
  } catch (e) { /* ignore */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 测试钩子 */
  try {
    window.__wgInsertCover = insertCoverToEditor;
    window.__wgFlash = flash;
    window.__wgFindEditor = findEditor;
    window.__wgEditorInfo = () => editorCandidates().map((c) => ({
      tag: (c.el.tagName || '').toLowerCase(),
      cls: String(c.el.className || '').slice(0, 40),
      id: c.el.id || '',
      frame: c.frame,
      score: Math.round(c.score),
      w: c.w,
      h: c.h,
      len: c.len,
    }));
    window.__wgIsField = isFieldEl;
    window.__wgInsertHtml = insertHtmlToEditor;
    window.__wgDoubao = () => (ui ? {
      fab: ui.fabDoubao,
      wrap: ui.dbWrap,
      frame: ui.dbFrame,
      open: !(ui.dbWrap && ui.dbWrap.hidden),
      setOpen: (v) => ui.dbSetOpen(v),
    } : null);
  } catch (e) { /* ignore */ }
})();
