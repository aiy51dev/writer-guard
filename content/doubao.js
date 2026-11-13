/* ============================================================
 * Writer Guard · 豆包技能面板 + 图片进公众号通道
 *
 * 在豆包网页（doubao.com）右侧贴一条可展开的技能面板：
 *   - 预设技能四类：写文章 / 起标题 / 去AI味 / 生图片
 *   - 收藏：点卡片右上角 ☆，收进「收藏」分组，实时生效
 *   - 自定义：底部「+ 自定义技能」，存在扩展本地
 *   - 点卡片 → 把提示词插进豆包输入框（找不到输入框就复制到剪贴板）
 *
 * 另外给豆包生成的大图挂一个「插到公众号」悬浮按钮：
 *   抓图 → 后台转发到 mp.weixin.qq.com 编辑页 → 三档降级插入正文。
 *
 * 全部 UI 放在 ShadowRoot 里，不污染豆包自己的样式。
 * ============================================================ */
(function () {
  'use strict';

  if (window.__WG_DSKILL__) return;
  window.__WG_DSKILL__ = true;

  const SK = (typeof window.WG_SKILLS === 'object' && window.WG_SKILLS) ||
    { cats: [], items: [] };
  const catById = {};
  SK.cats.forEach((c) => { catById[c.id] = c; });

  const FAV_KEY = 'wg_skill_fav';      // 预设技能收藏 id 数组
  const CUS_KEY = 'wg_skill_custom';   // 自定义技能数组
  const OPEN_KEY = 'wg_skill_open';    // 面板展开状态
  const TAB_KEY = 'wg_skill_tab';      // 记住上次停留的分组
  const MAX_TEXT = 6000;               // 单条技能上限，防手滑粘贴整本书

  let favs = [];
  let customs = [];
  let open = false;
  let curTab = 'article';
  let query = '';

  const z = 2147483000;

  /* ---------- 存取（chrome 不可用时静默降级，方便本地测试） ---------- */

  function stGet(key, fallback) {
    return new Promise((res) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) return res(fallback);
        chrome.storage.local.get([key], (d) => {
          const v = d && d[key];
          res(v === undefined ? fallback : v);
        });
      } catch (e) { res(fallback); }
    });
  }
  function stSet(key, val) {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: val });
      }
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
   * UI 骨架
   * ============================================================ */

  const host = document.createElement('div');
  host.id = 'wg-skill-host';
  host.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;z-index:' + z + ';';
  const shadow = host.attachShadow({ mode: 'open' });

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }

    .layer { position: fixed; top: 76px; right: 0; z-index: ${z}; display: flex; align-items: flex-start; gap: 0; }

    /* ---- 收起状态的贴边把手 ---- */
    .handle {
      width: 30px;
      padding: 12px 0;
      border-radius: 10px 0 0 10px;
      background: linear-gradient(180deg, #2563eb, #7c3aed);
      color: #fff;
      writing-mode: vertical-lr;
      letter-spacing: 4px;
      font-size: 12.5px;
      font-weight: 600;
      text-align: center;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 4px 14px -4px rgba(37, 99, 235, .55);
      transition: transform .15s ease;
    }
    .handle:hover { transform: translateX(-2px); }
    .handle .hicon {
      display: block;
      margin: 8px auto 0;
      font-size: 11px;
      letter-spacing: 0;
      opacity: .85;
    }
    .handle .bdge {
      display: block;
      margin-top: 8px;
      font-size: 10px;
      letter-spacing: 0;
      opacity: .9;
    }

    /* ---- 面板 ---- */
    .panel {
      width: 322px;
      max-height: calc(100vh - 120px);
      display: none;
      flex-direction: column;
      background: #fff;
      border: 1px solid #e6e9f0;
      border-right: 0;
      border-radius: 16px 0 0 16px;
      box-shadow: -12px 0 38px -20px rgba(15, 23, 42, .42);
      overflow: hidden;
    }
    .panel.is-open { display: flex; }

    .head {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 11px 12px;
      border-bottom: 1px solid #eef1f6;
      background: linear-gradient(90deg, #f5f8ff, #fdf6ff);
    }
    .head .dot { width: 9px; height: 9px; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #7c3aed); }
    .head b { font-size: 13.5px; color: #1f2937; }
    .head .num {
      padding: 1px 7px;
      border-radius: 999px;
      background: #eef2ff;
      color: #4f46e5;
      font-size: 10.5px;
      font-weight: 600;
    }
    .head .tip { flex: 1; font-size: 11px; color: #94a3b8; text-align: right; }
    .head .x {
      width: 22px; height: 22px;
      border: 0; border-radius: 6px;
      background: transparent; color: #64748b;
      font-size: 14px; line-height: 1; cursor: pointer;
    }
    .head .x:hover { background: #eef2f7; color: #1f2937; }

    .search { flex: 0 0 auto; padding: 9px 10px 0; }
    .search input {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid #e2e6ee;
      border-radius: 8px;
      background: #f8fafc;
      font-size: 12.5px;
      color: #1f2937;
      outline: none;
    }
    .search input:focus { border-color: #93b4f8; background: #fff; }

    .tabs {
      flex: 0 0 auto;
      display: flex;
      gap: 5px;
      padding: 9px 10px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tab {
      flex: 0 0 auto;
      padding: 5px 10px;
      border: 1px solid #e2e6ee;
      border-radius: 999px;
      background: #fff;
      color: #475569;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .tab:hover { border-color: #c3d4f5; color: #1d4ed8; }
    .tab.is-on { background: #eff4ff; border-color: #2563eb; color: #1d4ed8; font-weight: 600; }

    /* ---- 2 列技能卡片 ---- */
    .grid {
      flex: 1 1 auto;
      min-height: 120px;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 2px 10px 10px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      align-content: start;
      scrollbar-width: thin;
    }
    .grid::-webkit-scrollbar { width: 5px; }
    .grid::-webkit-scrollbar-thumb { background: #dbe1ea; border-radius: 4px; }

    .card {
      position: relative;
      min-width: 0;
      padding: 9px 9px 8px 10px;
      border: 1px solid #e6e9f0;
      border-left: 3px solid var(--c, #2563eb);
      border-radius: 9px;
      background: #fbfcfe;
      cursor: pointer;
      transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease;
    }
    .card:hover { border-color: var(--c, #2563eb); background: #fff; box-shadow: 0 6px 16px -10px rgba(15,23,42,.45); transform: translateY(-1px); }
    .card:active { transform: scale(.97); }
    .card b {
      display: block;
      padding-right: 16px;
      font-size: 13px;
      line-height: 1.35;
      color: #1e293b;
      word-break: break-all;
    }
    .card span {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      margin-top: 4px;
      font-size: 11px;
      line-height: 1.45;
      color: #94a3b8;
      overflow: hidden;
    }
    .card .cat {
      display: inline-block;
      margin-top: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--c, #2563eb) 12%, #fff);
      color: var(--c, #2563eb);
      font-size: 10px;
      font-weight: 600;
    }
    .card .star {
      position: absolute; top: 6px; right: 6px;
      width: 18px; height: 18px;
      border: 0; background: transparent;
      color: #cbd5e1; font-size: 12px; line-height: 18px;
      cursor: pointer; text-align: center; border-radius: 4px;
    }
    .card .star:hover { color: #f59e0b; background: #fef3c7; }
    .card .star.on { color: #f59e0b; }
    .card .del, .card .edit {
      position: absolute; bottom: 5px;
      border: 0; background: transparent;
      color: #cbd5e1; font-size: 10.5px; cursor: pointer;
    }
    .card .del { right: 6px; }
    .card .edit { right: 24px; }
    .card .del:hover { color: #ef4444; }
    .card .edit:hover { color: #2563eb; }
    .card.is-cus { background: #fffdf7; border-left-style: dashed; }
    .card.is-cus span { padding-bottom: 12px; }

    .empty {
      grid-column: 1 / -1;
      padding: 26px 12px;
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.8;
    }

    .foot {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 10px;
      border-top: 1px solid #eef1f6;
      background: #fafbfd;
    }
    .foot button {
      padding: 6px 10px;
      border: 1px solid #dbe4f0;
      border-radius: 8px;
      background: #fff;
      color: #1d4ed8;
      font-size: 12px;
      cursor: pointer;
    }
    .foot button:hover { border-color: #93b4f8; background: #f5f8ff; }
    .foot .cnt { font-size: 11px; color: #94a3b8; }

    /* ---- 自定义技能：屏幕居中弹窗 ---- */
    .modal {
      position: fixed;
      inset: 0;
      z-index: ${z + 5};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(15, 23, 42, .46);
      backdrop-filter: blur(2px);
    }
    .modal[hidden] { display: none; }
    .dialog {
      width: 440px;
      max-width: 92vw;
      max-height: 82vh;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 24px 60px -20px rgba(15, 23, 42, .5);
      overflow: hidden;
      animation: dlgIn .18s cubic-bezier(.16, 1, .3, 1);
    }
    @keyframes dlgIn {
      from { opacity: 0; transform: translateY(10px) scale(.98); }
      to { opacity: 1; transform: none; }
    }
    .dlg-head {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 15px;
      border-bottom: 1px solid #eef1f6;
      background: linear-gradient(90deg, #f5f8ff, #fdf6ff);
    }
    .dlg-head b { font-size: 14px; color: #1f2937; }
    .dlg-head .dx {
      width: 24px; height: 24px;
      border: 0; border-radius: 7px;
      background: transparent; color: #64748b;
      font-size: 15px; line-height: 1; cursor: pointer;
    }
    .dlg-head .dx:hover { background: #eef2f7; color: #1f2937; }
    .dlg-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 13px 15px 4px;
    }
    .dlg-body .lbl { font-size: 11.5px; color: #64748b; margin: 10px 0 5px; }
    .dlg-body .lbl:first-child { margin-top: 0; }
    .dlg-body input, .dlg-body select, .dlg-body textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e2e6ee;
      border-radius: 9px;
      background: #f8fafc;
      color: #1f2937;
      font-size: 13px;
      outline: none;
    }
    .dlg-body textarea {
      min-height: 168px;
      resize: vertical;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.65;
    }
    .dlg-body input:focus, .dlg-body textarea:focus, .dlg-body select:focus {
      border-color: #93b4f8; background: #fff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .12);
    }
    .dlg-foot {
      flex: 0 0 auto;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 15px 14px;
      border-top: 1px solid #eef1f6;
      background: #fafbfd;
    }
    .dlg-foot button {
      padding: 8px 16px;
      border: 1px solid #dbe4f0;
      border-radius: 9px;
      background: #fff;
      color: #475569;
      font-size: 12.5px;
      cursor: pointer;
    }
    .dlg-foot button:hover { border-color: #93b4f8; color: #1d4ed8; }
    .dlg-foot .save {
      border-color: #2563eb;
      background: #2563eb;
      color: #fff;
      font-weight: 600;
    }
    .dlg-foot .save:hover { background: #1d4ed8; }

    /* ---- toast ---- */
    .toast {
      position: fixed;
      top: 20px; left: 50%;
      transform: translate(-50%, -6px);
      max-width: 70vw;
      padding: 9px 16px;
      border-radius: 999px;
      background: rgba(17, 24, 39, .92);
      color: #fff;
      font-size: 12.5px;
      line-height: 1.5;
      opacity: 0;
      pointer-events: none;
      transition: opacity .18s ease, transform .18s ease;
      z-index: ${z + 2};
    }
    .toast.is-on { opacity: 1; transform: translate(-50%, 0); }
    .toast.err { background: rgba(185, 28, 28, .94); }

    /* ---- 大图悬浮按钮 ---- */
    .imgbtn {
      position: fixed;
      display: none;
      align-items: center;
      gap: 4px;
      padding: 5px 9px;
      border: 0;
      border-radius: 7px;
      background: rgba(37, 99, 235, .95);
      color: #fff;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      z-index: ${z + 1};
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, .7);
    }
    .imgbtn.is-on { display: inline-flex; }
    .imgbtn:hover { background: #1d4ed8; }
    .imgbtn.busy { opacity: .6; pointer-events: none; }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  const layer = document.createElement('div');
  layer.className = 'layer';
  layer.innerHTML = `
    <div class="handle" id="wgsk-handle">技能面板<span class="hicon">◂</span><span class="bdge" id="wgsk-badge"></span></div>
    <div class="panel" id="wgsk-panel">
      <div class="head">
        <span class="dot"></span><b>技能面板</b>
        <span class="num" id="wgsk-headnum">0</span>
        <span class="tip">点一下插进对话框</span>
        <button class="x" id="wgsk-x" title="收起">›</button>
      </div>
      <div class="search"><input id="wgsk-q" placeholder="搜技能名或关键词…"></div>
      <div class="tabs" id="wgsk-tabs"></div>
      <div class="grid" id="wgsk-grid"></div>

      <div class="foot">
        <button id="wgsk-add">+ 自定义技能</button>
        <span class="cnt" id="wgsk-cnt"></span>
      </div>
    </div>
  `;
  shadow.appendChild(layer);

  /* 自定义技能弹窗：挂在 shadow 根上（不放 panel 里，避免被 overflow 裁掉） */
  const modalEl = document.createElement('div');
  modalEl.className = 'modal';
  modalEl.id = 'wgsk-modal';
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="wgsk-mtitle">
      <div class="dlg-head">
        <b id="wgsk-mtitle">自定义技能</b>
        <button class="dx" id="wgsk-mx" type="button" title="关闭">×</button>
      </div>
      <div class="dlg-body">
        <div class="lbl">技能名称</div>
        <input id="wgsk-fname" placeholder="如：写周报" maxlength="20">
        <div class="lbl">分类</div>
        <select id="wgsk-fcat"></select>
        <div class="lbl">插入到对话框的内容（用【】做占位符）</div>
        <textarea id="wgsk-ftext" placeholder="你现在是……请按下面的要求完成：【主题】"></textarea>
      </div>
      <div class="dlg-foot">
        <button id="wgsk-fcancel" type="button">取消</button>
        <button class="save" id="wgsk-fsave" type="button">保存技能</button>
      </div>
    </div>
  `;
  shadow.appendChild(modalEl);

  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  shadow.appendChild(toastEl);

  let toastTimer = null;
  function toast(msg, isErr) {
    toastEl.textContent = String(msg || '');
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
  }

  const imgBtn = document.createElement('button');
  imgBtn.className = 'imgbtn';
  imgBtn.textContent = '插到公众号';
  shadow.appendChild(imgBtn);

  /* ============================================================
   * 数据
   * ============================================================ */

  function allItems() {
    return SK.items.concat(customs);
  }

  function isFav(item) {
    if (item.custom) return !!item.fav;
    return favs.indexOf(item.id) >= 0;
  }

  function toggleFav(item) {
    if (item.custom) {
      item.fav = !item.fav;
      stSet(CUS_KEY, customs);
    } else {
      const i = favs.indexOf(item.id);
      if (i >= 0) favs.splice(i, 1);
      else favs.push(item.id);
      stSet(FAV_KEY, favs);
    }
    renderGrid();
    renderTabs();
  }

  function matchQuery(it) {
    if (!query) return true;
    const s = query.toLowerCase();
    return (it.name + ' ' + (it.hint || '') + ' ' + it.text).toLowerCase().indexOf(s) >= 0;
  }

  function visibleItems() {
    return allItems().filter((it) => {
      if (query) return matchQuery(it);
      if (curTab === 'fav') return isFav(it);
      return it.cat === curTab;
    });
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  const $ = (id) => shadow.getElementById(id);
  const grid = $('wgsk-grid');
  const tabsEl = $('wgsk-tabs');
  const panel = $('wgsk-panel');

  function renderTabs() {
    const favCount = allItems().filter(isFav).length;
    const tabs = SK.cats.map((c) => {
      const n = allItems().filter((it) => it.cat === c.id).length;
      return '<button class="tab' + (curTab === c.id ? ' is-on' : '') + '" data-tab="' + c.id + '">' +
        c.name + ' ' + n + '</button>';
    });
    tabs.push('<button class="tab' + (curTab === 'fav' ? ' is-on' : '') + '" data-tab="fav">收藏 ' + favCount + '</button>');
    tabsEl.innerHTML = tabs.join('');
  }

  function renderGrid() {
    const list = visibleItems();
    const total = allItems().length;
    const favTotal = allItems().filter(isFav).length;
    $('wgsk-cnt').textContent = '共 ' + total + ' 个 · 收藏 ' + favTotal;
    $('wgsk-badge').textContent = total ? String(total) : '';
    $('wgsk-headnum').textContent = query ? '搜到 ' + list.length : String(list.length);

    if (!list.length) {
      grid.innerHTML = curTab === 'fav' && !query
        ? '<div class="empty">还没有收藏。<br>把鼠标放到卡片右上角的 ☆ 上点一下，<br>常用技能就收进这里。</div>'
        : '<div class="empty">没有匹配的技能，换个关键词试试。</div>';
      return;
    }

    grid.innerHTML = list.map((it) => {
      const c = catById[it.cat] || SK.cats[0] || { color: '#2563eb', name: '' };
      const fav = isFav(it);
      const showCat = !!query && c.name;
      return '<div class="card' + (it.custom ? ' is-cus' : '') + '" data-id="' + it.id + '" style="--c:' + c.color + '" title="点击插入对话框">' +
        '<b>' + esc(it.name) + '</b>' +
        '<span>' + esc(it.hint || (it.custom ? '自定义' : '')) + '</span>' +
        (showCat ? '<em class="cat">' + esc(c.name) + '</em>' : '') +
        '<button class="star' + (fav ? ' on' : '') + '" data-star="' + it.id + '" title="' + (fav ? '取消收藏' : '收藏') + '">' + (fav ? '★' : '☆') + '</button>' +
        (it.custom ? '<button class="edit" data-edit="' + it.id + '" title="修改这条自定义技能">改</button>' : '') +
        (it.custom ? '<button class="del" data-del="' + it.id + '" title="删除这条自定义技能">删</button>' : '') +
        '</div>';
    }).join('');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  /* ============================================================
   * 展开 / 收起
   * ============================================================ */

  function setOpen(v) {
    open = v;
    panel.classList.toggle('is-open', v);
    stSet(OPEN_KEY, v ? 1 : 0);
    if (v) {
      renderTabs();
      renderGrid();
    }
  }

  /* 鼠标移上把手就展开，移出整个面板/把手就自动收起 */
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;
  let hoverOpenedAt = 0;
  const cancelHover = () => {
    clearTimeout(hoverOpenTimer);
    clearTimeout(hoverCloseTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = null;
  };
  function bindHover() {
    const handle = $('wgsk-handle');
    if (!handle) return;

    handle.addEventListener('mouseenter', () => {
      cancelHover();
      if (open) return;
      hoverOpenTimer = setTimeout(() => {
        setOpen(true);
        hoverOpenedAt = Date.now();
      }, 140);
    });

    // 鼠标从把手移到面板上时不能收起：只在整个 layer 外面才收
    layer.addEventListener('mouseenter', () => { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; });
    layer.addEventListener('mouseleave', () => {
      cancelHover();
      if (!open) return;
      if (modalOpen()) return; // 弹窗开着别收面板
      hoverCloseTimer = setTimeout(() => { setOpen(false); }, 460);
    });
  }

  /* ---------------- 自定义技能的居中弹窗 ---------------- */

  function modalOpen() {
    const m = $('wgsk-modal');
    return !!(m && !m.hidden);
  }

  function openModal(show) {
    const m = $('wgsk-modal');
    if (!m) return;
    m.hidden = !show;
    if (!show) return;

    // 分类下拉
    const sel = $('wgsk-fcat');
    sel.innerHTML = SK.cats.map((c) => '<option value="' + c.id + '">' + c.name + '</option>').join('');
    $('wgsk-mtitle').textContent = editing ? '修改自定义技能' : '新建自定义技能';
  }

  let editing = null; // 正在编辑的自定义技能

  function startForm(item) {
    editing = item || null;
    $('wgsk-fname').value = item ? item.name : '';
    $('wgsk-ftext').value = item ? item.text : '';
    openModal(true);
    if (item) $('wgsk-fcat').value = item.cat;
    setTimeout(() => $('wgsk-fname').focus(), 30);
  }

  function saveForm() {
    const name = $('wgsk-fname').value.trim();
    const text = $('wgsk-ftext').value.trim();
    if (!name) return toast('先给技能起个名字', true);
    if (!text) return toast('内容还是空的', true);
    if (text.length > MAX_TEXT) return toast('太长了，控制在 ' + MAX_TEXT + ' 字以内', true);

    if (editing) {
      editing.name = name;
      editing.text = text;
      editing.cat = $('wgsk-fcat').value;
      editing.hint = text.replace(/\s+/g, ' ').slice(0, 40);
    } else {
      customs.push({
        id: 'cus_' + Date.now().toString(36),
        custom: true,
        cat: $('wgsk-fcat').value,
        name: name,
        text: text,
        hint: text.replace(/\s+/g, ' ').slice(0, 40),
        fav: false,
      });
    }
    stSet(CUS_KEY, customs);
    openModal(false);
    renderTabs();
    renderGrid();
    toast(editing ? '已保存修改' : '已加入技能面板');
  }

  /* ============================================================
   * 插入豆包输入框
   * ============================================================ */

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function findChatInput() {
    // 豆包的输入框有 data-testid，先精准再兜底
    const preferred = [
      '[data-testid="chat_input_input"]',
      'textarea[placeholder*="输入"]',
      'textarea',
      '[contenteditable="true"]',
    ];
    for (const sel of preferred) {
      const cands = Array.from(document.querySelectorAll(sel))
        .filter(isVisible)
        .filter((el) => el.clientWidth > 180 && el.clientHeight >= 24)
        .filter((el) => {
          // 排除我们的面板（在 shadow 里本来查不到）和明显的搜索框
          const ph = el.getAttribute && (el.getAttribute('placeholder') || '');
          return !/搜|search/i.test(ph || '');
        })
        .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      if (cands.length) return cands[0];
    }
    return null;
  }

  function insertIntoInput(el, text) {
    return insertTextSmart(el, text);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* 把光标折叠到编辑器末尾并聚焦 */
  function focusEditorEnd(el) {
    try { el.focus(); } catch (e) { /* ignore */ }
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* ignore */ }
  }

  /* 验证文字真的进了编辑器（框架可能异步消化粘贴内容，所以要等） */
  function editorHasText(el, snippet) {
    const t = String(el.textContent || '').replace(/\s+/g, ' ');
    return t.indexOf(snippet) >= 0;
  }

  /**
   * 富文本编辑器（Lexical/ProseMirror 类）插入：
   * 直接改 DOM 会和框架内部状态脱节 —— 表现为文字在框里、
   * 发送箭头不亮、还编辑不动。必须走框架认的事件管线：
   *   ① paste 事件（各框架的粘贴处理最标准，状态必然同步）
   *   ② execCommand insertText（走 beforeinput 管线）
   *   ③ beforeinput 事件兜底
   * 每档插入后等待框架消化并验证文字真的在框里，失败才降级。
   * 不再往 DOM 里塞裸文本节点——那正是「看得见改不了」的元凶。
   */
  async function insertTextSmart(el, text) {
    if (!el) return null;

    /* textarea / input：原生 setter + input 事件，框架状态必然同步 */
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      try { el.focus(); } catch (e) { /* ignore */ }
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const cur = el.value || '';
      const next = (cur && !/\s$/.test(cur) ? cur + '\n\n' : cur) + text;
      if (desc && desc.set) desc.set.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'value';
    }

    /* Lexical 有时把可编辑区套在里层：能往下探就探一层 */
    let target = el;
    if (!target.isContentEditable) {
      const nested = target.querySelector('[contenteditable="true"]');
      if (nested) target = nested;
    }

    const snippet = String(text).replace(/\s+/g, ' ').slice(0, 12);
    if (!snippet) return null;

    /* ① 模拟 paste：把纯文本放进 clipboardData，交给框架自己的粘贴管线 */
    try {
      focusEditorEnd(target);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      let ev;
      try {
        ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      } catch (e) {
        ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      }
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (e2) { /* ignore */ }
      }
      target.dispatchEvent(ev);
      await sleep(450);
      if (editorHasText(target, snippet)) return 'paste';
    } catch (e) { /* 下一档 */ }

    /* ② execCommand insertText：Chrome 里会触发 beforeinput，Lexical 类框架接管 */
    try {
      focusEditorEnd(target);
      const ok = document.execCommand('insertText', false, text);
      await sleep(350);
      if (ok && editorHasText(target, snippet)) return 'exec';
    } catch (e) { /* 下一档 */ }

    /* ③ beforeinput 兜底 */
    try {
      focusEditorEnd(target);
      target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
      await sleep(350);
      if (editorHasText(target, snippet)) return 'beforeinput';
    } catch (e) { /* 落到剪贴板 */ }

    return null;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* 继续兜底 */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  const MODE_LABEL = {
    paste: '粘贴管线',
    exec: '输入管线',
    beforeinput: '输入事件',
    value: '输入框',
  };

  async function useSkill(item) {
    const text = item.text || '';
    if (!text) return;

    const input = findChatInput();
    if (input) {
      const mode = await insertTextSmart(input, text);
      if (mode) {
        toast('已插入「' + item.name + '」（' + (MODE_LABEL[mode] || mode) + '），把【】里的信息补一补再发送');
        return;
      }
    }
    const ok = await copyText(text);
    toast(ok
      ? '没插进输入框，「' + item.name + '」已复制，去对话框 Ctrl+V 后再发送'
      : '插入失败，手动复制一次吧', !ok);
  }

  /* ============================================================
   * 工作台 → 豆包：把整段提示词送进对话框
   *
   * 编辑台没配 API Key 时，「起标题 / 写正文 / 改写选中 / 降 AI 味 /
   * 生成摘要」都走这条路：提示词直接落进豆包输入框（可选自动发送），
   * 豆包写完，用户选中回答点「→ 编辑台」就能回填。
   * ============================================================ */

  async function waitChatInput(timeout) {
    const deadline = Date.now() + (timeout || 8000);
    while (Date.now() < deadline) {
      const el = findChatInput();
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  function findSendButton() {
    const sels = [
      '[data-testid="chat_input_send_button"]',
      '[data-testid="send_button"]',
      'button[aria-label*="发送"]',
      'button[class*="send"]',
    ];
    for (const sel of sels) {
      let list = [];
      try { list = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
      const hit = list.filter(isVisible).find((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
      if (hit) return hit;
    }
    return null;
  }

  async function askInChat(prompt, autoSend) {
    const text = String(prompt || '').trim();
    if (!text) return { ok: false, msg: '提示词是空的' };

    const input = await waitChatInput(9000);
    if (!input) {
      const copied = await copyText(text);
      return { ok: false, copied: copied, msg: copied ? '没找到豆包输入框，提示词已复制' : '没找到豆包输入框' };
    }

    const mode = await insertTextSmart(input, text);
    if (!mode) {
      const copied = await copyText(text);
      return { ok: false, copied: copied, msg: copied ? '没插进输入框，提示词已复制' : '插入失败' };
    }

    if (!autoSend) {
      toast('提示词已放进输入框，检查一下再点发送');
      return { ok: true, mode: mode, sent: false };
    }

    await sleep(500);
    const btn = findSendButton();
    if (btn) {
      btn.click();
      return { ok: true, mode: mode, sent: true };
    }

    /* 没有可点的发送按钮：模拟回车，别把用户晾在输入框前 */
    try {
      ['keydown', 'keypress', 'keyup'].forEach((t) => {
        input.dispatchEvent(new KeyboardEvent(t, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
      });
    } catch (e) { /* ignore */ }

    return { ok: true, mode: mode, sent: false, msg: '已插入输入框，按回车发送' };
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return false;

      if (msg.type === 'WG_DOUBAO_PING') {
        sendResponse({ ok: true, ready: !!findChatInput() });
        return false;
      }

      if (msg.type === 'WG_DOUBAO_ASK') {
        askInChat(msg.prompt, msg.send !== false)
          .then((r) => sendResponse(r))
          .catch((e) => sendResponse({ ok: false, msg: (e && e.message) || '推送失败' }));
        return true;
      }

      return false;
    });
  } catch (e) { /* 本地直接打开文件调试时没有 chrome.runtime */ }

  /* ============================================================
   * 工作台内置豆包侧窗（跨域 iframe）→ 页面内 postMessage 桥
   * ------------------------------------------------------------
   * 工作台右侧抽屉用 iframe 加载豆包，父页是 chrome-extension://，
   * 拿不到 iframe 里的 DOM，只能 postMessage 过来，
   * 由这里的 content script 代它填输入框 + 点发送。
   * 校验：只认扩展页发来的消息（origin 是 chrome-extension:// 或 null），
   * 且 token 必须与首次握手一致——豆包页里别的东西伪造不了。
   * ============================================================ */
  try {
    const TAG = '__wgDoubao';
    /* 安全边界是 origin：只有扩展页能发 chrome-extension:// 的消息，
     * 豆包页面自己的 JS 发过来 origin 是 https://www.doubao.com，一律不认。
     * token 只用于认领回包，允许随工作台刷新而更新（不能锁死，否则刷新后就推不动了）。 */
    let bridgeToken = null;

    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d[TAG] !== 'REQ') return;

      const origin = e.origin || '';
      const fromExt = origin === 'null' || origin === '' || origin.indexOf('chrome-extension://') === 0;
      if (!fromExt) return;

      if (d.token) bridgeToken = d.token;

      const reply = (payload) => {
        try {
          e.source.postMessage(Object.assign({
            [TAG]: 'RES', token: bridgeToken || d.token, reqId: d.reqId,
          }, payload), '*');
        } catch (err) { /* 父窗没了就算了 */ }
      };

      if (d.op === 'PING') {
        reply({ ok: true, ready: !!findChatInput() });
        return;
      }

      if (d.op === 'FILL') {
        askInChat(d.prompt, d.send !== false)
          .then((r) => reply(Object.assign({ ok: true }, r)))
          .catch((err) => reply({ ok: false, msg: (err && err.message) || '推送失败' }));
      }
    });
  } catch (e) { /* ignore */ }

  /* ============================================================
   * 豆包图片 → 公众号编辑器
   * ============================================================ */

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('读取失败'));
      fr.readAsDataURL(blob);
    });
  }

  let curImg = null;

  function isBigChatImage(img) {
    if (!img || !img.src || img.tagName !== 'IMG') return false;
    const r = img.getBoundingClientRect();
    // 过滤头像和小图标
    return r.width >= 220 && r.height >= 110 && r.bottom > 0 && r.top < innerHeight;
  }

  function placeImgBtn(img) {
    const r = img.getBoundingClientRect();
    imgBtn.style.left = Math.max(4, Math.min(r.right - 92, innerWidth - 100)) + 'px';
    imgBtn.style.top = Math.max(4, r.top + 8) + 'px';
  }

  function showImgBtn(img) {
    curImg = img;
    placeImgBtn(img);
    imgBtn.classList.add('is-on');
  }
  function hideImgBtn() {
    curImg = null;
    imgBtn.classList.remove('is-on');
  }

  async function sendImgToWx() {
    const img = curImg;
    if (!img) return;
    const src = img.currentSrc || img.src || '';
    if (!src) return toast('这张图没有地址', true);

    imgBtn.classList.add('busy');
    imgBtn.textContent = '传送中…';

    let dataUrl = '';
    try {
      if (/^data:/i.test(src)) {
        dataUrl = src;
      } else {
        // 内容脚本 fetch 受页面 CORS 限制，失败就交给后台（有 host 权限）去拉
        const r = await fetch(src, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        if (blob.size > 9 * 1024 * 1024) throw new Error('图太大');
        dataUrl = await blobToDataUrl(blob);
      }
    } catch (e) { dataUrl = ''; }

    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'WG_IMG_TO_WX',
        dataUrl: dataUrl,
        src: dataUrl ? '' : src,
        name: 'doubao.png',
        alt: (img.alt || '').slice(0, 60),
      });
    } catch (e) {
      resp = { ok: false, msg: '扩展后台没响应，去 chrome://extensions 刷新一下' };
    }

    imgBtn.classList.remove('busy');
    imgBtn.textContent = '插到公众号';

    if (resp && resp.ok) {
      toast('图片已插入公众号正文');
      hideImgBtn();
    } else {
      // 兜底：把图复制到剪贴板，用户去编辑器 Ctrl+V
      let copied = false;
      try {
        const r2 = await fetch(src, { cache: 'no-store' });
        const blob = await r2.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
        copied = true;
      } catch (e) { copied = false; }
      const why = resp && resp.msg ? resp.msg : '插入失败';
      toast(why + (copied ? '；图片已复制，可在编辑器 Ctrl+V' : ''), true);
    }
  }

  /* ============================================================
   * 事件
   * ============================================================ */

  layer.addEventListener('click', (e) => {
    const t = e.target;

    // 悬停刚展开的瞬间点一下不该又收起来
    if (t.id === 'wgsk-handle') {
      if (open && Date.now() - hoverOpenedAt < 600) return;
      return setOpen(!open);
    }
    if (t.id === 'wgsk-x') return setOpen(false);
    if (t.id === 'wgsk-add') return startForm(null);

    const tab = t.closest('[data-tab]');
    if (tab) {
      curTab = tab.dataset.tab;
      stSet(TAB_KEY, curTab);
      renderTabs();
      renderGrid();
      return;
    }

    const star = t.closest('[data-star]');
    if (star) {
      const it = allItems().find((x) => x.id === star.dataset.star);
      if (it) toggleFav(it);
      return;
    }

    const edit = t.closest('[data-edit]');
    if (edit) {
      const it = customs.find((x) => x.id === edit.dataset.edit);
      if (it) startForm(it);
      return;
    }

    const del = t.closest('[data-del]');
    if (del) {
      const it = customs.find((x) => x.id === del.dataset.del);
      if (it && confirm('删除自定义技能「' + it.name + '」？')) {
        customs = customs.filter((x) => x.id !== it.id);
        stSet(CUS_KEY, customs);
        renderTabs();
        renderGrid();
        toast('已删除');
      }
      return;
    }

    const card = t.closest('.card');
    if (card && !t.closest('.star') && !t.closest('.del')) {
      const it = allItems().find((x) => x.id === card.dataset.id);
      if (it) useSkill(it);
    }
  });

  $('wgsk-q').addEventListener('input', (e) => {
    query = e.target.value.trim();
    renderGrid();
  });

  /* 弹窗事件：点遮罩 / × / 取消关闭，点保存写入；Esc 也能关 */
  modalEl.addEventListener('click', (e) => {
    const t = e.target;
    if (t === modalEl) return openModal(false);
    if (t.id === 'wgsk-mx' || t.id === 'wgsk-fcancel') return openModal(false);
    if (t.id === 'wgsk-fsave') return saveForm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen()) {
      e.stopPropagation();
      openModal(false);
    }
  }, true);

  // 大图悬浮按钮
  document.addEventListener('mouseover', (e) => {
    const img = e.target && e.target.tagName === 'IMG' ? e.target : null;
    if (img && isBigChatImage(img)) showImgBtn(img);
    else if (!imgBtn.contains(e.target) && e.target !== imgBtn) hideImgBtn();
  }, true);
  document.addEventListener('scroll', () => {
    if (curImg && isBigChatImage(curImg)) placeImgBtn(curImg);
    else hideImgBtn();
  }, true);

  imgBtn.addEventListener('click', sendImgToWx);

  /* ============================================================
   * 启动
   * ============================================================ */

  async function boot() {
    favs = await stGet(FAV_KEY, []);
    if (!Array.isArray(favs)) favs = [];
    customs = await stGet(CUS_KEY, []);
    if (!Array.isArray(customs)) customs = [];
    customs.forEach((c) => { c.custom = true; });

    const savedTab = await stGet(TAB_KEY, 'article');
    if (SK.cats.some((c) => c.id === savedTab) || savedTab === 'fav') curTab = savedTab;

    document.documentElement.appendChild(host);
    renderTabs();
    renderGrid();
    bindHover();
    setOpen((await stGet(OPEN_KEY, 0)) === 1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ============================================================
   * 选中豆包的回答 → 一键送进编辑台
   * 用 Selection API，不依赖豆包内部 DOM 结构
   * ============================================================ */

  const selBtn = document.createElement('button');
  selBtn.className = 'imgbtn';
  selBtn.textContent = '→ 编辑台';
  shadow.appendChild(selBtn);

  document.addEventListener('selectionchange', () => {
    try {
      const sel = window.getSelection();
      const text = sel ? String(sel) : '';
      if (text.trim().length >= 12 && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && (r.width || r.height)) {
          selBtn.style.left = Math.min(innerWidth - 104, Math.max(4, r.left + r.width / 2 - 52)) + 'px';
          selBtn.style.top = Math.max(4, r.top - 34) + 'px';
          selBtn.classList.add('is-on');
          return;
        }
      }
    } catch (e) { /* ignore */ }
    selBtn.classList.remove('is-on');
  });

  selBtn.addEventListener('mousedown', (e) => e.preventDefault()); // 防止点按钮时选区被清掉
  selBtn.addEventListener('click', async () => {
    const text = (window.getSelection ? String(window.getSelection()) : '').trim();
    if (!text) return;
    selBtn.classList.remove('is-on');
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'WG_SEL_TO_WRITER', text: text.slice(0, 50000) });
    } catch (e) {
      resp = { ok: false, msg: '扩展后台没响应，去 chrome://extensions 刷新一下' };
    }
    toast(resp && resp.ok ? '已送进编辑台' : (resp && resp.msg) || '发送失败', !(resp && resp.ok));
  });

  /* 测试钩子（本地测试页用） */
  try {
    window.__wgSkillPanel = { useSkill, setOpen, findChatInput, insertIntoInput, allItems: () => allItems(), _shadow: shadow };
  } catch (e) { /* ignore */ }
})();
