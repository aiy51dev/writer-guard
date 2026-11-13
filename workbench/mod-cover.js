/* ============================================================
 * Writer Guard · 封面设计器
 * 视图：封面设计
 *
 * 设计原则：
 *   1. 文字永远本地排版 —— AI 只负责画底图，避免中文字出错
 *   2. 三栏专业布局 —— 左图层/模板/尺寸，中画布，右属性检查器
 *   3. 字体只推荐可商用 —— 直接联动侵权痛点
 *   4. 尺寸内置平台规范 —— 公众号/小红书/B站/视频号
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;
  const $$ = WG.$$;

  /* 版本号：界面上要能看到。改完文件如果显示的还是旧号，说明加载的是缓存 */
  const BUILD = '2026-r1-cover';
  const PRESET_KEY = 'coverPresets';

  /* ============================================================
   * 常量
   * ============================================================ */

  const PRESETS = [
    { id: 'wemp', name: '公众号首图', w: 900, h: 383, note: '2.35:1 · 信息流会裁成 1:1' },
    { id: 'wemp2', name: '公众号次图', w: 900, h: 900, note: '1:1 · 与首图同组' },
    { id: 'xhs34', name: '小红书竖版', w: 1242, h: 1656, note: '3:4 · 最常用' },
    { id: 'xhs11', name: '小红书方版', w: 1080, h: 1080, note: '1:1' },
    { id: 'xhs43', name: '小红书横版', w: 1080, h: 810, note: '4:3' },
    { id: 'bili', name: 'B站封面', w: 1146, h: 717, note: '16:10' },
    { id: 'sph', name: '视频号', w: 1080, h: 1260, note: '6:7' },
  ];

  /* 字体：只列可商用与需授权两类，用 fontAvailable 检测本机是否装了 */
  const FONTS = [
    { label: '系统默认黑体', css: 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif', use: 'warn' },
    { label: '思源黑体', css: '"Source Han Sans SC", "Noto Sans SC", "Noto Sans CJK SC", sans-serif', use: 'ok' },
    { label: '思源宋体', css: '"Source Han Serif SC", "Noto Serif SC", "Noto Serif CJK SC", serif', use: 'ok' },
    { label: '阿里巴巴普惠体', css: '"Alibaba PuHuiTi", "Alibaba PuHuiTi 2.0", sans-serif', use: 'ok' },
    { label: 'HarmonyOS Sans', css: '"HarmonyOS Sans SC", "HarmonyOS Sans", sans-serif', use: 'ok' },
    { label: 'MiSans', css: 'MiSans, "MiSans VF", sans-serif', use: 'ok' },
    { label: '得意黑', css: '"Smiley Sans", "得意黑", sans-serif', use: 'ok' },
    { label: '站酷高端黑', css: '"ZCOOL QingKe HuangYou", "站酷高端黑", sans-serif', use: 'ok' },
    { label: '霞鹜文楷', css: '"LXGW WenKai", "霞鹜文楷", serif', use: 'ok' },
    { label: '优设标题黑', css: '"YouSheBiaoTiHei", "优设标题黑", sans-serif', use: 'ok' },
    { label: '微软雅黑', css: '"Microsoft YaHei", sans-serif', use: 'bad' },
    { label: '苹方', css: '"PingFang SC", sans-serif', use: 'bad' },
    { label: '方正兰亭黑', css: '"FZLanTingHeiS", "方正兰亭黑", sans-serif', use: 'bad' },
    { label: '汉仪旗黑', css: '"HYQiHei", "汉仪旗黑", sans-serif', use: 'bad' },
  ];

  /* 30 种构图风格（沿用原工具，用于生成 AI 底图提示词） */
  const AI_STYLES = [
    { name: '深色渐变风', desc: '人物居中，大字压后方，深色渐变背景，高对比强冲击' },
    { name: '纯色扁平风', desc: '人物抠图感，纯色背景，干净清爽' },
    { name: '产品主视觉风', desc: '产品/UI 截图占主体，人物引导手势' },
    { name: '对比卡片风', desc: '卡片对比视觉，左右分栏，信息对照清晰' },
    { name: '极简留白风', desc: '大面积留白，克制呼吸感，主体偏一侧' },
    { name: '海报拼贴风', desc: '多图分层叠加，前中后景，叙事丰富纵深感强' },
    { name: '人物侧置留白风', desc: '人物偏一侧，对面留大面积空镜，大气' },
    { name: '背影构图风', desc: '人物背对镜头，代入感强，适合励志启发类' },
    { name: '局部出镜风', desc: '只露手/半脸，产品是绝对主角' },
    { name: '正面对视风', desc: '直视镜头眼神接触，情绪直接' },
    { name: '杂志封面风', desc: '杂志排版线框，人物半身，高级时尚大片感' },
    { name: '全身入镜风', desc: '人物全身入镜，比例修长' },
    { name: '手绘插画风', desc: '整体手绘插画质感，扁平涂鸦，温暖可爱' },
    { name: '复古港风', desc: '老香港霓虹招牌、胶片颗粒、昏黄灯光' },
    { name: '赛博朋克风', desc: '霓虹光感、故障元素、未来城市，冷峻科技' },
    { name: '国风水墨风', desc: '水墨晕染、大留白，东方写意意境' },
    { name: '治愈手账风', desc: '手账贴纸、便签质感，温馨治愈生活感' },
    { name: '大字报风', desc: '超大主体占满画面，警示冲击，适合促销' },
    { name: '分屏双栏风', desc: '上下/左右分屏，一边画面一边留白，结构清爽' },
    { name: '网格卡片风', desc: '九宫格卡片切片，多信息并列罗列，秩序感强' },
    { name: '相框边框风', desc: '画中画相框结构，复古相纸感' },
    { name: '漂浮贴纸风', desc: '元素如贴纸漂浮留白，轻盈俏皮' },
    { name: '科技HUD风', desc: '数据面板、坐标线框叠加，专业冷峻' },
    { name: '几何色块风', desc: '大色块拼接与渐变，现代几何构成感' },
    { name: '剪影光效风', desc: '逆光剪影+光晕，见光不见细节，氛围感强' },
    { name: '错位叠字风', desc: '主体多重重影错位叠印，排版设计感强' },
    { name: '街头涂鸦风', desc: '涂鸦喷绘背景，粗犷张扬，街头潮流' },
    { name: '梦幻光斑风', desc: '柔焦光斑、梦幻朦胧，唯美治愈' },
    { name: '简约英文点缀风', desc: '主体+英文衬线小字点缀，国际高级感' },
    { name: '特写大头风', desc: '人脸特写占画面大半，情绪直击镜头' },
  ];

  /* ============================================================
   * 状态
   * ============================================================ */

  const S = {
    w: 900,
    h: 383,
    presetId: 'wemp',
    /* 背景：corners = 四角各自一色，双线性插值融合 */
    bg: {
      type: 'corners',
      c1: '#0f172a',   // 左上
      c2: '#1e3a8a',   // 右上
      c3: '#7c3aed',   // 右下
      c4: '#0891b2',   // 左下
      angle: 135,
    },
    layers: [],
    sel: null,
    zoom: 1,
    fitZoom: 1,
    grid: true,
    snap: true,
    history: [],
    hIndex: -1,
    ready: false,
    charSel: null,
  };

  let seq = 0;
  const uid = (p) => (p || 'L') + '_' + Date.now().toString(36) + (++seq);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : (d || 0);
  };

  /* ============================================================
   * 历史
   * ============================================================ */

  function snapshot() {
    return JSON.stringify({ w: S.w, h: S.h, bg: S.bg, layers: S.layers, presetId: S.presetId });
  }

  function restore(str) {
    try {
      const d = JSON.parse(str);
      S.w = d.w; S.h = d.h; S.bg = d.bg; S.layers = d.layers; S.presetId = d.presetId;
      if (!S.layers.some((l) => l.id === S.sel)) S.sel = null;
      renderAll();
    } catch (e) { /* ignore */ }
  }

  function pushHistory() {
    const s = snapshot();
    if (S.hIndex >= 0 && S.history[S.hIndex] === s) return;
    S.history = S.history.slice(0, S.hIndex + 1);
    S.history.push(s);
    if (S.history.length > 50) S.history.shift();
    S.hIndex = S.history.length - 1;
    updateHistoryButtons();
    scheduleAutosave();
  }

  /* ============================================================
   * 自动保存：每次改动都落盘，刷新不丢
   * ============================================================ */

  const AUTOSAVE_KEY = 'coverAutosave';
  let autosaveTimer = null;
  let autosaveBusy = false;

  function buildAutosave(includeImages) {
    return {
      v: 1,
      w: S.w,
      h: S.h,
      bg: Object.assign({}, S.bg),
      layers: S.layers.map((l) => {
        const copy = Object.assign({}, l);
        if (!includeImages && typeof copy.src === 'string' && copy.src.startsWith('data:')) {
          copy.src = '';
          copy.srcDropped = true;
        }
        return copy;
      }),
      presetId: S.presetId,
      zoom: S.zoom,
      grid: S.grid,
      snap: S.snap,
      sel: S.sel,
      ts: Date.now(),
    };
  }

  function setSaveState(text, kind) {
    const el = $('#cv-save-state');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind || 'ok';
  }

  /**
   * 写盘。图片是 dataURL，可能把配额撑爆，
   * 所以先试完整版，失败再退到「不带图片」的版本。
   */
  function saveAutosave() {
    if (autosaveBusy) return;
    autosaveBusy = true;

    const write = (snap, cb) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.set({ ['wg_' + AUTOSAVE_KEY]: snap }, () => {
            const err = chrome.runtime && chrome.runtime.lastError;
            cb(err ? err.message : null);
          });
        } catch (e) {
          cb(e.message);
        }
      } else {
        try {
          localStorage.setItem('wg_' + AUTOSAVE_KEY, JSON.stringify(snap));
          WG.Store.set(AUTOSAVE_KEY, snap);
          cb(null);
        } catch (e) {
          cb(e.message);
        }
      }
    };

    const full = buildAutosave(true);
    write(full, (err) => {
      if (!err) {
        WG.Store.set(AUTOSAVE_KEY, full);
        autosaveBusy = false;
        setSaveState('已保存', 'ok');
        return;
      }
      // 配额不够：去掉图片再存一次
      const lite = buildAutosave(false);
      write(lite, (err2) => {
        autosaveBusy = false;
        if (err2) {
          setSaveState('保存失败', 'bad');
          WG.toast('自动保存失败：' + (err2.length > 40 ? err2.slice(0, 40) + '…' : err2));
        } else {
          WG.Store.set(AUTOSAVE_KEY, lite);
          setSaveState('已保存（图片过大未存）', 'warn');
        }
      });
    });
  }

  function scheduleAutosave() {
    setSaveState('保存中…', 'busy');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveAutosave, 500);
  }

  /** 恢复上次的画布。返回是否真的恢复了内容 */
  function loadAutosave() {
    const snap = WG.Store.get(AUTOSAVE_KEY, null);
    if (!snap || !Array.isArray(snap.layers) || !snap.w || !snap.h) return false;

    S.w = snap.w;
    S.h = snap.h;
    if (snap.bg && typeof snap.bg === 'object') S.bg = Object.assign({}, S.bg, snap.bg);
    S.layers = snap.layers.map((l) => Object.assign({}, l));
    S.presetId = snap.presetId || 'custom';
    S.zoom = typeof snap.zoom === 'number' ? snap.zoom : 1;
    S.grid = snap.grid !== false;
    S.snap = snap.snap !== false;

    // 选中项如果还在就恢复，不然清空
    S.sel = (snap.sel && S.layers.some((l) => l.id === snap.sel)) ? snap.sel : null;
    S.charSel = new Set();

    const dropped = S.layers.some((l) => l.srcDropped);
    setSaveState(dropped ? '已恢复（图片未存）' : '已恢复上次编辑', dropped ? 'warn' : 'ok');
    return true;
  }

  function undo() {
    if (S.hIndex <= 0) return WG.toast('没有可撤销的操作');
    S.hIndex--;
    restore(S.history[S.hIndex]);
    updateHistoryButtons();
  }

  function redo() {
    if (S.hIndex >= S.history.length - 1) return WG.toast('没有可重做的操作');
    S.hIndex++;
    restore(S.history[S.hIndex]);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const u = $('#cv-undo');
    const r = $('#cv-redo');
    if (u) u.style.opacity = S.hIndex > 0 ? '1' : '.4';
    if (r) r.style.opacity = S.hIndex < S.history.length - 1 ? '1' : '.4';
  }

  /* ============================================================
   * 图层模型
   * ============================================================ */

  function baseLayer(type, patch) {
    return Object.assign({
      id: uid(type[0].toUpperCase()),
      type,
      name: '',
      x: 0, y: 0, w: 200, h: 100,
      rot: 0,
      opacity: 1,
      locked: false,
      visible: true,
    }, patch || {});
  }

  function textLayer(patch) {
    const base = Math.max(S.w, S.h);
    return baseLayer('text', Object.assign({
      name: '文字',
      text: '输入文字',
      font: FONTS[1].css,
      fontLabel: FONTS[1].label,
      size: Math.round(base * 0.09),
      weight: 800,
      color: '#ffffff',
      lineHeight: 1.25,
      letterSpacing: 0,
      align: 'center',
      strokeEnabled: false,
      strokeWidth: 3,
      strokeColor: '#000000',
      shadowEnabled: false,
      shadowX: 0,
      shadowY: 4,
      shadowBlur: 14,
      shadowColor: 'rgba(0,0,0,.45)',
      bgEnabled: false,
      bgColor: '#1f6feb',
      bgRadius: 8,
      bgPadX: 18,
      bgPadY: 10,
      charColors: {},
      w: Math.round(S.w * 0.72),
      h: Math.round(base * 0.14),
      x: Math.round(S.w * 0.14),
      y: Math.round(S.h * 0.36),
    }, patch || {}));
  }

  function shapeLayer(patch) {
    return baseLayer('rect', Object.assign({
      name: '矩形',
      shape: 'rect',
      fill: '#1f6feb',
      radius: 0,
      borderWidth: 0,
      borderColor: '#ffffff',
      w: Math.round(S.w * 0.4),
      h: Math.round(S.h * 0.2),
      x: Math.round(S.w * 0.3),
      y: Math.round(S.h * 0.4),
    }, patch || {}));
  }

  function imageLayer(src, patch) {
    return baseLayer('image', Object.assign({
      name: '图片',
      src: src || '',
      fit: 'cover',
      radius: 0,
      w: S.w,
      h: S.h,
      x: 0,
      y: 0,
    }, patch || {}));
  }

  function getLayer(id) {
    return S.layers.find((l) => l.id === id) || null;
  }

  function updateLayer(id, patch, opts) {
    const l = getLayer(id);
    if (!l) return;
    Object.assign(l, patch);
    if (!opts || !opts.silent) {
      renderStage();
      renderInspector();
    }
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  function renderAll() {
    renderStage();
    renderInspector();   // 画布背景 + 图层列表 + 图层属性，一次画完
    updateDims();
    updateSelHint();
    applyZoom(S.zoom, true);
  }

  function styleForText(l) {
    const styles = [
      `left:${l.x}px`,
      `top:${l.y}px`,
      `width:${l.w}px`,
      `height:auto`,
      `transform:rotate(${l.rot}deg)`,
      `opacity:${l.opacity}`,
      `font-family:${l.font}`,
      `font-size:${l.size}px`,
      `font-weight:${l.weight}`,
      `color:${l.color}`,
      `line-height:${l.lineHeight}`,
      `letter-spacing:${l.letterSpacing}px`,
      `text-align:${l.align}`,
      `white-space:pre-wrap`,
      `word-break:break-word`,
    ];
    if (l.strokeEnabled && l.strokeWidth > 0) {
      styles.push(`-webkit-text-stroke:${l.strokeWidth}px ${l.strokeColor}`);
      styles.push('paint-order:stroke fill');
    }
    if (l.shadowEnabled) {
      styles.push(`text-shadow:${l.shadowX}px ${l.shadowY}px ${l.shadowBlur}px ${l.shadowColor}`);
    }
    if (l.bgEnabled) {
      styles.push(`background:${l.bgColor}`);
      styles.push(`border-radius:${l.bgRadius}px`);
      styles.push(`padding:${l.bgPadY}px ${l.bgPadX}px`);
      styles.push('box-sizing:border-box');
    }
    return styles.join(';');
  }

  function renderStage() {
    const canvas = $('#cv-canvas');
    const stage = $('#cv-stage');
    if (!canvas || !stage) return;

    stage.style.width = S.w + 'px';
    stage.style.height = S.h + 'px';

    // 背景（纯色 / 线性渐变 / 四角渐变）
    applyStageBg(stage);

    canvas.innerHTML = '';
    canvas.classList.toggle('is-grid', S.grid);

    S.layers.forEach((l) => {
      if (!l.visible) return;

      const el = document.createElement('div');
      el.className = 'cv-el' + (l.id === S.sel ? ' is-sel' : '') + (l.locked ? ' is-locked' : '');
      el.dataset.id = l.id;

      if (l.type === 'text') {
        el.className += ' cv-el-text';
        let st = styleForText(l);
        // 选中时给个淡底，让人看清「换行宽度框」的范围；用户自己设了背景块就不加
        if (l.id === S.sel && !l.bgEnabled) st += ';background:rgba(31,111,235,.07)';
        el.setAttribute('style', st);

        const colored = l.charColors && Object.keys(l.charColors).length > 0;
        if (colored) {
          // 逐字着色：按原字符索引包 span，保证换行和空格位置不变
          const chars = Array.from(String(l.text));
          el.innerHTML = chars.map((ch, i) => {
            const col = l.charColors[i];
            const safe = ch === '\n' ? '\n' : escapeHtml(ch);
            return col ? `<span style="color:${col}">${safe}</span>` : safe;
          }).join('');
        } else {
          el.textContent = l.text;
        }
      } else if (l.type === 'image') {
        el.setAttribute('style',
          `left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;` +
          `transform:rotate(${l.rot}deg);opacity:${l.opacity};` +
          `border-radius:${l.radius}px;overflow:hidden;display:flex;align-items:center;justify-content:center;` +
          `background:rgba(120,130,150,.12)`);
        if (l.src) {
          const im = document.createElement('img');
          im.src = l.src;
          im.className = 'cv-el-img';
          im.style.cssText = 'width:100%;height:100%;display:block;object-fit:' + (l.fit || 'cover');
          el.appendChild(im);
        } else {
          el.innerHTML = '<span style="font-size:12px;color:#8b949e;pointer-events:none">点「替换图片」</span>';
        }
      } else if (l.type === 'rect') {
        const radiusCss = l.shape === 'ellipse' ? '50%' : (l.radius || 0) + 'px';
        el.setAttribute('style',
          `left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;` +
          `transform:rotate(${l.rot}deg);opacity:${l.opacity};` +
          `background:${l.fill};border-radius:${radiusCss};` +
          (l.borderWidth > 0 ? `border:${l.borderWidth}px solid ${l.borderColor};box-sizing:border-box;` : ''));
      }

      // 选中态：控制点
      if (l.id === S.sel && !l.locked) {
        ['nw', 'ne', 'sw', 'se'].forEach((d) => {
          const hd = document.createElement('div');
          hd.className = 'cv-handle';
          hd.dataset.h = d;
          el.appendChild(hd);
        });
        const rot = document.createElement('div');
        rot.className = 'cv-handle';
        rot.dataset.h = 'rot';
        el.appendChild(rot);
      }

      canvas.appendChild(el);

      // 文字层高度回写（用于吸附、导出对齐）
      if (l.type === 'text') {
        const h = el.offsetHeight;
        if (h > 0) l.h = h;
      }
    });

    bindStageEvents();
  }

  /* 添加工具：文字 / 图片 / 矩形 / 圆形 / 线条（检查器第 2 位） */
  function addToolsRow() {
    return `<div class="cv-add-row cv-add-row-top">
      <button class="cv-add" data-add="text">文字</button>
      <button class="cv-add" data-add="image">图片</button>
      <button class="cv-add" data-add="rect">矩形</button>
      <button class="cv-add" data-add="circle">圆形</button>
      <button class="cv-add" data-add="line">线条</button>
    </div>`;
  }

  /* 顶部对齐条：只有文字层显示 */
  function alignBar(l) {
    if (!l || l.type !== 'text') return '';
    return `<div class="cv-group cv-align-group">
      <div class="cv-seg" data-seg="align">
        <button data-v="left" class="${l.align === 'left' ? 'is-on' : ''}">左对齐</button>
        <button data-v="center" class="${l.align === 'center' ? 'is-on' : ''}">居中</button>
        <button data-v="right" class="${l.align === 'right' ? 'is-on' : ''}">右对齐</button>
      </div>
    </div>`;
  }

  /* 文字内容编辑框（检查器第 3 位，不显示「内容」二字） */
  function textContentBlock(l) {
    if (!l || l.type !== 'text') return '';
    return `<div class="cv-group cv-text-block">
      <textarea data-k="text" rows="3" placeholder="直接改这里的文字…">${WG.esc(l.text)}</textarea>
    </div>`;
  }

  /* 图层列表 */
  function layerListBlock() {
    const list = S.layers.slice().reverse();
    const rows = list.map((l) => {
      const ico = l.isBg ? '▦' : ({ text: 'T', image: '▣', rect: '▢' }[l.type] || '◇');
      const label = l.isBg ? '背景图' : (l.name || l.text || '图层');
      return `<div class="cv-layer ${l.id === S.sel ? 'is-sel' : ''} ${l.locked ? 'is-locked' : ''}" data-id="${l.id}">
        <span class="cv-layer-ico" title="${l.isBg ? '铺满画布的背景' : ''}">${ico}</span>
        <span class="cv-layer-name" data-name="${l.id}">${WG.esc(label)}</span>
        <button class="cv-layer-btn" data-act="visible" data-id="${l.id}" title="显示/隐藏">${l.visible ? '◉' : '○'}</button>
        <button class="cv-layer-btn" data-act="lock" data-id="${l.id}" title="锁定">${l.locked ? '▣' : '▢'}</button>
      </div>`;
    }).join('');

    return `<div class="cv-group">
      <div class="cv-group-title">图层 <span class="cv-group-count">${S.layers.length}</span></div>
      <div class="cv-layer-list" id="cv-layer-list">
        ${rows || '<div class="cv-pane-hint" style="margin:0">还没有图层。点上面加一个，或去左边挑版式。</div>'}
      </div>
    </div>`;
  }

  /* 兼容旧调用点 */
  function layerBlock() {
    return addToolsRow() + layerListBlock();
  }

  function bindLayers() {
    const box = $('#cv-inspector');
    if (!box) return;

    box.querySelectorAll('.cv-add').forEach((btn) => {
      btn.addEventListener('click', () => addLayer(btn.dataset.add));
    });

    box.querySelectorAll('#cv-layer-list .cv-layer').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.cv-layer-btn')) return;
        selectLayer(row.dataset.id);
      });

      row.addEventListener('dblclick', () => {
        const nameEl = row.querySelector('.cv-layer-name');
        if (!nameEl) return;
        nameEl.contentEditable = 'true';
        nameEl.focus();
        const done = () => {
          nameEl.contentEditable = 'false';
          const l = getLayer(row.dataset.id);
          if (l) l.name = nameEl.textContent.trim() || l.name;
          renderInspector();
        };
        nameEl.addEventListener('blur', done, { once: true });
        nameEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
        });
      });
    });

    box.querySelectorAll('#cv-layer-list .cv-layer-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const l = getLayer(btn.dataset.id);
        if (!l) return;
        if (btn.dataset.act === 'visible') l.visible = !l.visible;
        if (btn.dataset.act === 'lock') l.locked = !l.locked;
        pushHistory();
        renderAll();
      });
    });
  }

  /* 兼容旧调用点：图层列表已并入 renderInspector */
  function renderLayerList() {
    renderInspector();
  }

  /* ============================================================
   * 属性检查器
   * ============================================================ */

  /* 画布背景区块：不管有没有选中图层，都固定显示在检查器顶部 */
  function bgBlock() {
    const t = S.bg.type;
    const isGrad = t === 'gradient';
    const isCorners = t === 'corners';

    return `<div class="cv-group cv-bg-group">
      <div class="cv-group-title">画布背景</div>
      <div class="cv-row">
        <div class="cv-num"><label>宽</label><input type="number" data-canvas="w" value="${S.w}"></div>
        <div class="cv-num"><label>高</label><input type="number" data-canvas="h" value="${S.h}"></div>
      </div>
      <div class="cv-seg" data-seg="bgtype">
        <button data-v="solid" class="${t === 'solid' ? 'is-on' : ''}">纯色</button>
        <button data-v="gradient" class="${isGrad ? 'is-on' : ''}">双色</button>
        <button data-v="corners" class="${isCorners ? 'is-on' : ''}">四角</button>
      </div>

      ${isCorners ? `
      <div class="cv-corner-grid">
        <div class="cv-num"><label>左上</label>
          <div class="cv-color-row">
            <input type="color" class="cv-color" data-canvas="c1" value="${toHex(S.bg.c1)}">
            <input type="text" class="cv-color-hex" data-canvas="c1hex" value="${S.bg.c1}">
          </div>
        </div>
        <div class="cv-num"><label>右上</label>
          <div class="cv-color-row">
            <input type="color" class="cv-color" data-canvas="c2" value="${toHex(S.bg.c2)}">
            <input type="text" class="cv-color-hex" data-canvas="c2hex" value="${S.bg.c2}">
          </div>
        </div>
        <div class="cv-num"><label>左下</label>
          <div class="cv-color-row">
            <input type="color" class="cv-color" data-canvas="c4" value="${toHex(S.bg.c4)}">
            <input type="text" class="cv-color-hex" data-canvas="c4hex" value="${S.bg.c4}">
          </div>
        </div>
        <div class="cv-num"><label>右下</label>
          <div class="cv-color-row">
            <input type="color" class="cv-color" data-canvas="c3" value="${toHex(S.bg.c3)}">
            <input type="text" class="cv-color-hex" data-canvas="c3hex" value="${S.bg.c3}">
          </div>
        </div>
      </div>
      <div class="cv-font-note">四角各一色，自动插值融合。滚动画布四角的圆点可单独换色，不会撞色。</div>
      ` : ''}

      ${!isCorners ? `
      <div class="cv-row">
        <div class="cv-num"><label>${isGrad ? '起始色' : '背景色'}</label>
          <div class="cv-color-row">
            <input type="color" class="cv-color" data-canvas="c1" value="${toHex(S.bg.c1)}">
            <input type="text" class="cv-color-hex" data-canvas="c1hex" value="${S.bg.c1}">
          </div>
        </div>
      </div>` : ''}

      ${isGrad ? `
      <div class="cv-row">
        <div class="cv-num"><label>结束色</label>
          <div class="cv-color-row">
            <input type="color" class="cv-color" data-canvas="c2" value="${toHex(S.bg.c2)}">
            <input type="text" class="cv-color-hex" data-canvas="c2hex" value="${S.bg.c2}">
          </div>
        </div>
      </div>
      <div class="cv-range-row"><label>角度</label>
        <input type="range" data-canvas="angle" min="0" max="360" value="${S.bg.angle}">
        <b>${S.bg.angle}°</b>
      </div>` : ''}
    </div>`;
  }

  function renderInspector() {
    const box = $('#cv-inspector');
    if (!box) return;
    const l = getLayer(S.sel);

    if (!l) {
      box.innerHTML = addToolsRow() + layerListBlock() +
        '<div class="cv-empty">选中一个图层编辑它的属性</div>' + bgBlock();
      bindCanvasInspector();
      bindLayers();
      return;
    }

    /* 顺序：① 对齐 ② 添加工具 ③ 文字内容 ④ 图层列表 ⑤ 专属属性 ⑥ 位置 ⑦ 画布背景压最底 */
    const parts = [];
    parts.push(alignBar(l));
    parts.push(addToolsRow());
    parts.push(textContentBlock(l));
    parts.push(layerListBlock());

    /* 位置与尺寸不立刻塞进去，统一放到所有专属属性后面 */
    const posBlock = `
      <div class="cv-group">
        <div class="cv-group-title">位置与尺寸</div>
        <div class="cv-row">
          <div class="cv-num"><label>X</label><input type="number" data-k="x" value="${Math.round(l.x)}"></div>
          <div class="cv-num"><label>Y</label><input type="number" data-k="y" value="${Math.round(l.y)}"></div>
        </div>
        <div class="cv-row">
          <div class="cv-num"><label>宽</label><input type="number" data-k="w" value="${Math.round(l.w)}"></div>
          <div class="cv-num"><label>高</label><input type="number" data-k="h" value="${Math.round(l.h)}" ${l.type === 'text' ? 'disabled title="文字高度由内容决定"' : ''}></div>
        </div>
        <div class="cv-range-row"><label>旋转</label>
          <input type="range" data-k="rot" min="-180" max="180" value="${Math.round(l.rot)}">
          <b>${Math.round(l.rot)}°</b>
        </div>
        <div class="cv-range-row"><label>透明</label>
          <input type="range" data-k="opacity" min="0" max="100" step="1" value="${Math.round(l.opacity * 100)}">
          <b>${Math.round(l.opacity * 100)}%</b>
        </div>
      </div>
    `;

    /* 文字专属：逐字着色排最前，文字内容紧随其后 */
    if (l.type === 'text') {
      parts.push(charPanel(l));

      const fontOpts = FONTS.map((f) => {
        const avail = fontAvailable(f.css);
        const tag = f.use === 'ok' ? ' ✓' : f.use === 'bad' ? ' ✗需授权' : '';
        return `<option value="${f.label}" ${l.fontLabel === f.label ? 'selected' : ''}>${f.label}${tag}${avail ? '' : '（未安装）'}</option>`;
      }).join('');

      const curFont = FONTS.find((f) => f.label === l.fontLabel) || FONTS[0];
      const useNote = curFont.use === 'ok'
        ? '可商用字体，放心用'
        : curFont.use === 'bad'
          ? '这款字体商用需授权，字体公司索赔很常见'
          : '系统字体，商用需自行确认授权';

      parts.push(`
        <div class="cv-group">
          <div class="cv-group-title">文字样式</div>
          <div class="cv-row">
            <div class="cv-num"><label>字体</label>
              <select data-k="fontLabel">${fontOpts}</select>
              <div class="cv-font-note ${curFont.use === 'ok' ? '' : curFont.use === 'bad' ? 'is-bad' : 'is-warn'}">${useNote}</div>
            </div>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>字号</label><input type="number" data-k="size" value="${Math.round(l.size)}" min="8" max="400"></div>
            <div class="cv-num"><label>字重</label>
              <select data-k="weight">
                ${[300, 400, 500, 600, 700, 800, 900].map((w) => `<option value="${w}" ${Number(l.weight) === w ? 'selected' : ''}>${w}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>行高</label><input type="number" data-k="lineHeight" value="${l.lineHeight}" step="0.05" min="0.8" max="3"></div>
            <div class="cv-num"><label>字距</label><input type="number" data-k="letterSpacing" value="${l.letterSpacing}" step="0.5" min="-10" max="30"></div>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>文字颜色</label>
              <div class="cv-color-row">
                <input type="color" class="cv-color" data-k="color" value="${toHex(l.color)}">
                <input type="text" class="cv-color-hex" data-k="colorhex" value="${l.color}">
              </div>
            </div>
          </div>
          ${contrastNote(l)}
        </div>

        <div class="cv-group">
          <div class="cv-group-title">描边</div>
          <div class="cv-toggles">
            <button class="cv-toggle ${l.strokeEnabled ? 'is-on' : ''}" data-toggle="strokeEnabled">${l.strokeEnabled ? '已开启' : '关闭'}</button>
          </div>
          ${l.strokeEnabled ? `
          <div class="cv-range-row" style="margin-top:8px"><label>粗细</label>
            <input type="range" data-k="strokeWidth" min="1" max="20" value="${l.strokeWidth}">
            <b>${l.strokeWidth}</b>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>描边色</label>
              <div class="cv-color-row">
                <input type="color" class="cv-color" data-k="strokeColor" value="${toHex(l.strokeColor)}">
                <input type="text" class="cv-color-hex" data-k="strokeColorhex" value="${l.strokeColor}">
              </div>
            </div>
          </div>` : ''}
        </div>

        <div class="cv-group">
          <div class="cv-group-title">阴影</div>
          <div class="cv-toggles">
            <button class="cv-toggle ${l.shadowEnabled ? 'is-on' : ''}" data-toggle="shadowEnabled">${l.shadowEnabled ? '已开启' : '关闭'}</button>
          </div>
          ${l.shadowEnabled ? `
          <div class="cv-range-row" style="margin-top:8px"><label>模糊</label>
            <input type="range" data-k="shadowBlur" min="0" max="60" value="${l.shadowBlur}">
            <b>${l.shadowBlur}</b>
          </div>
          <div class="cv-range-row"><label>下移</label>
            <input type="range" data-k="shadowY" min="-30" max="30" value="${l.shadowY}">
            <b>${l.shadowY}</b>
          </div>` : ''}
        </div>

        <div class="cv-group">
          <div class="cv-group-title">文字背景块</div>
          <div class="cv-toggles">
            <button class="cv-toggle ${l.bgEnabled ? 'is-on' : ''}" data-toggle="bgEnabled">${l.bgEnabled ? '已开启' : '关闭'}</button>
          </div>
          ${l.bgEnabled ? `
          <div class="cv-row" style="margin-top:8px">
            <div class="cv-num"><label>底色</label>
              <div class="cv-color-row">
                <input type="color" class="cv-color" data-k="bgColor" value="${toHex(l.bgColor)}">
                <input type="text" class="cv-color-hex" data-k="bgColorhex" value="${l.bgColor}">
              </div>
            </div>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>圆角</label><input type="number" data-k="bgRadius" value="${l.bgRadius}" min="0" max="80"></div>
            <div class="cv-num"><label>内边距</label><input type="number" data-k="bgPadX" value="${l.bgPadX}" min="0" max="120"></div>
          </div>` : ''}
        </div>
      `);
    }

    /* 图片专属 */
    if (l.type === 'image') {
      const fitOpts = [['cover', '填满裁剪'], ['contain', '完整显示'], ['fill', '拉伸']];
      parts.push(`
        <div class="cv-group">
          <div class="cv-group-title">图片</div>
          <button class="btn btn-sm" data-act="replace-img" style="width:100%;margin-bottom:8px">替换图片</button>
          <div class="cv-seg" data-seg="fit">
            ${fitOpts.map(([v, t]) => `<button data-v="${v}" class="${l.fit === v ? 'is-on' : ''}">${t}</button>`).join('')}
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>圆角</label><input type="number" data-k="radius" value="${l.radius}" min="0" max="200"></div>
          </div>
        </div>
      `);
    }

    /* 矩形专属 */
    if (l.type === 'rect') {
      parts.push(`
        <div class="cv-group">
          <div class="cv-group-title">形状</div>
          <div class="cv-seg" data-seg="shape">
            <button data-v="rect" class="${l.shape !== 'ellipse' ? 'is-on' : ''}">矩形</button>
            <button data-v="ellipse" class="${l.shape === 'ellipse' ? 'is-on' : ''}">椭圆</button>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>填充</label>
              <div class="cv-color-row">
                <input type="color" class="cv-color" data-k="fill" value="${toHex(l.fill)}">
                <input type="text" class="cv-color-hex" data-k="fillhex" value="${l.fill}">
              </div>
            </div>
          </div>
          <div class="cv-row">
            <div class="cv-num"><label>圆角</label><input type="number" data-k="radius" value="${l.radius}" min="0" max="500"></div>
            <div class="cv-num"><label>边框</label><input type="number" data-k="borderWidth" value="${l.borderWidth}" min="0" max="40"></div>
          </div>
        </div>
      `);
    }

    /* 位置与尺寸：所有专属属性之后 */
    parts.push(posBlock);

    /* 图层操作 */
    parts.push(`
      <div class="cv-group">
        <div class="cv-group-title">图层操作</div>
        <div class="cv-toggles" style="margin-bottom:7px">
          <button class="cv-toggle" data-act="up">上移一层</button>
          <button class="cv-toggle" data-act="down">下移一层</button>
        </div>
        <div class="cv-toggles">
          <button class="cv-toggle" data-act="dup">复制</button>
          <button class="cv-toggle" data-act="del" style="color:#c9252d">删除</button>
        </div>
      </div>
    `);

    /* 画布背景永远在面板最底部 */
    parts.push(bgBlock());

    box.innerHTML = parts.join('');
    bindLayers();
    bindInspector(l);
    bindCharPanel(l);
    bindCanvasInspector();
  }

  function toHex(c) {
    if (!c) return '#000000';
    if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
      if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      return c;
    }
    const m = String(c).match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const h = (n) => Number(n).toString(16).padStart(2, '0');
      return '#' + h(m[1]) + h(m[2]) + h(m[3]);
    }
    return '#000000';
  }

  function contrastNote(l) {
    const cr = textContrast(l);
    const cls = cr < 3 ? 'is-bad' : cr < 4.5 ? 'is-warn' : '';
    const tip = cr < 3 ? '太低，手机上基本看不清' : cr < 4.5 ? '偏弱，建议加深颜色或加描边' : '清晰';
    return `<div class="cv-font-note ${cls}">对比度 ${cr.toFixed(2)}:1 · ${tip}</div>`;
  }

  /* 逐字着色面板：点字选中，再点色块上色 */
  function charPanel(l) {
    if (!S.charSel) S.charSel = new Set();
    const chars = Array.from(String(l.text));
    const colored = l.charColors || {};

    const chips = chars.map((ch, i) => {
      if (ch === '\n') return '<span class="cv-char-gap"></span>';
      const isSpace = ch === ' ';
      const col = colored[i];
      const sel = S.charSel.has(i);
      return `<button class="cv-char ${sel ? 'is-sel' : ''} ${isSpace ? 'is-space' : ''}" data-ci="${i}"`
        + (col ? ` style="color:${col}"` : '')
        + `>${isSpace ? '␣' : escapeHtml(ch)}</button>`;
    }).join('');

    const palette = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#facc15', '#ffffff']
      .map((c) => `<button class="cv-swatch" data-cc="${c}" style="background:${c}" title="${c}"></button>`).join('');

    const nSel = S.charSel.size;

    return `<div class="cv-group">
      <div class="cv-group-title">逐字着色
        <span style="font-weight:400;color:#8b949e">${nSel ? '已选 ' + nSel + ' 字' : '先点字选中'}</span>
      </div>
      <div class="cv-char-row">${chips || '<span class="cv-font-note">文字为空</span>'}</div>
      <div class="cv-swatch-row">
        ${palette}
        <input type="color" class="cv-swatch-pick" data-cc="custom" value="#ffffff" title="自定义颜色">
      </div>
      <div class="cv-toggles" style="margin-top:8px">
        <button class="cv-toggle" data-cact="all">全选</button>
        <button class="cv-toggle" data-cact="none">取消</button>
        <button class="cv-toggle" data-cact="reset" style="color:#c9252d">清除着色</button>
      </div>
    </div>`;
  }

  function applyCharColor(l, color) {
    if (!S.charSel || !S.charSel.size) {
      WG.toast('先点文字选几个字');
      return;
    }
    if (!l.charColors) l.charColors = {};
    S.charSel.forEach((i) => { l.charColors[i] = color; });
    pushHistory();
    renderStage();
    renderInspector();
  }

  /* 逐字着色：单个字符滚轮换色，避开同层已用的颜色 */
  const CHAR_PALETTE = [
    '#ffffff', '#0f172a', '#ef4444', '#f59e0b',
    '#10b981', '#2563eb', '#8b5cf6', '#ec4899',
    '#facc15', '#22d3ee', '#a3e635', '#fb923c',
  ];

  function cycleCharColor(l, idx, dir) {
    if (!l.charColors) l.charColors = {};

    // 其它字符已经用掉的颜色，本次尽量避开
    const used = new Set(
      Object.keys(l.charColors)
        .filter((k) => Number(k) !== idx)
        .map((k) => String(l.charColors[k]).toLowerCase())
    );

    const cur = String(l.charColors[idx] || l.color || '').toLowerCase();
    let start = CHAR_PALETTE.findIndex((c) => c.toLowerCase() === cur);
    if (start < 0) start = 0;

    let picked = CHAR_PALETTE[start];
    for (let step = 1; step <= CHAR_PALETTE.length; step++) {
      const cand = CHAR_PALETTE[(start + dir * step + CHAR_PALETTE.length * 2) % CHAR_PALETTE.length];
      if (!used.has(cand.toLowerCase())) { picked = cand; break; }
    }

    l.charColors[idx] = picked;
    renderStage();

    // 只改这个字块的显示色，不重建整个面板，免得打断滚动
    const chip = $(`#cv-inspector .cv-char[data-ci="${idx}"]`);
    if (chip) chip.style.color = picked;

    clearTimeout(cycleCharColor._t);
    cycleCharColor._t = setTimeout(() => pushHistory(), 420);
    WG.toast('第 ' + (idx + 1) + ' 字 ' + picked);
  }

  function bindCharPanel(l) {
    const box = $('#cv-inspector');
    if (!box || !l || l.type !== 'text') return;
    if (!S.charSel) S.charSel = new Set();

    box.querySelectorAll('.cv-char[data-ci]').forEach((btn) => {
      const idx = Number(btn.dataset.ci);

      btn.addEventListener('click', () => {
        if (S.charSel.has(idx)) S.charSel.delete(idx);
        else S.charSel.add(idx);
        renderInspector();
      });

      // 悬在这个字块上滚轮 → 单独换这个字的颜色
      btn.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleCharColor(l, idx, e.deltaY < 0 ? -1 : 1);
      }, { passive: false });
    });

    box.querySelectorAll('.cv-swatch[data-cc]').forEach((btn) => {
      btn.addEventListener('click', () => applyCharColor(l, btn.dataset.cc));
    });

    const pick = box.querySelector('[data-cc="custom"]');
    if (pick) pick.addEventListener('input', () => applyCharColor(l, pick.value));

    box.querySelectorAll('[data-cact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.cact;
        const len = Array.from(String(l.text)).length;
        if (act === 'all') {
          S.charSel = new Set();
          for (let i = 0; i < len; i++) S.charSel.add(i);
        }
        if (act === 'none') S.charSel = new Set();
        if (act === 'reset') {
          l.charColors = {};
          S.charSel = new Set();
          pushHistory();
          renderStage();
        }
        renderInspector();
      });
    });
  }

  function bindInspector(l) {
    const box = $('#cv-inspector');

    // 数值 / 文本 / 颜色输入
    box.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;

      const apply = (raw) => {
        let v = raw;
        let key = k;

        if (k.endsWith('hex')) {
          key = k.replace('hex', '');
          v = String(raw).trim();
          if (!/^#?[0-9a-fA-F]{3,8}$/.test(v.replace('#', ''))) return;
          if (!v.startsWith('#')) v = '#' + v;
        } else if (k === 'opacity') {
          v = num(raw, 100) / 100;
        } else if (k === 'fontLabel') {
          const f = FONTS.find((x) => x.label === raw);
          updateLayer(l.id, { fontLabel: raw, font: f ? f.css : raw }, { silent: true });
          renderStage(); renderInspector();
          return;
        } else if (['text', 'align'].includes(k)) {
          v = raw;
        } else if (['color', 'strokeColor', 'bgColor', 'fill', 'borderColor'].includes(k)) {
          v = raw;
        } else {
          v = num(raw, 0);
        }

        updateLayer(l.id, { [key]: v }, { silent: true });
        renderStage();
        if (k === 'text' || k === 'size' || k === 'lineHeight' || k === 'letterSpacing') {
          updateSelHint();
        }
        if (['rot', 'opacity'].includes(k)) {
          const b = el.parentNode.querySelector('b');
          if (b) b.textContent = k === 'opacity' ? Math.round(v * 100) + '%' : Math.round(v) + '°';
        }
        if (['strokeWidth', 'shadowBlur', 'shadowY'].includes(k)) {
          const b = el.parentNode.querySelector('b');
          if (b) b.textContent = v;
        }
      };

      if (el.type === 'range' || el.tagName === 'SELECT') {
        el.addEventListener('input', () => apply(el.value));
        el.addEventListener('change', () => { apply(el.value); pushHistory(); });
      } else {
        el.addEventListener('input', () => apply(el.value));
        // 不重建面板，否则输入完按 Tab 会掉焦点
        el.addEventListener('change', () => { apply(el.value); pushHistory(); });
      }
    });

    // 分段选择
    box.querySelectorAll('[data-seg]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = seg.dataset.seg;
          updateLayer(l.id, { [key]: btn.dataset.v });
          pushHistory();
          renderInspector();
        });
      });
    });

    // 开关
    box.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        updateLayer(l.id, { [key]: !l[key] });
        pushHistory();
        renderInspector();
      });
    });

    // 图层操作
    box.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'up') moveLayer(l.id, 1);
        if (act === 'down') moveLayer(l.id, -1);
        if (act === 'dup') duplicateLayer(l.id);
        if (act === 'del') deleteLayer(l.id);
        if (act === 'replace-img') pickImageFor(l.id);
      });
    });
  }

  function bindCanvasInspector() {
    const box = $('#cv-inspector');
    if (!box) return;

    const COLOR_KEYS = ['c1', 'c2', 'c3', 'c4'];

    box.querySelectorAll('[data-canvas]').forEach((el) => {
      const k = el.dataset.canvas;
      const apply = (raw) => {
        if (k === 'w' || k === 'h') {
          const v = clamp(num(raw, S[k]), 100, 4000);
          S[k] = v;
          S.presetId = 'custom';
          renderStage(); updateDims(); applyZoom(S.zoom, true); renderSizeList();
          return;
        }

        if (COLOR_KEYS.includes(k)) {
          if (S.bg.type !== 'corners' && k !== 'c1' && k !== 'c2') S.bg.type = 'corners';
          S.bg[k] = raw;
          renderStage();
          syncCornerColors();
          return;
        }

        if (k.endsWith('hex') && COLOR_KEYS.includes(k.replace('hex', ''))) {
          const key = k.replace('hex', '');
          let v = String(raw).trim();
          if (!/^#?[0-9a-fA-F]{3,8}$/.test(v.replace('#', ''))) return;
          if (!v.startsWith('#')) v = '#' + v;
          if (S.bg.type !== 'corners' && key !== 'c1' && key !== 'c2') S.bg.type = 'corners';
          S.bg[key] = v;
          renderStage();
          syncCornerColors();
          renderInspector();
          return;
        }

        if (k === 'angle') {
          S.bg.angle = num(raw, 135);
          renderStage();
          const b = el.parentNode.querySelector('b');
          if (b) b.textContent = S.bg.angle + '°';
        }
      };
      el.addEventListener('input', () => apply(el.value));
      el.addEventListener('change', () => { apply(el.value); pushHistory(); });
    });

    box.querySelectorAll('[data-seg="bgtype"] button').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.bg.type = btn.dataset.v;
        if (S.bg.type === 'corners') ensureDistinctCorners();
        pushHistory();
        renderStage();
        syncCornerColors();
        renderInspector();
      });
    });
  }

  /* ============================================================
   * 画布交互
   * ============================================================ */

  function pointerPos(e) {
    const stage = $('#cv-stage');
    const r = stage.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / S.zoom,
      y: (e.clientY - r.top) / S.zoom,
    };
  }

  /* 事件委托。
     renderStage 每次都 canvas.innerHTML='' 重建图层 DOM，
     所以监听只能挂在不会被重建的 canvas 上，不能绑到图层元素上。 */
  function bindStageEvents() {
    const canvas = $('#cv-canvas');
    if (!canvas || canvas.__delegated) return;
    canvas.__delegated = true;

    canvas.addEventListener('pointerdown', (e) => {
      // ⓪ 正在画布内编辑文字：别抢焦点、别拖动
      if (e.target.closest && e.target.closest('.cv-inline-edit')) return;

      // ① 控制点优先：否则拖右下角会变成拖整个图层
      const handle = e.target.closest ? e.target.closest('.cv-handle') : null;
      if (handle) {
        const host = handle.closest('.cv-el');
        const l = host && getLayer(host.dataset.id);
        if (!l || l.locked) return;
        e.preventDefault();
        e.stopPropagation();
        if (l.id !== S.sel) selectLayer(l.id);
        if (handle.dataset.h === 'rot') startRotate(e, l);
        else startResize(e, l, handle.dataset.h);
        return;
      }

      // ② 图层本体
      const el = e.target.closest ? e.target.closest('.cv-el') : null;
      if (el) {
        const l = getLayer(el.dataset.id);
        if (!l) return;
        if (l.locked) { selectLayer(l.id); return; }
        e.preventDefault();
        e.stopPropagation();
        if (l.id !== S.sel) selectLayer(l.id);
        startDrag(e, l);
        return;
      }

      // ③ 空白：取消选中
      if (e.target === canvas || (e.target === canvas.parentNode)) {
        selectLayer(null);
      }
    });

    canvas.addEventListener('dblclick', (e) => {
      const el = e.target.closest ? e.target.closest('.cv-el') : null;
      if (!el) return;
      const l = getLayer(el.dataset.id);
      if (!l) return;
      if (l.type === 'text') {
        e.preventDefault();
        startInlineTextEdit(l);
      } else if (l.type === 'image') {
        pickImageFor(l.id);
      }
    });
  }

  /**
   * 画布内直接改文字：双击文字图层 → 原地出现输入框
   * Enter 换行，Ctrl/⌘+Enter 或点别处提交，Esc 取消
   */
  function startInlineTextEdit(l) {
    if (!l || l.locked) {
      if (l) selectLayer(l.id);
      return;
    }

    // 已经在编辑就不重复开
    if (document.querySelector('.cv-inline-edit')) return;

    // 先选中，让属性面板跟着同步
    if (l.id !== S.sel) {
      S.sel = l.id;
      S.charSel = new Set();
      renderStage();
      renderInspector();
    }

    const host = document.querySelector(`#cv-canvas .cv-el[data-id="${l.id}"]`);
    if (!host) return;

    const ta = document.createElement('textarea');
    ta.className = 'cv-inline-edit';
    ta.value = l.text;
    ta.spellcheck = false;

    ta.style.cssText = [
      'position:absolute',
      'left:-4px',
      'top:-4px',
      `width:${l.w}px`,
      'height:auto',
      `min-height:${Math.max(Math.round(l.size * 1.3), 24)}px`,
      `font-family:${l.font}`,
      `font-size:${l.size}px`,
      `font-weight:${l.weight}`,
      `line-height:${l.lineHeight}`,
      `letter-spacing:${l.letterSpacing}px`,
      `text-align:${l.align}`,
      'color:#0f172a',
      'background:rgba(255,255,255,.97)',
      'border:2px solid #429ef5',
      'border-radius:5px',
      'padding:3px 5px',
      'outline:none',
      'resize:none',
      'overflow:hidden',
      'white-space:pre-wrap',
      'word-break:break-word',
      'box-sizing:border-box',
      'box-shadow:0 6px 24px rgba(0,0,0,.28)',
      'z-index:9999',
      'caret-color:#429ef5',
    ].join(';');

    host.appendChild(ta);

    const autoGrow = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.max(ta.scrollHeight, 24) + 'px';
    };
    ta.addEventListener('input', autoGrow);
    autoGrow();

    ta.focus();
    ta.select();

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;

      const val = ta.value;
      ta.remove();

      if (commit && val !== l.text) {
        l.text = val;
        // 文字变了，原来的逐字着色索引对不上了，清掉免得串色
        l.charColors = {};
        if (S.charSel && S.charSel.size) S.charSel = new Set();
        pushHistory();
        WG.toast('文字已更新');
      }

      renderStage();
      renderInspector();
    };

    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        finish(true);
      }
    });
  }

  function startDrag(e, l) {
    const start = { mx: e.clientX, my: e.clientY, x: l.x, y: l.y };
    let moved = false;

    const onMove = (ev) => {
      moved = true;
      const dx = (ev.clientX - start.mx) / S.zoom;
      const dy = (ev.clientY - start.my) / S.zoom;
      l.x = Math.round(start.x + dx);
      l.y = Math.round(start.y + dy);
      if (S.snap) doSnap(l);
      paintLayer(l);
      updateSelHint();
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      clearGuides();
      if (moved) pushHistory();
      renderInspector();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function startResize(e, l, dir) {
    const start = {
      mx: e.clientX, my: e.clientY,
      x: l.x, y: l.y, w: l.w, h: l.h,
      size: l.size || 0,
    };

    const onMove = (ev) => {
      const dx = (ev.clientX - start.mx) / S.zoom;
      const dy = (ev.clientY - start.my) / S.zoom;

      const left = dir.includes('w');
      const top = dir.includes('n');

      let w = start.w + (left ? -dx : dx);
      let h = start.h + (top ? -dy : dy);

      // 文字层：按比例改字号，宽度跟着变
      if (l.type === 'text') {
        const ratio = start.w ? w / start.w : 1;
        l.w = Math.max(40, Math.round(start.w * ratio));
        l.size = Math.max(8, Math.round(start.size * ratio));
        l.x = Math.round(left ? start.x + (start.w - l.w) : start.x);
      } else {
        w = Math.max(12, w);
        h = Math.max(12, h);
        l.w = Math.round(w);
        l.h = Math.round(h);
        if (left) l.x = Math.round(start.x + (start.w - l.w));
        if (top) l.y = Math.round(start.y + (start.h - l.h));
      }

      if (S.snap) doSnap(l);
      paintLayer(l);
      updateSelHint();
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      clearGuides();
      pushHistory();
      renderInspector();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function startRotate(e, l) {
    const stage = $('#cv-stage');
    const r = stage.getBoundingClientRect();
    const cx = r.left + (l.x + l.w / 2) * S.zoom;
    const cy = r.top + (l.y + l.h / 2) * S.zoom;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    const startRot = l.rot;

    const onMove = (ev) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
      let rot = startRot + (a - startAngle);
      if (Math.abs(rot % 90) < 3) rot = Math.round(rot / 90) * 90;
      l.rot = Math.round(rot);
      paintLayer(l);
      const b = $('#cv-inspector b');
      updateSelHint();
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      pushHistory();
      renderInspector();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* 局部刷新单个图层（拖动时不重建整个 DOM） */
  function paintLayer(l) {
    const el = $(`#cv-canvas .cv-el[data-id="${l.id}"]`);
    if (!el) return;
    el.style.left = l.x + 'px';
    el.style.top = l.y + 'px';
    el.style.width = l.w + 'px';
    el.style.transform = `rotate(${l.rot}deg)`;
    if (l.type !== 'text') el.style.height = l.h + 'px';
    else if (l.size) {
      el.style.fontSize = l.size + 'px';
      l.h = el.offsetHeight;
    }
  }

  /* ---------- 吸附 ---------- */

  function doSnap(l) {
    // 背景铺满画布，一吸附就会被反复拉回原点，等于拖不动
    if (l.isBg) return;
    const thr = 8 / S.zoom;
    const gx = [];
    const gy = [];

    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;

    // 画布中心
    if (Math.abs(cx - S.w / 2) < thr) { l.x = Math.round(S.w / 2 - l.w / 2); gx.push(S.w / 2); }
    if (Math.abs(cy - S.h / 2) < thr) { l.y = Math.round(S.h / 2 - l.h / 2); gy.push(S.h / 2); }

    // 画布边缘
    if (Math.abs(l.x) < thr) { l.x = 0; gx.push(0); }
    if (Math.abs(l.x + l.w - S.w) < thr) { l.x = S.w - l.w; gx.push(S.w); }
    if (Math.abs(l.y) < thr) { l.y = 0; gy.push(0); }
    if (Math.abs(l.y + l.h - S.h) < thr) { l.y = S.h - l.h; gy.push(S.h); }

    // 与其他图层的边缘/中心对齐
    S.layers.forEach((o) => {
      if (o.id === l.id || !o.visible) return;
      const ox = [o.x, o.x + o.w / 2, o.x + o.w];
      const oy = [o.y, o.y + o.h / 2, o.y + o.h];
      const lx = [l.x, l.x + l.w / 2, l.x + l.w];
      const ly = [l.y, l.y + l.h / 2, l.y + l.h];

      ox.forEach((t, i) => {
        lx.forEach((c, j) => {
          if (Math.abs(c - t) < thr) {
            l.x = Math.round(l.x + (t - c));
            gx.push(t);
          }
        });
      });
      oy.forEach((t) => {
        ly.forEach((c) => {
          if (Math.abs(c - t) < thr) {
            l.y = Math.round(l.y + (t - c));
            gy.push(t);
          }
        });
      });
    });

    drawGuides(gx, gy);
  }

  function drawGuides(gx, gy) {
    const stage = $('#cv-stage');
    if (!stage) return;
    stage.querySelectorAll('.cv-guide').forEach((g) => g.remove());
    const uniq = (a) => Array.from(new Set(a.map((v) => Math.round(v))));
    uniq(gx).forEach((x) => {
      const d = document.createElement('div');
      d.className = 'cv-guide v';
      d.style.left = x + 'px';
      stage.appendChild(d);
    });
    uniq(gy).forEach((y) => {
      const d = document.createElement('div');
      d.className = 'cv-guide h';
      d.style.top = y + 'px';
      stage.appendChild(d);
    });
  }

  function clearGuides() {
    const stage = $('#cv-stage');
    if (stage) stage.querySelectorAll('.cv-guide').forEach((g) => g.remove());
  }

  /* ============================================================
   * 图层操作
   * ============================================================ */

  function selectLayer(id) {
    const next = id && getLayer(id) ? id : null;
    if (next !== S.sel) S.charSel = new Set();
    S.sel = next;
    renderStage();
    renderInspector();
    updateSelHint();
  }

  function addLayer(type) {
    let l;
    if (type === 'text') l = textLayer();
    else if (type === 'rect') l = shapeLayer();
    else if (type === 'circle') {
      const d = Math.round(Math.min(S.w, S.h) * 0.3);
      l = shapeLayer({
        name: '圆形', shape: 'ellipse', fill: '#1f6feb',
        w: d, h: d,
        x: Math.round((S.w - d) / 2), y: Math.round((S.h - d) / 2),
      });
    } else if (type === 'line') {
      l = shapeLayer({
        name: '线条',
        h: Math.max(4, Math.round(S.h * 0.012)),
        w: Math.round(S.w * 0.4),
        radius: 100,
        x: Math.round(S.w * 0.1),
        y: Math.round(S.h * 0.5),
      });
    } else if (type === 'image') {
      pickImageFor(null, 'layer');
      return;
    }
    S.layers.push(l);
    S.sel = l.id;
    pushHistory();
    renderAll();
    WG.toast('已添加' + (l.name || '图层'));
  }

  function deleteLayer(id) {
    const idx = S.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    S.layers.splice(idx, 1);
    if (S.sel === id) S.sel = S.layers.length ? S.layers[S.layers.length - 1].id : null;
    pushHistory();
    renderAll();
  }

  function duplicateLayer(id) {
    const l = getLayer(id);
    if (!l) return;
    const copy = JSON.parse(JSON.stringify(l));
    copy.id = uid('L');
    copy.x += 24;
    copy.y += 24;
    copy.name = (l.name || '图层') + ' 副本';
    S.layers.push(copy);
    S.sel = copy.id;
    pushHistory();
    renderAll();
    WG.toast('已复制图层');
  }

  function moveLayer(id, dir) {
    const idx = S.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= S.layers.length) return WG.toast(dir > 0 ? '已经在最上层' : '已经在最下层');
    const [item] = S.layers.splice(idx, 1);
    S.layers.splice(to, 0, item);
    pushHistory();
    renderAll();
  }

  /* ============================================================
   * 图片
   * ============================================================ */

  let pendingImgId = null;
  let pendingImgMode = 'layer';   // 'bg' = 铺满画布的背景；'layer' = 可自由拖动的图片图层

  /**
   * @param {string|null} id     传 id 表示替换该图层已有的图
   * @param {'bg'|'layer'} mode  未传 id 时决定新图片的形态
   */
  function pickImageFor(id, mode) {
    pendingImgId = id || null;
    pendingImgMode = id ? 'replace' : (mode || 'layer');
    const inp = $('#cv-file');
    if (inp) inp.click();
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    });
  }

  function imageSize(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 });
      im.onerror = () => resolve({ w: 0, h: 0 });
      im.src = src;
    });
  }

  async function handleFile(file) {
    if (!file) return;
    const src = await readFileAsDataURL(file);
    if (!src) return WG.toast('图片读取失败');

    /* ① 替换某个图层已有的图 */
    if (pendingImgId && getLayer(pendingImgId)) {
      updateLayer(pendingImgId, { src });
      pushHistory();
      WG.toast('图片已替换');
      pendingImgId = null;
      return;
    }

    const size = await imageSize(src);

    /* ② 设为背景：铺满画布、只保留一张、放最底层、不参与吸附 */
    if (pendingImgMode === 'bg') {
      const bg = imageLayer(src, {
        name: '背景图',
        isBg: true,
        fit: 'cover',
        x: 0, y: 0, w: S.w, h: S.h,
      });
      S.layers = S.layers.filter((l) => !l.isBg);   // 换背景而不是叠一层
      S.layers.unshift(bg);
      S.sel = bg.id;
      pushHistory();
      renderAll();
      WG.toast('背景已设置：铺满画布，可在图层列表里选中替换');
      pendingImgId = null;
      return;
    }

    /* ③ 普通图片图层：按原图比例，画布 45% 宽，居中，可自由拖动缩放 */
    const ratio = size.w && size.h ? size.h / size.w : 0.75;
    const w = Math.round(S.w * 0.45);
    const h = Math.max(20, Math.round(w * ratio));
    const layer = imageLayer(src, {
      name: String(file.name || '图片').replace(/\.[^.]+$/, '').slice(0, 14) || '图片',
      fit: 'cover',
      w, h,
      x: Math.round((S.w - w) / 2),
      y: Math.round((S.h - h) / 2),
    });

    // 插在当前选中图层之上，免得一加就被压在底下点不到
    const selIdx = S.layers.findIndex((x) => x.id === S.sel);
    if (selIdx >= 0) S.layers.splice(selIdx + 1, 0, layer);
    else S.layers.push(layer);

    S.sel = layer.id;
    pushHistory();
    renderAll();
    WG.toast('已添加图片图层，可拖动和缩放');
    pendingImgId = null;
  }

  /* ============================================================
   * 模板
   * ============================================================ */

  const TEMPLATES = [
    {
      id: 'bigword',
      name: '深底大字',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'gradient', c1: '#0f172a', c2: '#1e3a8a', angle: 135 },
          layers: [
            textLayer({
              name: '主标题', text: '三天看懂\n基金定投',
              size: Math.round(m * 0.15), weight: 900, color: '#ffffff',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.22), align: 'left',
              shadowEnabled: true, shadowBlur: 20,
            }),
            textLayer({
              name: '副标题', text: '从 0 开始的稳健理财路径',
              size: Math.round(m * 0.048), weight: 500, color: '#93c5fd',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.76), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'split',
      name: '左文右图',
      build(W, H) {
        const m = Math.min(W, H);
        const isWide = W > H;
        return {
          bg: { type: 'solid', c1: '#111827', c2: '#111827', angle: 0 },
          layers: [
            shapeLayer({
              name: '图片区（双击换图）', fill: '#2b3a52', radius: 0,
              x: isWide ? Math.round(W * 0.52) : 0,
              y: isWide ? 0 : Math.round(H * 0.42),
              w: isWide ? Math.round(W * 0.48) : W,
              h: isWide ? H : Math.round(H * 0.58),
            }),
            textLayer({
              name: '主标题', text: '效率工具\n横评报告',
              size: Math.round(m * 0.105), weight: 900, color: '#ffffff',
              w: Math.round((isWide ? W * 0.44 : W * 0.86)),
              x: Math.round(isWide ? W * 0.06 : W * 0.07),
              y: Math.round(isWide ? H * 0.28 : H * 0.08),
              align: 'left',
            }),
            textLayer({
              name: '副标题', text: '六款主流工具，两周实测',
              size: Math.round(m * 0.038), weight: 500, color: '#94a3b8',
              w: Math.round((isWide ? W * 0.44 : W * 0.86)),
              x: Math.round(isWide ? W * 0.06 : W * 0.07),
              y: Math.round(isWide ? H * 0.72 : H * 0.30),
              align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'band',
      name: '色带压底',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#f5f5f4', c2: '#f5f5f4', angle: 0 },
          layers: [
            shapeLayer({
              name: '色带', fill: '#1f6feb', radius: 0,
              x: 0, y: Math.round(H * 0.62), w: W, h: Math.round(H * 0.38),
            }),
            textLayer({
              name: '主标题', text: 'Notion 数据库\n实战手册',
              size: Math.round(m * 0.13), weight: 900, color: '#111827',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.14), align: 'left',
            }),
            textLayer({
              name: '副标题', text: '一份可以直接抄的模板',
              size: Math.round(m * 0.055), weight: 600, color: '#ffffff',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.74), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'minimal',
      name: '极简留白',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            shapeLayer({
              name: '细线', fill: '#111827', radius: 100,
              x: Math.round(W * 0.08), y: Math.round(H * 0.30),
              w: Math.round(W * 0.14), h: Math.max(3, Math.round(m * 0.008)),
            }),
            textLayer({
              name: '主标题', text: '慢一点\n也没关系',
              size: Math.round(m * 0.11), weight: 700, color: '#111827',
              w: Math.round(W * 0.7), x: Math.round(W * 0.08),
              y: Math.round(H * 0.38), align: 'left',
            }),
            textLayer({
              name: '小字', text: '关于效率焦虑的一点观察',
              size: Math.round(m * 0.04), weight: 400, color: '#8b8b8b',
              w: Math.round(W * 0.7), x: Math.round(W * 0.08),
              y: Math.round(H * 0.76), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'magazine',
      name: '杂志线框',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.05);
        return {
          bg: { type: 'solid', c1: '#0b0b0f', c2: '#0b0b0f', angle: 0 },
          layers: [
            shapeLayer({
              name: '外框', fill: 'transparent', borderWidth: Math.max(2, Math.round(m * 0.004)),
              borderColor: '#e5e7eb', radius: 0,
              x: pad, y: pad, w: W - pad * 2, h: H - pad * 2,
            }),
            textLayer({
              name: '主标题', text: 'ISSUE 32',
              size: Math.round(m * 0.16), weight: 300, color: '#ffffff',
              letterSpacing: Math.round(m * 0.008),
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.34), align: 'left',
            }),
            textLayer({
              name: '副标题', text: '效率工具的边界在哪里',
              size: Math.round(m * 0.038), weight: 500, color: '#9ca3af',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.68), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'dualblock',
      name: '双色对比',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            shapeLayer({
              name: '左块', fill: '#1f6feb', radius: 0,
              x: 0, y: 0, w: Math.round(W * 0.5), h: H,
            }),
            shapeLayer({
              name: '右块', fill: '#0f172a', radius: 0,
              x: Math.round(W * 0.5), y: 0, w: Math.round(W * 0.5), h: H,
            }),
            textLayer({
              name: '左侧字', text: 'A', size: Math.round(m * 0.26), weight: 900, color: '#ffffff',
              w: Math.round(W * 0.46), x: Math.round(W * 0.02),
              y: Math.round(H * 0.34), align: 'center',
            }),
            textLayer({
              name: '右侧字', text: 'B', size: Math.round(m * 0.26), weight: 900, color: '#ffffff',
              w: Math.round(W * 0.46), x: Math.round(W * 0.52),
              y: Math.round(H * 0.34), align: 'center',
            }),
          ],
        };
      },
    },
    {
      id: 'outline',
      name: '描边大字',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'gradient', c1: '#f97316', c2: '#ec4899', angle: 135 },
          layers: [
            textLayer({
              name: '主标题', text: '别再\n手动整理',
              size: Math.round(m * 0.17), weight: 900, color: 'rgba(255,255,255,0)',
              strokeEnabled: true, strokeWidth: Math.max(2, Math.round(m * 0.006)),
              strokeColor: '#ffffff',
              w: Math.round(W * 0.9), x: Math.round(W * 0.05),
              y: Math.round(H * 0.16), align: 'left',
            }),
            textLayer({
              name: '副标题', text: '三个自动化脚本省下每天一小时',
              size: Math.round(m * 0.042), weight: 600, color: '#ffffff',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.74), align: 'left',
              bgEnabled: true, bgColor: 'rgba(0,0,0,.28)', bgRadius: 999, bgPadX: Math.round(W*0.03),
            }),
          ],
        };
      },
    },
    {
      id: 'numbered',
      name: '序号清单',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#fffbeb', c2: '#fffbeb', angle: 0 },
          layers: [
            textLayer({
              name: '序号', text: '01', size: Math.round(m * 0.22), weight: 900, color: '#f59e0b',
              w: Math.round(W * 0.3), x: Math.round(W * 0.06),
              y: Math.round(H * 0.06), align: 'left',
            }),
            textLayer({
              name: '主标题', text: '选题库\n搭建方法',
              size: Math.round(m * 0.11), weight: 800, color: '#1c1917',
              w: Math.round(W * 0.66), x: Math.round(W * 0.06),
              y: Math.round(H * 0.36), align: 'left',
            }),
            shapeLayer({
              name: '底线', fill: '#f59e0b', radius: 100,
              x: Math.round(W * 0.06), y: Math.round(H * 0.80),
              w: Math.round(W * 0.2), h: Math.max(3, Math.round(m * 0.009)),
            }),
          ],
        };
      },
    },
    {
      id: 'bigstat',
      name: '数据大字',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'gradient', c1: '#0f172a', c2: '#334155', angle: 160 },
          layers: [
            textLayer({
              name: '大数字', text: '100+',
              size: Math.round(m * 0.34), weight: 900, color: '#38bdf8',
              letterSpacing: -Math.round(m * 0.006),
              w: Math.round(W * 0.9), x: Math.round(W * 0.05),
              y: Math.round(H * 0.16), align: 'left',
            }),
            textLayer({
              name: '说明', text: '个效率工具实测合集',
              size: Math.round(m * 0.058), weight: 600, color: '#e2e8f0',
              w: Math.round(W * 0.9), x: Math.round(W * 0.05),
              y: Math.round(H * 0.58), align: 'left',
            }),
            shapeLayer({
              name: '分隔线', fill: '#38bdf8', radius: 100,
              x: Math.round(W * 0.05), y: Math.round(H * 0.72),
              w: Math.round(W * 0.16), h: Math.max(3, Math.round(m * 0.008)),
            }),
            textLayer({
              name: '小字', text: '全部亲手测过',
              size: Math.round(m * 0.034), weight: 400, color: '#94a3b8',
              w: Math.round(W * 0.9), x: Math.round(W * 0.05),
              y: Math.round(H * 0.78), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'splitv',
      name: '上图文下',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            shapeLayer({
              name: '图片区（双击换图）', fill: '#e2e8f0', radius: 0,
              x: 0, y: 0, w: W, h: Math.round(H * 0.56),
            }),
            textLayer({
              name: '主标题', text: '这才是\n真正的效率',
              size: Math.round(m * 0.1), weight: 900, color: '#0f172a',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.62), align: 'left',
            }),
            textLayer({
              name: '副标题', text: '三个被我用了两年的工具',
              size: Math.round(m * 0.038), weight: 500, color: '#64748b',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.88), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'circle',
      name: '圆形焦点',
      build(W, H) {
        const m = Math.min(W, H);
        const d = Math.round(m * 0.62);
        return {
          bg: { type: 'solid', c1: '#f8fafc', c2: '#f8fafc', angle: 0 },
          layers: [
            shapeLayer({
              name: '圆底', shape: 'ellipse', fill: '#1e293b', radius: 0,
              w: d, h: d,
              x: Math.round((W - d) / 2),
              y: Math.round((H - d) / 2 * 0.86),
            }),
            textLayer({
              name: '标题', text: '效率\n不是玄学',
              size: Math.round(m * 0.082), weight: 800, color: '#ffffff',
              w: Math.round(d * 0.82), x: Math.round((W - d * 0.82) / 2),
              y: Math.round((H - d) / 2 * 0.86 + d * 0.26), align: 'center',
            }),
            textLayer({
              name: '说明', text: '聊聊我是怎么把一天拉长的',
              size: Math.round(m * 0.034), weight: 400, color: '#94a3b8',
              w: Math.round(W * 0.8), x: Math.round(W * 0.1),
              y: Math.round(H * 0.86), align: 'center',
            }),
          ],
        };
      },
    },
    {
      id: 'diagonal',
      name: '斜切色块',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            shapeLayer({
              name: '斜块', fill: '#2563eb', radius: 0,
              x: Math.round(-W * 0.15), y: Math.round(H * 0.42),
              w: Math.round(W * 1.4), h: Math.round(H * 0.78),
              rot: -8,
            }),
            textLayer({
              name: '主标题', text: '工具选错了\n一天白干',
              size: Math.round(m * 0.11), weight: 900, color: '#0f172a',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.14), align: 'left',
            }),
            textLayer({
              name: '副标题', text: '六个主流工具的实测对比',
              size: Math.round(m * 0.042), weight: 600, color: '#ffffff',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.7), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'triple',
      name: '三联卡片',
      build(W, H) {
        const m = Math.min(W, H);
        const gap = Math.round(W * 0.03);
        const cw = Math.round((W - gap * 4) / 3);
        const ch = Math.round(H * 0.46);
        const colors = ['#2563eb', '#7c3aed', '#0891b2'];
        const words = ['省时', '省钱', '省心'];
        const layers = [];

        for (let i = 0; i < 3; i++) {
          const x = gap + i * (cw + gap);
          layers.push(shapeLayer({
            name: '卡' + (i + 1), fill: colors[i], radius: Math.round(m * 0.02),
            x, y: Math.round(H * 0.3), w: cw, h: ch,
          }));
          layers.push(textLayer({
            name: '词' + (i + 1), text: words[i],
            size: Math.round(m * 0.062), weight: 800, color: '#ffffff',
            w: cw, x, y: Math.round(H * 0.46), align: 'center',
          }));
        }

        layers.unshift(textLayer({
          name: '主标题', text: '三个维度\n看你该用哪款',
          size: Math.round(m * 0.082), weight: 900, color: '#0f172a',
          w: Math.round(W * 0.9), x: Math.round(W * 0.05),
          y: Math.round(H * 0.08), align: 'left',
        }));

        return {
          bg: { type: 'solid', c1: '#f8fafc', c2: '#f8fafc', angle: 0 },
          layers,
        };
      },
    },
    {
      id: 'hairline',
      name: '极简线条',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.07);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            shapeLayer({
              name: '顶线', fill: '#0f172a', radius: 100,
              x: pad, y: pad, w: Math.round(W * 0.22), h: Math.max(2, Math.round(m * 0.005)),
            }),
            textLayer({
              name: '主标题', text: '把复杂\n留给自己',
              size: Math.round(m * 0.1), weight: 700, color: '#0f172a',
              w: Math.round(W * 0.8), x: pad,
              y: Math.round(H * 0.32), align: 'left',
            }),
            shapeLayer({
              name: '底线', fill: '#cbd5e1', radius: 100,
              x: pad, y: Math.round(H * 0.78),
              w: Math.round(W * 0.14), h: Math.max(2, Math.round(m * 0.003)),
            }),
            textLayer({
              name: '小字', text: '一些关于工具的碎碎念',
              size: Math.round(m * 0.032), weight: 400, color: '#94a3b8',
              w: Math.round(W * 0.8), x: pad,
              y: Math.round(H * 0.84), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'ringout',
      name: '环形聚焦',
      build(W, H) {
        const m = Math.min(W, H);
        const d = Math.round(m * 0.56);
        const cx = Math.round((W - d) / 2);
        const cy = Math.round(H * 0.12);
        return {
          bg: { type: 'gradient', c1: '#111827', c2: '#1f2937', angle: 135 },
          layers: [
            shapeLayer({
              name: '外环', shape: 'ellipse', fill: 'transparent', radius: 0,
              borderWidth: Math.max(2, Math.round(m * 0.006)),
              borderColor: '#38bdf8',
              w: d, h: d, x: cx, y: cy,
            }),
            textLayer({
              name: '中心标题', text: '01',
              size: Math.round(m * 0.16), weight: 900, color: '#38bdf8',
              w: d, x: cx, y: Math.round(cy + d * 0.3), align: 'center',
            }),
            textLayer({
              name: '主标题', text: '第一步\n先别急着装',
              size: Math.round(m * 0.09), weight: 800, color: '#f1f5f9',
              w: Math.round(W * 0.86), x: Math.round(W * 0.07),
              y: Math.round(H * 0.74), align: 'center',
            }),
          ],
        };
      },
    },
    {
      id: 'glass',
      name: '半透叠层',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.06);
        return {
          bg: { type: 'gradient', c1: '#1e3a8a', c2: '#7c3aed', angle: 145 },
          layers: [
            shapeLayer({
              name: '玻璃层', fill: 'rgba(15,23,42,.42)',
              radius: Math.round(m * 0.025),
              x: pad, y: Math.round(H * 0.34),
              w: W - pad * 2, h: Math.round(H * 0.5),
              borderWidth: 1, borderColor: 'rgba(255,255,255,.22)',
            }),
            textLayer({
              name: '主标题', text: '效率工具\n避坑指南',
              size: Math.round(m * 0.1), weight: 900, color: '#ffffff',
              w: W - pad * 4, x: pad * 2,
              y: Math.round(H * 0.41), align: 'left',
            }),
            textLayer({
              name: '副标题', text: '踩过的坑都在这了',
              size: Math.round(m * 0.036), weight: 500, color: '#cbd5e1',
              w: W - pad * 4, x: pad * 2,
              y: Math.round(H * 0.7), align: 'left',
            }),
            textLayer({
              name: '角标', text: 'WRITER GUARD',
              size: Math.round(m * 0.026), weight: 700, color: 'rgba(255,255,255,.55)',
              w: W - pad * 2, x: pad,
              y: pad, align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'corner',
      name: '角落大字',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.07);
        return {
          bg: { type: 'solid', c1: '#f8fafc', c2: '#f8fafc', angle: 0 },
          layers: [
            textLayer({
              name: '角标', text: 'NO.01',
              size: Math.round(m * 0.028), weight: 800, color: '#2563eb',
              w: Math.round(W * 0.4), x: W - Math.round(W * 0.4) - pad,
              y: pad, align: 'right', letterSpacing: 2,
            }),
            textLayer({
              name: '主标题', text: '把复杂\n留给自己',
              size: Math.round(m * 0.105), weight: 900, color: '#0f172a',
              w: Math.round(W * 0.7), x: pad,
              y: Math.round(H * 0.42), align: 'left',
            }),
            textLayer({
              name: '小字', text: '一些关于工具的碎碎念',
              size: Math.round(m * 0.03), weight: 400, color: '#94a3b8',
              w: Math.round(W * 0.7), x: pad,
              y: Math.round(H * 0.82), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'stripe',
      name: '斜条纹',
      build(W, H) {
        const m = Math.min(W, H);
        const layers = [];
        for (let i = 0; i < 5; i++) {
          layers.push(shapeLayer({
            name: '条纹' + (i + 1), fill: i % 2 ? 'rgba(56,189,248,.16)' : 'rgba(124,58,237,.16)',
            radius: 0, rot: -22,
            x: Math.round(W * (-0.2 + i * 0.24)), y: Math.round(-H * 0.3),
            w: Math.round(W * 0.09), h: Math.round(H * 1.8),
          }));
        }
        layers.push(textLayer({
          name: '主标题', text: '效率不是\n玄学',
          size: Math.round(m * 0.115), weight: 900, color: '#0f172a',
          w: Math.round(W * 0.8), x: Math.round(W * 0.1),
          y: Math.round(H * 0.3), align: 'center',
        }));
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers,
        };
      },
    },
    {
      id: 'quote',
      name: '引语体',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#fefce8', c2: '#fefce8', angle: 0 },
          layers: [
            textLayer({
              name: '引号', text: '“',
              size: Math.round(m * 0.3), weight: 900, color: '#fbbf24',
              w: Math.round(W * 0.3), x: Math.round(W * 0.06),
              y: Math.round(H * 0.02), align: 'left',
            }),
            textLayer({
              name: '引文', text: '工具不该\n替你思考',
              size: Math.round(m * 0.088), weight: 800, color: '#422006',
              w: Math.round(W * 0.78), x: Math.round(W * 0.11),
              y: Math.round(H * 0.36), align: 'left',
            }),
            textLayer({
              name: '署名', text: '—— 阿四',
              size: Math.round(m * 0.032), weight: 500, color: '#a16207',
              w: Math.round(W * 0.78), x: Math.round(W * 0.11),
              y: Math.round(H * 0.82), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'taglabel',
      name: '标签贴',
      build(W, H) {
        const m = Math.min(W, H);
        const tagW = Math.round(W * 0.66);
        const tagH = Math.round(H * 0.5);
        const tagX = Math.round((W - tagW) / 2);
        const tagY = Math.round(H * 0.25);
        return {
          bg: { type: 'gradient', c1: '#4f46e5', c2: '#0891b2', angle: 135 },
          layers: [
            shapeLayer({
              name: '标签底', fill: '#ffffff', radius: Math.round(m * 0.03),
              x: tagX, y: tagY, w: tagW, h: tagH,
            }),
            textLayer({
              name: '标签字', text: '实测\n6 款工具',
              size: Math.round(m * 0.088), weight: 900, color: '#0f172a',
              w: tagW - Math.round(m * 0.08), x: tagX + Math.round(m * 0.04),
              y: tagY + Math.round(tagH * 0.22), align: 'left',
            }),
            textLayer({
              name: '角标', text: 'EFFICIENCY',
              size: Math.round(m * 0.024), weight: 700, color: 'rgba(255,255,255,.8)',
              w: Math.round(W * 0.5), x: Math.round(W * 0.08),
              y: Math.round(H * 0.08), align: 'left', letterSpacing: 3,
            }),
          ],
        };
      },
    },
    {
      id: 'gradbar',
      name: '渐变条',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            textLayer({
              name: '主标题', text: '今天聊聊\n效率这件事',
              size: Math.round(m * 0.1), weight: 900, color: '#0f172a',
              w: Math.round(W * 0.72), x: Math.round(W * 0.08),
              y: Math.round(H * 0.2), align: 'left',
            }),
            shapeLayer({
              name: '渐变条', fill: '#2563eb', radius: Math.round(m * 0.012),
              x: Math.round(W * 0.08), y: Math.round(H * 0.68),
              w: Math.round(W * 0.42), h: Math.round(m * 0.035),
            }),
            textLayer({
              name: '副标题', text: '三个被低估的日常习惯',
              size: Math.round(m * 0.034), weight: 500, color: '#64748b',
              w: Math.round(W * 0.72), x: Math.round(W * 0.08),
              y: Math.round(H * 0.78), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'gridline',
      name: '网格线',
      build(W, H) {
        const m = Math.min(W, H);
        const layers = [];
        for (let i = 1; i < 4; i++) {
          layers.push(shapeLayer({
            name: '竖线' + i, fill: 'rgba(148,163,184,.35)', radius: 0,
            x: Math.round(W * (i / 4)), y: 0,
            w: 1, h: Math.round(H),
          }));
        }
        for (let i = 1; i < 3; i++) {
          layers.push(shapeLayer({
            name: '横线' + i, fill: 'rgba(148,163,184,.35)', radius: 0,
            x: 0, y: Math.round(H * (i / 3)),
            w: Math.round(W), h: 1,
          }));
        }
        layers.push(textLayer({
          name: '主标题', text: '结构化\n思考',
          size: Math.round(m * 0.11), weight: 900, color: '#0f172a',
          w: Math.round(W * 0.8), x: Math.round(W * 0.1),
          y: Math.round(H * 0.28), align: 'center',
        }));
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers,
        };
      },
    },
    {
      id: 'spotlight',
      name: '聚光灯',
      build(W, H) {
        const m = Math.min(W, H);
        const d = Math.round(m * 0.86);
        return {
          bg: { type: 'gradient', c1: '#020617', c2: '#1e293b', angle: 180 },
          layers: [
            shapeLayer({
              name: '光晕', shape: 'ellipse', fill: 'rgba(56,189,248,.16)', radius: 0,
              w: d, h: d,
              x: Math.round((W - d) / 2), y: Math.round((H - d) / 2),
            }),
            textLayer({
              name: '主标题', text: '只讲\n一件事',
              size: Math.round(m * 0.115), weight: 900, color: '#f8fafc',
              w: Math.round(W * 0.8), x: Math.round(W * 0.1),
              y: Math.round(H * 0.3), align: 'center',
            }),
          ],
        };
      },
    },
    {
      id: 'bracket',
      name: '括号框',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.09);
        const bh = Math.round(H * 0.5);
        const by = Math.round(H * 0.26);
        return {
          bg: { type: 'solid', c1: '#f8fafc', c2: '#f8fafc', angle: 0 },
          layers: [
            shapeLayer({
              name: '左括号', fill: '#0f172a', radius: 0,
              x: pad, y: by, w: Math.max(3, Math.round(m * 0.009)), h: bh,
            }),
            shapeLayer({
              name: '右括号', fill: '#0f172a', radius: 0,
              x: W - pad - Math.max(3, Math.round(m * 0.009)), y: by,
              w: Math.max(3, Math.round(m * 0.009)), h: bh,
            }),
            textLayer({
              name: '主标题', text: '实测\n结论',
              size: Math.round(m * 0.1), weight: 900, color: '#0f172a',
              w: W - pad * 2 - Math.round(m * 0.1), x: pad + Math.round(m * 0.05),
              y: Math.round(H * 0.34), align: 'center',
            }),
          ],
        };
      },
    },
    {
      id: 'underline',
      name: '下划线强调',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            textLayer({
              name: '主标题', text: '别再手动\n复制粘贴了',
              size: Math.round(m * 0.105), weight: 900, color: '#0f172a',
              w: Math.round(W * 0.78), x: Math.round(W * 0.08),
              y: Math.round(H * 0.24), align: 'left',
            }),
            shapeLayer({
              name: '强调线', fill: '#f59e0b', radius: 100,
              x: Math.round(W * 0.08), y: Math.round(H * 0.64),
              w: Math.round(W * 0.3), h: Math.max(4, Math.round(m * 0.014)),
            }),
            textLayer({
              name: '副标题', text: '五个自动化脚本救了我',
              size: Math.round(m * 0.034), weight: 500, color: '#64748b',
              w: Math.round(W * 0.78), x: Math.round(W * 0.08),
              y: Math.round(H * 0.74), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'stackcard',
      name: '层叠卡',
      build(W, H) {
        const m = Math.min(W, H);
        const cw = Math.round(W * 0.62);
        const ch = Math.round(H * 0.54);
        const cx = Math.round((W - cw) / 2);
        const cy = Math.round(H * 0.24);
        return {
          bg: { type: 'solid', c1: '#eef2ff', c2: '#eef2ff', angle: 0 },
          layers: [
            shapeLayer({
              name: '底层卡', fill: 'rgba(99,102,241,.18)', radius: Math.round(m * 0.03),
              x: cx + Math.round(m * 0.035), y: cy + Math.round(m * 0.045), w: cw, h: ch,
            }),
            shapeLayer({
              name: '中层卡', fill: 'rgba(99,102,241,.34)', radius: Math.round(m * 0.03),
              x: cx + Math.round(m * 0.018), y: cy + Math.round(m * 0.022), w: cw, h: ch,
            }),
            shapeLayer({
              name: '顶层卡', fill: '#4f46e5', radius: Math.round(m * 0.03),
              x: cx, y: cy, w: cw, h: ch,
            }),
            textLayer({
              name: '卡内标题', text: '三层筛选\n留下一个',
              size: Math.round(m * 0.08), weight: 900, color: '#ffffff',
              w: cw - Math.round(m * 0.08), x: cx + Math.round(m * 0.04),
              y: cy + Math.round(ch * 0.26), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'badge',
      name: '编号徽章',
      build(W, H) {
        const m = Math.min(W, H);
        const d = Math.round(m * 0.34);
        return {
          bg: { type: 'gradient', c1: '#0f172a', c2: '#4c1d95', angle: 150 },
          layers: [
            shapeLayer({
              name: '徽章', shape: 'ellipse', fill: '#f59e0b', radius: 0,
              w: d, h: d, x: Math.round(W * 0.07), y: Math.round(H * 0.12),
            }),
            textLayer({
              name: '编号', text: '03',
              size: Math.round(d * 0.44), weight: 900, color: '#1f2937',
              w: d, x: Math.round(W * 0.07), y: Math.round(H * 0.12 + d * 0.3), align: 'center',
            }),
            textLayer({
              name: '主标题', text: '第三个\n才是对的',
              size: Math.round(m * 0.095), weight: 900, color: '#ffffff',
              w: Math.round(W * 0.8), x: Math.round(W * 0.07),
              y: Math.round(H * 0.58), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'timeline',
      name: '时间轴',
      build(W, H) {
        const m = Math.min(W, H);
        const x0 = Math.round(W * 0.12);
        const items = [
          { y: 0.30, t: '2019 第一次踩坑' },
          { y: 0.50, t: '2021 换到第二款' },
          { y: 0.70, t: '2024 终于稳定' },
        ];
        const layers = [
          shapeLayer({
            name: '竖线', fill: 'rgba(37,99,235,.3)', radius: 0,
            x: x0, y: Math.round(H * 0.24),
            w: Math.max(2, Math.round(m * 0.006)),
            h: Math.round(H * 0.56),
          }),
        ];
        items.forEach((it, i) => {
          const dot = Math.max(8, Math.round(m * 0.026));
          layers.push(shapeLayer({
            name: '节点' + (i + 1), shape: 'ellipse', fill: '#2563eb', radius: 0,
            w: dot, h: dot,
            x: x0 + Math.round(m * 0.003) - Math.round(dot / 2),
            y: Math.round(H * it.y),
          }));
          layers.push(textLayer({
            name: '事件' + (i + 1), text: it.t,
            size: Math.round(m * 0.04), weight: 600, color: '#0f172a',
            w: Math.round(W * 0.7), x: x0 + Math.round(m * 0.05),
            y: Math.round(H * it.y) - Math.round(m * 0.014), align: 'left',
          }));
        });
        layers.push(textLayer({
          name: '主标题', text: '用了五年\n才想明白',
          size: Math.round(m * 0.075), weight: 900, color: '#0f172a',
          w: Math.round(W * 0.8), x: Math.round(W * 0.1),
          y: Math.round(H * 0.06), align: 'left',
        }));
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers,
        };
      },
    },
    {
      id: 'split3',
      name: '三分栏',
      build(W, H) {
        const m = Math.min(W, H);
        const cw = Math.round(W / 3);
        const colors = ['#f1f5f9', '#e2e8f0', '#cbd5e1'];
        const layers = colors.map((c, i) => shapeLayer({
          name: '分栏' + (i + 1), fill: c, radius: 0,
          x: cw * i, y: Math.round(H * 0.34), w: cw, h: Math.round(H * 0.66),
        }));
        layers.push(textLayer({
          name: '主标题', text: '三个阶段\n三段折腾',
          size: Math.round(m * 0.095), weight: 900, color: '#0f172a',
          w: Math.round(W * 0.86), x: Math.round(W * 0.07),
          y: Math.round(H * 0.08), align: 'left',
        }));
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers,
        };
      },
    },
    {
      id: 'maskfade',
      name: '渐隐蒙版',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'gradient', c1: '#1d4ed8', c2: '#7c3aed', angle: 160 },
          layers: [
            shapeLayer({
              name: '压暗层', fill: 'rgba(2,6,23,.45)', radius: 0,
              x: 0, y: Math.round(H * 0.46), w: Math.round(W), h: Math.round(H * 0.54),
            }),
            textLayer({
              name: '主标题', text: '真正难的是\n决定不做什么',
              size: Math.round(m * 0.088), weight: 900, color: '#ffffff',
              w: Math.round(W * 0.84), x: Math.round(W * 0.08),
              y: Math.round(H * 0.56), align: 'left',
            }),
            textLayer({
              name: '小字', text: '一份删减清单',
              size: Math.round(m * 0.03), weight: 500, color: 'rgba(255,255,255,.7)',
              w: Math.round(W * 0.84), x: Math.round(W * 0.08),
              y: Math.round(H * 0.85), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'dots',
      name: '圆点阵',
      build(W, H) {
        const m = Math.min(W, H);
        const d = Math.max(4, Math.round(m * 0.014));
        const layers = [];
        const cols = 6;
        const rows = 3;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            layers.push(shapeLayer({
              name: '点', shape: 'ellipse', fill: 'rgba(37,99,235,.22)', radius: 0,
              w: d, h: d,
              x: Math.round(W * 0.08) + c * Math.round(m * 0.075),
              y: Math.round(H * 0.12) + r * Math.round(m * 0.075),
            }));
          }
        }
        layers.push(textLayer({
          name: '主标题', text: '从小处\n开始',
          size: Math.round(m * 0.115), weight: 900, color: '#0f172a',
          w: Math.round(W * 0.8), x: Math.round(W * 0.1),
          y: Math.round(H * 0.42), align: 'left',
        }));
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers,
        };
      },
    },
    {
      id: 'arrowguide',
      name: '箭头引导',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#0f172a', c2: '#0f172a', angle: 0 },
          layers: [
            shapeLayer({
              name: '色块', fill: '#38bdf8', radius: Math.round(m * 0.02),
              x: Math.round(W * 0.06), y: Math.round(H * 0.22),
              w: Math.round(W * 0.5), h: Math.round(H * 0.44),
            }),
            textLayer({
              name: '箭头', text: '→',
              size: Math.round(m * 0.22), weight: 900, color: '#38bdf8',
              w: Math.round(W * 0.3), x: Math.round(W * 0.62),
              y: Math.round(H * 0.32), align: 'center',
            }),
            textLayer({
              name: '主标题', text: '从这里\n开始改',
              size: Math.round(m * 0.082), weight: 900, color: '#0f172a',
              w: Math.round(W * 0.44), x: Math.round(W * 0.09),
              y: Math.round(H * 0.32), align: 'left',
            }),
            textLayer({
              name: '说明', text: '第一步先别装工具',
              size: Math.round(m * 0.032), weight: 500, color: 'rgba(255,255,255,.6)',
              w: Math.round(W * 0.5), x: Math.round(W * 0.06),
              y: Math.round(H * 0.74), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'monocode',
      name: '代码风',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.08);
        return {
          bg: { type: 'solid', c1: '#0d1117', c2: '#0d1117', angle: 0 },
          layers: [
            textLayer({
              name: '注释', text: '// 2024-11 实测',
              size: Math.round(m * 0.028), weight: 400, color: '#7d8590',
              w: Math.round(W * 0.8), x: pad, y: pad, align: 'left',
            }),
            textLayer({
              name: '主标题', text: 'const habit =\n  "每天十分钟"',
              size: Math.round(m * 0.068), weight: 700, color: '#7ee787',
              w: Math.round(W * 0.86), x: pad,
              y: Math.round(H * 0.3), align: 'left',
            }),
            shapeLayer({
              name: '光标', fill: '#7ee787', radius: 0,
              x: pad + Math.round(W * 0.5), y: Math.round(H * 0.72),
              w: Math.max(3, Math.round(m * 0.008)), h: Math.round(m * 0.07),
            }),
            textLayer({
              name: '小字', text: '// 一个程序员的自救',
              size: Math.round(m * 0.026), weight: 400, color: '#7d8590',
              w: Math.round(W * 0.8), x: pad,
              y: Math.round(H * 0.84), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'newspaper',
      name: '报纸头版',
      build(W, H) {
        const m = Math.min(W, H);
        const pad = Math.round(m * 0.06);
        return {
          bg: { type: 'solid', c1: '#fbfaf7', c2: '#fbfaf7', angle: 0 },
          layers: [
            shapeLayer({
              name: '顶栏线', fill: '#0f172a', radius: 0,
              x: pad, y: Math.round(H * 0.14),
              w: W - pad * 2, h: Math.max(3, Math.round(m * 0.008)),
            }),
            textLayer({
              name: '报头', text: '效率日报',
              size: Math.round(m * 0.03), weight: 800, color: '#0f172a',
              w: Math.round(W * 0.5), x: pad, y: Math.round(H * 0.05),
              align: 'left', letterSpacing: 3,
            }),
            textLayer({
              name: '主标题', text: '一份被低估\n的效率清单',
              size: Math.round(m * 0.095), weight: 900, color: '#0f172a',
              w: W - pad * 2, x: pad,
              y: Math.round(H * 0.26), align: 'left',
            }),
            shapeLayer({
              name: '分隔线1', fill: 'rgba(15,23,42,.25)', radius: 0,
              x: pad, y: Math.round(H * 0.66), w: W - pad * 2, h: 1,
            }),
            shapeLayer({
              name: '分隔线2', fill: 'rgba(15,23,42,.25)', radius: 0,
              x: pad, y: Math.round(H * 0.72), w: W - pad * 2, h: 1,
            }),
            textLayer({
              name: '导语', text: '第 12 期 · 三款工具 · 全部自费',
              size: Math.round(m * 0.028), weight: 400, color: '#57534e',
              w: W - pad * 2, x: pad,
              y: Math.round(H * 0.78), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'wave',
      name: '波浪弧',
      build(W, H) {
        const m = Math.min(W, H);
        const d1 = Math.round(W * 0.9);
        const d2 = Math.round(W * 0.7);
        return {
          bg: { type: 'gradient', c1: '#0c4a6e', c2: '#164e63', angle: 160 },
          layers: [
            shapeLayer({
              name: '弧1', shape: 'ellipse', fill: 'rgba(56,189,248,.18)', radius: 0,
              w: d1, h: d1,
              x: Math.round(-W * 0.35), y: Math.round(H * 0.5),
            }),
            shapeLayer({
              name: '弧2', shape: 'ellipse', fill: 'rgba(14,165,233,.22)', radius: 0,
              w: d2, h: d2,
              x: Math.round(W * 0.45), y: Math.round(-d2 * 0.3),
            }),
            textLayer({
              name: '主标题', text: '节奏\n比努力重要',
              size: Math.round(m * 0.098), weight: 900, color: '#f0f9ff',
              w: Math.round(W * 0.8), x: Math.round(W * 0.1),
              y: Math.round(H * 0.3), align: 'left',
            }),
          ],
        };
      },
    },
    {
      id: 'contrast',
      name: '左右对比',
      build(W, H) {
        const m = Math.min(W, H);
        return {
          bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff', angle: 0 },
          layers: [
            shapeLayer({
              name: '左色块', fill: '#0f172a', radius: 0,
              x: 0, y: 0, w: Math.round(W * 0.5), h: Math.round(H),
            }),
            textLayer({
              name: '左字', text: '以前\n手动干',
              size: Math.round(m * 0.072), weight: 800, color: '#ffffff',
              w: Math.round(W * 0.42), x: Math.round(W * 0.05),
              y: Math.round(H * 0.3), align: 'left',
            }),
            textLayer({
              name: '右字', text: '现在\n一键跑',
              size: Math.round(m * 0.072), weight: 800, color: '#0f172a',
              w: Math.round(W * 0.42), x: Math.round(W * 0.55),
              y: Math.round(H * 0.3), align: 'left',
            }),
            shapeLayer({
              name: '分隔', fill: '#f59e0b', radius: 0,
              x: Math.round(W * 0.5) - 2, y: 0, w: 4, h: Math.round(H),
            }),
          ],
        };
      },
    },
  ];

  function renderTemplates() {
    const box = $('#cv-template-grid');
    if (!box) return;
    box.innerHTML = TEMPLATES.map((t) => {
      const built = t.build(120, 76);
      const prev = built.layers.slice(0, 6).map((l) => {
        const px = (l.x / 120) * 100;
        const py = (l.y / 76) * 100;
        const pw = (l.w / 120) * 100;
        const ph = Math.max(4, (l.h / 76) * 100);
        let color = '#1f6feb';
        if (l.type === 'text') color = l.color === '#ffffff' || String(l.color).includes('rgba(255,255,255,0)') ? '#cbd5e1' : l.color;
        if (l.type === 'rect') color = l.fill === 'transparent' ? 'transparent' : l.fill;
        const border = l.borderWidth ? `outline:1px solid ${l.borderColor};` : '';
        return `<i style="left:${px}%;top:${py}%;width:${pw}%;height:${ph}%;background:${color};${border}opacity:.9"></i>`;
      }).join('');

      const bgCss = built.bg.type === 'gradient'
        ? `linear-gradient(${built.bg.angle}deg,${built.bg.c1},${built.bg.c2})`
        : built.bg.c1;

      return `<button class="cv-tpl" data-tpl="${t.id}">
        <div class="cv-tpl-prev" style="background:${bgCss}">${prev}</div>
        <span class="cv-tpl-name">${WG.esc(t.name)}</span>
      </button>`;
    }).join('');

    box.querySelectorAll('[data-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => applyTemplate(btn.dataset.tpl));
    });
  }

  function applyTemplate(id) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    const built = t.build(S.w, S.h);
    S.bg = built.bg;
    S.layers = built.layers;
    S.sel = S.layers.length ? S.layers[0].id : null;
    S.charSel = new Set();
    pushHistory();
    renderAll();
    WG.toast('已应用模板：' + t.name + ' · Ctrl+Z 可撤销');
  }

  /* ============================================================
   * 尺寸
   * ============================================================ */

  function renderSizeList() {
    const box = $('#cv-size-list');
    if (!box) return;
    box.innerHTML = PRESETS.map((p) => {
      const ratio = p.w / p.h;
      const pw = Math.round(ratio >= 1 ? 26 : 26 * ratio);
      const ph = Math.round(ratio >= 1 ? 26 / ratio : 26);
      return `<div class="cv-size ${S.presetId === p.id ? 'is-on' : ''}" data-size="${p.id}">
        <span class="cv-size-prev" style="width:${pw}px;height:${ph}px"></span>
        <div class="cv-size-body">
          <b>${p.name}</b>
          <span>${p.w}×${p.h} · ${p.note}</span>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-size]').forEach((el) => {
      el.addEventListener('click', () => applyPreset(el.dataset.size));
    });
  }

  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const oldW = S.w;
    const oldH = S.h;
    S.w = p.w;
    S.h = p.h;
    S.presetId = p.id;

    // 按比例迁移图层，换尺寸不丢版式
    const rx = p.w / oldW;
    const ry = p.h / oldH;
    const rs = Math.min(rx, ry);
    S.layers.forEach((l) => {
      l.x = Math.round(l.x * rx);
      l.y = Math.round(l.y * ry);
      l.w = Math.round(l.w * rx);
      if (l.type !== 'text') l.h = Math.round(l.h * ry);
      if (l.type === 'text') l.size = Math.max(8, Math.round(l.size * rs));
      if (l.type === 'text' && l.bgEnabled) {
        l.bgPadX = Math.round(l.bgPadX * rs);
        l.bgPadY = Math.round(l.bgPadY * rs);
      }
    });

    const wi = $('#cv-w');
    const hi = $('#cv-h');
    if (wi) wi.value = S.w;
    if (hi) hi.value = S.h;

    pushHistory();
    renderAll();
    renderSizeList();
    WG.toast('已切换到 ' + p.name + ' ' + p.w + '×' + p.h);
  }

  function updateDims() {
    const d = $('#cv-dims');
    if (d) d.textContent = S.w + ' × ' + S.h;
  }

  function updateSelHint() {
    const h = $('#cv-sel-hint');
    if (!h) return;
    const l = getLayer(S.sel);
    if (!l) {
      h.textContent = '未选中图层';
      h.style.color = '';
      return;
    }
    const out = l.x < -1 || l.y < -1 || l.x + l.w > S.w + 1 || l.y + l.h > S.h + 1;
    h.textContent = `${l.name || '图层'} · X${Math.round(l.x)} Y${Math.round(l.y)} · ${Math.round(l.w)}×${Math.round(l.h)}`
      + (l.type === 'text' ? ' · 双击可直接改字' : '')
      + (out ? ' · 出界了' : '');
    h.style.color = out ? '#ff6b6b' : '';
  }

  /* ============================================================
   * 方案预设
   * ============================================================ */

  function renderPresets() {
    const box = $('#cv-preset-list');
    if (!box) return;
    const list = WG.Store.get(PRESET_KEY, []);

    if (!list.length) {
      box.innerHTML = '<div class="cv-pane-hint" style="margin:0 0 12px">还没有自己的预设。调好一版点上面保存，下次一键还原。</div>';
      return;
    }

    box.innerHTML = list.map((p) => `
      <div class="cv-preset" data-pid="${p.id}">
        <div class="cv-preset-body">
          <b>${WG.esc(p.name)}</b>
          <span>${p.w}×${p.h} · ${(p.layers || []).length} 层</span>
        </div>
        <button class="cv-layer-btn" data-pact="load" data-pid="${p.id}" title="加载" style="opacity:1">↧</button>
        <button class="cv-layer-btn" data-pact="del" data-pid="${p.id}" title="删除" style="opacity:1">×</button>
      </div>
    `).join('');

    box.querySelectorAll('[data-pact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.pact === 'load') {
          loadPreset(btn.dataset.pid);
        } else {
          WG.Store.set(PRESET_KEY, list.filter((x) => x.id !== btn.dataset.pid));
          renderPresets();
          WG.toast('预设已删除');
        }
      });
    });

    // 双击名字就地改名，不弹输入框
    box.querySelectorAll('.cv-preset-body b').forEach((b) => {
      b.addEventListener('dblclick', () => {
        b.contentEditable = 'true';
        b.focus();
        document.execCommand && document.execCommand('selectAll', false, null);
        const done = () => {
          b.contentEditable = 'false';
          const pid = b.closest('.cv-preset').dataset.pid;
          const name = b.textContent.trim().slice(0, 24);
          if (!name) { renderPresets(); return; }
          const next = WG.Store.get(PRESET_KEY, []).map((x) => (
            x.id === pid ? Object.assign({}, x, { name }) : x
          ));
          WG.Store.set(PRESET_KEY, next);
          renderPresets();
        };
        b.addEventListener('blur', done, { once: true });
        b.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); b.blur(); }
        });
      });
    });
  }

  function savePreset() {
    // 不弹输入框：拿画布上的主标题自动命名，想改就双击列表里的名字
    const firstText = S.layers.find((l) => l.type === 'text' && String(l.text || '').trim());
    const seed = firstText
      ? String(firstText.text).replace(/[\s\u3000]+/g, ' ').trim().slice(0, 12)
      : '未命名';
    const name = seed + ' · ' + S.w + '×' + S.h;

    const list = WG.Store.get(PRESET_KEY, []);
    list.unshift({
      id: WG.uid('cp'),
      name,
      w: S.w,
      h: S.h,
      bg: JSON.parse(JSON.stringify(S.bg)),
      layers: JSON.parse(JSON.stringify(S.layers)),
      ts: Date.now(),
    });
    WG.Store.set(PRESET_KEY, list.slice(0, 40));
    renderPresets();
    WG.toast('已保存预设（双击名字可改）');
  }

  function loadPreset(id) {
    const p = WG.Store.get(PRESET_KEY, []).find((x) => x.id === id);
    if (!p) return;

    S.w = p.w;
    S.h = p.h;
    S.presetId = 'custom';
    S.bg = JSON.parse(JSON.stringify(p.bg));
    S.layers = JSON.parse(JSON.stringify(p.layers || []));
    S.sel = S.layers.length ? S.layers[0].id : null;
    S.charSel = new Set();

    const wi = $('#cv-w');
    const hi = $('#cv-h');
    if (wi) wi.value = S.w;
    if (hi) hi.value = S.h;

    pushHistory();
    renderAll();
    renderSizeList();
    WG.toast('已加载预设：' + p.name + ' · Ctrl+Z 可撤销');
  }

  /* ============================================================
   * 滚轮分级缩放
   * ============================================================ */

  /* ============================================================
   * 背景色 / 文字色：滚轮循环
   * ============================================================ */

  const BG_PALETTE = [
    '#0f172a', '#1e293b', '#334155', '#111827',
    '#7c3aed', '#4f46e5', '#2563eb', '#0891b2',
    '#059669', '#ca8a04', '#ea580c', '#dc2626',
    '#be185d', '#64748b', '#e7e5e4', '#ffffff',
  ];

  const TEXT_PALETTE = [
    '#ffffff', '#0f172a', '#ef4444', '#f59e0b',
    '#10b981', '#2563eb', '#8b5cf6', '#ec4899',
  ];

  /* ---------- 四角渐变：低分辨率插值 + 平滑放大 ---------- */

  function hexToRgb(hex) {
    let h = String(hex || '#000000').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * 生成四角渐变 canvas
   * @param {number} W 目标宽
   * @param {number} H 目标高
   * @param {string[]} colors [左上, 右上, 右下, 左下]
   */
  function makeCornerCanvas(W, H, colors) {
    // 尺寸可能是脏数据（NaN/字符串），这里先净化，别让 createImageData 崩掉
    const w = Math.max(1, Math.round(Number(W)) || 1);
    const h = Math.max(1, Math.round(Number(H)) || 1);

    const LW = 64;
    const LH = Math.max(8, Math.min(512, Math.round(LW * h / w)));

    const off = document.createElement('canvas');
    off.width = LW;
    off.height = LH;
    const octx = off.getContext('2d');
    const img = octx.createImageData(LW, LH);
    const d = img.data;

    const rgb = colors.map(hexToRgb);
    const [tl, tr, br, bl] = rgb;

    for (let y = 0; y < LH; y++) {
      const ty = LH > 1 ? y / (LH - 1) : 0;
      for (let x = 0; x < LW; x++) {
        const tx = LW > 1 ? x / (LW - 1) : 0;

        // 上边：左→右；下边：左→右；再纵向插值
        const rT = tl[0] + (tr[0] - tl[0]) * tx;
        const gT = tl[1] + (tr[1] - tl[1]) * tx;
        const bT = tl[2] + (tr[2] - tl[2]) * tx;

        const rB = bl[0] + (br[0] - bl[0]) * tx;
        const gB = bl[1] + (br[1] - bl[1]) * tx;
        const bB = bl[2] + (br[2] - bl[2]) * tx;

        const i = (y * LW + x) * 4;
        d[i] = Math.round(rT + (rB - rT) * ty);
        d[i + 1] = Math.round(gT + (gB - gT) * ty);
        d[i + 2] = Math.round(bT + (bB - bT) * ty);
        d[i + 3] = 255;
      }
    }

    octx.putImageData(img, 0, 0);

    // 放大到目标尺寸（浏览器平滑插值）
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(W));
    out.height = Math.max(1, Math.round(H));
    const cctx = out.getContext('2d');
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(off, 0, 0, out.width, out.height);
    return out;
  }

  let cornerCache = { key: '', url: '' };

  function cornerBgUrl() {
    const key = [S.bg.c1, S.bg.c2, S.bg.c3, S.bg.c4, S.w, S.h].join('|');
    if (cornerCache.key === key) return cornerCache.url;
    const cv = makeCornerCanvas(Math.min(S.w, 900), Math.min(S.h, 900), [S.bg.c1, S.bg.c2, S.bg.c3, S.bg.c4]);
    const url = cv.toDataURL('image/png');
    cornerCache = { key, url };
    return url;
  }

  /* 把当前背景渲染到 stage 上 */
  function applyStageBg(stage) {
    if (!stage) return;
    if (S.bg.type === 'corners') {
      stage.style.background = '#fff';
      stage.style.backgroundImage = 'url("' + cornerBgUrl() + '")';
      stage.style.backgroundSize = '100% 100%';
      stage.style.backgroundRepeat = 'no-repeat';
    } else if (S.bg.type === 'gradient') {
      stage.style.backgroundImage = 'none';
      stage.style.background = `linear-gradient(${S.bg.angle}deg, ${S.bg.c1}, ${S.bg.c2})`;
    } else {
      stage.style.backgroundImage = 'none';
      stage.style.background = S.bg.c1;
    }
  }

  /* 四角键位 → 颜色字段 */
  const CORNER_FIELD = { tl: 'c1', tr: 'c2', br: 'c3', bl: 'c4' };

  /* 滚轮换色：跳过其它角已经占用的颜色，保证四角不撞色 */
  function cycleCornerColor(pos, dir) {
    const field = CORNER_FIELD[pos];
    if (!field) return;

    if (S.bg.type !== 'corners') {
      // 从纯色/渐变切到四角模式时，先把当前色铺到其它角
      S.bg.type = 'corners';
      const base = BG_PALETTE.indexOf(String(S.bg.c1).toLowerCase());
      const i0 = base >= 0 ? base : 0;
      S.bg.c1 = BG_PALETTE[i0 % BG_PALETTE.length];
      S.bg.c2 = BG_PALETTE[(i0 + 4) % BG_PALETTE.length];
      S.bg.c3 = BG_PALETTE[(i0 + 8) % BG_PALETTE.length];
      S.bg.c4 = BG_PALETTE[(i0 + 12) % BG_PALETTE.length];
    }

    const used = new Set(
      ['c1', 'c2', 'c3', 'c4']
        .filter((k) => k !== field)
        .map((k) => String(S.bg[k]).toLowerCase())
    );

    const cur = String(S.bg[field]).toLowerCase();
    let idx = BG_PALETTE.findIndex((c) => c.toLowerCase() === cur);
    if (idx < 0) idx = 0;

    // 最多找一整轮，找不到就退回原位置（色板被占满时）
    let next = cur;
    for (let step = 1; step <= BG_PALETTE.length; step++) {
      const cand = BG_PALETTE[(idx + dir * step + BG_PALETTE.length * 2) % BG_PALETTE.length];
      if (!used.has(cand.toLowerCase())) { next = cand; break; }
    }

    S.bg[field] = next;

    renderStage();
    syncCornerColors();
    syncBgInputs();
    clearTimeout(cycleCornerColor._t);
    cycleCornerColor._t = setTimeout(() => pushHistory(), 420);
    WG.toast(pos.toUpperCase() + ' 角 ' + next);
  }

  function cycleBgColor(dir) {
    cycleCornerColor('tl', dir);
  }

  /* 切到四角模式时，保证四个角颜色互不相同 */
  function ensureDistinctCorners() {
    const fields = ['c1', 'c2', 'c3', 'c4'];
    const used = new Set();
    fields.forEach((f) => {
      let cur = String(S.bg[f] || '').toLowerCase();
      if (!cur || used.has(cur)) {
        const free = BG_PALETTE.find((p) => !used.has(p.toLowerCase()));
        S.bg[f] = free || BG_PALETTE[used.size % BG_PALETTE.length];
        cur = String(S.bg[f]).toLowerCase();
      }
      used.add(cur);
    });
  }

  /* 只更新背景色控件，不重建整个检查器，免得打断滚动 */
  function syncBgInputs() {
    ['c1', 'c2', 'c3', 'c4'].forEach((k) => {
      const c = $(`#cv-inspector [data-canvas="${k}"]`);
      const h = $(`#cv-inspector [data-canvas="${k}hex"]`);
      if (c) c.value = toHex(S.bg[k]);
      if (h) h.value = S.bg[k];
    });
  }

  function syncCornerColors() {
    WG.$$('#cv-stage .cv-corner').forEach((c) => {
      const pos = c.dataset.corner;
      const field = CORNER_FIELD[pos] || 'c1';
      const col = S.bg.type === 'corners' ? S.bg[field] : S.bg.c1;
      c.style.setProperty('--corner-c', col);
      c.title = pos.toUpperCase() + ' 角 ' + col + ' · 滚轮换色 · 点击自定义';
    });
  }

  function pickCornerColor(pos) {
    const field = CORNER_FIELD[pos] || 'c1';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = toHex(S.bg[field]);
    inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(inp);

    inp.addEventListener('input', () => {
      if (S.bg.type !== 'corners') S.bg.type = 'corners';
      S.bg[field] = inp.value;
      renderStage();
      syncCornerColors();
      syncBgInputs();
    });
    inp.addEventListener('change', () => {
      pushHistory();
      inp.remove();
      WG.toast(pos.toUpperCase() + ' 角 ' + S.bg[field]);
    });
    inp.click();
  }

  /* 四角调色热区 */
  function createCorners() {
    const stage = $('#cv-stage');
    if (!stage || stage.querySelector('.cv-corner')) return;

    ['tl', 'tr', 'bl', 'br'].forEach((pos) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cv-corner cv-corner-' + pos;
      btn.dataset.corner = pos;
      btn.title = '滚轮切换背景色 · 点击自定义';

      btn.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleCornerColor(pos, e.deltaY < 0 ? -1 : 1);
      }, { passive: false });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickCornerColor(pos);
      });

      stage.appendChild(btn);
    });

    syncCornerColors();
  }


  /**
   * 判断屏幕坐标是否落在画布四角的「换色安全区」内。
   * 圆点本身只有 18px，鼠标稍偏就落到画布上，会误触发画布缩放。
   * 这里用 56px 的半径兜底，只要在角上滚轮就只换色、不缩放。
   */
  function cornerZoneAt(clientX, clientY) {
    const stage = $('#cv-stage');
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return null;

    const pad = 56;
    const nearL = clientX <= r.left + pad;
    const nearR = clientX >= r.right - pad;
    const nearT = clientY <= r.top + pad;
    const nearB = clientY >= r.bottom - pad;

    // 只在角上生效，边缘中点不管
    if (nearT && nearL) return 'tl';
    if (nearT && nearR) return 'tr';
    if (nearB && nearR) return 'br';
    if (nearB && nearL) return 'bl';
    return null;
  }

  function bindWheel() {
    const wrap = $('#cv-stage-wrap');
    if (!wrap || wrap.__wheelBound) return;
    wrap.__wheelBound = true;

    wrap.addEventListener('wheel', (e) => {
      const el = e.target.closest ? e.target.closest('.cv-el') : null;

      // 悬停在元素上
      if (el && !e.ctrlKey && !e.metaKey) {
        const l = getLayer(el.dataset.id);
        if (l && !l.locked) {
          e.preventDefault();

          const f = e.deltaY < 0 ? 1.06 : 1 / 1.06;
          if (l.type === 'text') {
            // 画布上文字：滚轮调字号（宽度等比跟走，排版不乱）
            l.size = clamp(Math.round(l.size * f), 8, 400);
            l.w = Math.round(clamp(l.w * f, 40, S.w * 2));
          } else {
            l.w = Math.max(8, Math.round(l.w * f));
            l.h = Math.max(8, Math.round(l.h * f));
          }
          if (l.id !== S.sel) {
            S.sel = l.id;
            S.charSel = new Set();
            renderInspector();
          }
          paintLayer(l);
          updateSelHint();
          clearTimeout(wrap.__wt);
          wrap.__wt = setTimeout(() => { pushHistory(); renderInspector(); }, 320);
        }
        return;
      }

      // 空白处：先判断是不是落在四角换色安全区
      const zone = cornerZoneAt(e.clientX, e.clientY);
      if (zone) {
        e.preventDefault();
        cycleCornerColor(zone, e.deltaY < 0 ? -1 : 1);
        return;
      }

      // 其余空白处：缩放画布
      e.preventDefault();
      S.zoom = clamp(S.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 0.08, 4);
      applyZoom(S.zoom, true);
    }, { passive: false });
  }

  /* ============================================================
   * 缩放
   * ============================================================ */

  function applyZoom(z, keep) {
    if (!keep) S.zoom = clamp(z, 0.08, 4);
    const stage = $('#cv-stage');
    const box = stage && stage.parentNode;
    if (!stage || !box) return;

    stage.style.transform = `scale(${S.zoom})`;
    box.style.width = (S.w * S.zoom) + 'px';
    box.style.height = (S.h * S.zoom) + 'px';

    const label = $('#cv-zoom-label');
    if (label) label.textContent = Math.round(S.zoom * 100) + '%';
  }

  function fitToWindow() {
    const wrap = $('#cv-stage-wrap');
    if (!wrap) return;
    const pad = 52;
    const availW = wrap.clientWidth - pad;
    const availH = wrap.clientHeight - pad;
    if (availW <= 0 || availH <= 0) return;
    S.zoom = clamp(Math.min(availW / S.w, availH / S.h, 1), 0.08, 1);
    S.fitZoom = S.zoom;
    applyZoom(S.zoom, true);
  }

  /* ============================================================
   * 导出
   * ============================================================ */

  function fontAvailable(css) {
    try {
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d');
      const fam = css.split(',')[0].trim().replace(/^["']|["']$/g, '');
      ctx.font = '32px monospace';
      const w1 = ctx.measureText('中文Abc测').width;
      ctx.font = `32px "${fam}", monospace`;
      const w2 = ctx.measureText('中文Abc测').width;
      return Math.abs(w1 - w2) > 0.5;
    } catch (e) {
      return false;
    }
  }

  /* 换行时同时记录每个字符在原文本里的索引，供逐字着色使用 */
  function wrapLinesWithIndex(ctx, text, maxW) {
    const src = Array.from(String(text));
    const lines = [];
    let cur = { chars: [], text: '' };

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\n') {
        lines.push(cur);
        cur = { chars: [], text: '' };
        continue;
      }
      const test = cur.text + ch;
      if (cur.text && ctx.measureText(test).width > maxW) {
        // 英文单词尽量不拆断
        if (/[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]$/.test(cur.text)) {
          const sp = cur.text.lastIndexOf(' ');
          if (sp > 0) {
            const head = cur.text.slice(0, sp);
            const headCount = Array.from(head).length;
            const tailChars = cur.chars.slice(headCount);
            lines.push({ chars: cur.chars.slice(0, headCount), text: head });
            cur = {
              chars: tailChars.concat([{ ch, idx: i }]),
              text: cur.text.slice(sp + 1) + ch,
            };
            continue;
          }
        }
        lines.push(cur);
        cur = { chars: [{ ch, idx: i }], text: ch };
      } else {
        cur.chars.push({ ch, idx: i });
        cur.text = test;
      }
    }
    lines.push(cur);
    return lines;
  }

  function wrapLines(ctx, text, maxW) {
    return wrapLinesWithIndex(ctx, text, maxW).map((l) => l.text);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---------- 对比度（WCAG） ---------- */

  function relLuminance(hex) {
    let r, g, b;
    const m = String(hex || '').match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      r = +m[1]; g = +m[2]; b = +m[3];
    } else {
      let h = String(hex || '#000').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      r = parseInt(h.slice(0, 2), 16) || 0;
      g = parseInt(h.slice(2, 4), 16) || 0;
      b = parseInt(h.slice(4, 6), 16) || 0;
    }
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrastRatio(c1, c2) {
    const l1 = relLuminance(c1);
    const l2 = relLuminance(c2);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* 文字压在最差的那个背景上还能不能看清 */
  function textContrast(l) {
    if (l.bgEnabled) return contrastRatio(l.color, l.bgColor);
    if (S.bg.type === 'gradient') {
      return Math.min(contrastRatio(l.color, S.bg.c1), contrastRatio(l.color, S.bg.c2));
    }
    return contrastRatio(l.color, S.bg.c1);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawAll(ctx) {
    // 背景
    if (S.bg.type === 'corners') {
      const cv = makeCornerCanvas(S.w, S.h, [S.bg.c1, S.bg.c2, S.bg.c3, S.bg.c4]);
      ctx.drawImage(cv, 0, 0, S.w, S.h);
    } else if (S.bg.type === 'gradient') {
      const a = (S.bg.angle - 90) * Math.PI / 180;
      const cx = S.w / 2;
      const cy = S.h / 2;
      const r = Math.max(S.w, S.h);
      const g = ctx.createLinearGradient(
        cx - Math.cos(a) * r / 2, cy - Math.sin(a) * r / 2,
        cx + Math.cos(a) * r / 2, cy + Math.sin(a) * r / 2
      );
      g.addColorStop(0, S.bg.c1);
      g.addColorStop(1, S.bg.c2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S.w, S.h);
    } else {
      ctx.fillStyle = S.bg.c1;
      ctx.fillRect(0, 0, S.w, S.h);
    }

    // 图层（按顺序，同步绘制；图片异步）
    return S.layers.reduce((p, l) => p.then(() => drawLayer(ctx, l)), Promise.resolve());
  }

  function drawLayer(ctx, l) {
    if (!l.visible) return Promise.resolve();

    if (l.type === 'rect') {
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
      ctx.rotate(l.rot * Math.PI / 180);
      ctx.translate(-l.w / 2, -l.h / 2);

      const isEllipse = l.shape === 'ellipse';
      const drawPath = (inset) => {
        if (isEllipse) {
          ctx.beginPath();
          ctx.ellipse(l.w / 2, l.h / 2,
            Math.max(0.1, l.w / 2 - inset), Math.max(0.1, l.h / 2 - inset),
            0, 0, Math.PI * 2);
        } else {
          roundRect(ctx, inset, inset, Math.max(0.1, l.w - inset * 2), Math.max(0.1, l.h - inset * 2), l.radius || 0);
        }
      };

      if (l.fill && l.fill !== 'transparent') {
        drawPath(0);
        ctx.fillStyle = l.fill;
        ctx.fill();
      }
      if (l.borderWidth > 0) {
        drawPath(l.borderWidth / 2);
        ctx.lineWidth = l.borderWidth;
        ctx.strokeStyle = l.borderColor || '#000';
        ctx.stroke();
      }
      ctx.restore();
      return Promise.resolve();
    }

    if (l.type === 'image') {
      if (!l.src) return Promise.resolve();
      return new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          ctx.save();
          ctx.globalAlpha = l.opacity;
          ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
          ctx.rotate(l.rot * Math.PI / 180);
          ctx.translate(-l.w / 2, -l.h / 2);
          roundRect(ctx, 0, 0, l.w, l.h, l.radius || 0);
          ctx.clip();

          const iw = im.naturalWidth;
          const ih = im.naturalHeight;
          let dw = l.w;
          let dh = l.h;
          let dx = 0;
          let dy = 0;

          if (l.fit === 'cover') {
            const s = Math.max(l.w / iw, l.h / ih);
            dw = iw * s; dh = ih * s;
            dx = (l.w - dw) / 2; dy = (l.h - dh) / 2;
          } else if (l.fit === 'contain') {
            const s = Math.min(l.w / iw, l.h / ih);
            dw = iw * s; dh = ih * s;
            dx = (l.w - dw) / 2; dy = (l.h - dh) / 2;
          }
          ctx.drawImage(im, dx, dy, dw, dh);
          ctx.restore();
          resolve();
        };
        im.onerror = () => resolve();
        im.src = l.src;
      });
    }

    if (l.type === 'text') {
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
      ctx.rotate(l.rot * Math.PI / 180);
      ctx.translate(-l.w / 2, -l.h / 2);

      const padX = l.bgEnabled ? l.bgPadX : 0;
      const padY = l.bgEnabled ? l.bgPadY : 0;
      const innerW = l.w - padX * 2;
      const ls = l.letterSpacing || 0;

      ctx.font = `${l.weight} ${l.size}px ${l.font}`;
      if ('letterSpacing' in ctx) {
        try { ctx.letterSpacing = ls + 'px'; } catch (e) { /* ignore */ }
      }

      const wl = wrapLinesWithIndex(ctx, l.text, innerW);
      const lineH = l.size * l.lineHeight;
      const totalH = wl.length * lineH;
      const boxH = totalH + padY * 2;

      // 背景块
      if (l.bgEnabled) {
        roundRect(ctx, 0, 0, l.w, boxH, l.bgRadius || 0);
        ctx.fillStyle = l.bgColor;
        ctx.fill();
      }

      ctx.textBaseline = 'top';
      const align = l.align === 'left' ? 'left' : l.align === 'right' ? 'right' : 'center';
      const tx = align === 'left' ? padX : align === 'right' ? l.w - padX : l.w / 2;

      if (l.shadowEnabled) {
        ctx.shadowColor = l.shadowColor || 'rgba(0,0,0,.4)';
        ctx.shadowBlur = l.shadowBlur || 0;
        ctx.shadowOffsetX = l.shadowX || 0;
        ctx.shadowOffsetY = l.shadowY || 0;
      }

      const hasCharColors = l.charColors && Object.keys(l.charColors).length > 0;

      // 逐字着色时关掉画布字距，改由手工累加，保证与 DOM 渲染一致
      if (hasCharColors && 'letterSpacing' in ctx) {
        try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
      }

      wl.forEach((line, i) => {
        const y = padY + i * lineH + (lineH - l.size) / 2;

        ctx.textAlign = align;
        if (l.strokeEnabled && l.strokeWidth > 0) {
          ctx.lineWidth = l.strokeWidth;
          ctx.strokeStyle = l.strokeColor;
          ctx.lineJoin = 'round';
          ctx.strokeText(line.text, tx, y);
        }

        if (!hasCharColors) {
          ctx.fillStyle = l.color;
          ctx.fillText(line.text, tx, y);
          return;
        }

        // 逐字填充：按原文字索引取色
        const lineW = line.chars.reduce((sum, c) => {
          return sum + ctx.measureText(c.ch).width + ls;
        }, 0) - ls;

        let x = align === 'center' ? tx - lineW / 2 : align === 'right' ? tx - lineW : tx;
        ctx.textAlign = 'left';

        line.chars.forEach((c) => {
          const col = (l.charColors && l.charColors[c.idx]) || l.color;
          ctx.fillStyle = col;
          ctx.fillText(c.ch, x, y);
          x += ctx.measureText(c.ch).width + ls;
        });
      });

      if ('letterSpacing' in ctx) {
        try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
      }

      ctx.restore();
    }

    return Promise.resolve();
  }

  /* 编辑台的「用设计器那张」读这个键：
   * 导出时顺手存一份压缩过的 JPEG dataURL，避免大图撑爆 storage。 */
  function storeLastCover(cv) {
    try {
      const maxW = 900;
      const scale = Math.min(1, maxW / cv.width);
      const w = Math.max(1, Math.round(cv.width * scale));
      const h = Math.max(1, Math.round(cv.height * scale));
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      tmp.getContext('2d').drawImage(cv, 0, 0, w, h);
      WG.Store.set('coverLast', { url: tmp.toDataURL('image/jpeg', 0.92), w: w, h: h, ts: Date.now() });
    } catch (e) { /* 存不下也不影响导出 */ }
  }

  function doExport(scale) {
    WG.toast('正在导出…');
    const cv = document.createElement('canvas');
    cv.width = Math.round(S.w * scale);
    cv.height = Math.round(S.h * scale);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);

    // 字体加载兜底：绘制前确保字体就绪
    const fonts = S.layers.filter((l) => l.type === 'text').map((l) => l.font);
    const ready = fonts.length && document.fonts
      ? document.fonts.ready
      : Promise.resolve();

    ready.then(() => drawAll(ctx)).then(() => {
      cv.toBlob((blob) => {
        if (!blob) return WG.toast('导出失败');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cover-${S.w}x${S.h}@${scale}x-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        WG.toast(`已导出 ${cv.width}×${cv.height} PNG`);

        // 顺手留一份给编辑台当封面
        storeLastCover(cv);

        // 顺手记一条素材台账，避免图做了却忘了登记来源
        try {
          WG.Store.push(WG.KEY.assets, {
            id: WG.uid('as'),
            name: '封面-' + S.w + 'x' + S.h,
            source: 'self',
            proof: '编辑器导出 ' + WG.fmtTime(Date.now()),
            expire: '',
            article: '',
            note: '封面设计器生成，字体：' + (S.layers.filter(l=>l.type==='text').map(l=>l.fontLabel).join('/') || '无文字'),
          });
        } catch (e) { /* ignore */ }
      }, 'image/png');
    });
  }

  /* ============================================================
   * AI 提示词
   * ============================================================ */

  function buildPrompt() {
    const article = ($('#cv-article').value || '').trim();
    const styleIdx = Number(($('#cv-style').value || '0'));
    const style = AI_STYLES[styleIdx] || AI_STYLES[0];

    const isWide = S.w > S.h;
    const ratio = (S.w / S.h).toFixed(2);
    const orientation = isWide ? '横版构图' : '竖版构图';

    let topic = article.replace(/\s+/g, ' ').slice(0, 120);
    if (!topic) topic = '文章主题（请先填写）';

    const lines = [
      `【画面风格】${style.name}：${style.desc}`,
      `【画幅】${orientation}，比例 ${ratio}:1（${S.w}×${S.h}）`,
      `【主题】${topic}`,
      ``,
      `【硬性要求】`,
      `1. 画面中不要出现任何文字、字母、数字、水印、logo。所有文字由后期排版完成，AI 画的字一定会错。`,
      `2. 主体偏一侧或居上，${isWide ? '右侧' : '下方'}留出干净的负空间用于放标题。`,
      `3. 高清、干净、构图完整，避免杂乱细节堆叠。`,
      `4. 人物如出现，表情与姿态自然，五官清晰。`,
      ``,
      `【负向】文字、字幕、标语、招牌文字、乱码、变形手指、多余肢体、低清、噪点`,
    ];

    const out = lines.join('\n');
    const box = $('#cv-prompt-out');
    if (box) box.textContent = out;
    return out;
  }

  /* ============================================================
   * 初始化
   * ============================================================ */

  function bindToolbar() {
    $('#cv-undo').addEventListener('click', undo);
    $('#cv-redo').addEventListener('click', redo);

    $('#cv-grid').addEventListener('click', (e) => {
      S.grid = !S.grid;
      e.currentTarget.classList.toggle('is-on', S.grid);
      renderStage();
    });
    $('#cv-snap').addEventListener('click', (e) => {
      S.snap = !S.snap;
      e.currentTarget.classList.toggle('is-on', S.snap);
      WG.toast(S.snap ? '吸附已开启' : '吸附已关闭');
    });

    $('#cv-upload-bg').addEventListener('click', () => pickImageFor(null, 'bg'));
    $('#cv-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      handleFile(f);
      e.target.value = '';
    });

    $('#cv-zoom-in').addEventListener('click', () => { S.zoom = clamp(S.zoom * 1.2, 0.08, 4); applyZoom(S.zoom, true); });
    $('#cv-zoom-out').addEventListener('click', () => { S.zoom = clamp(S.zoom / 1.2, 0.08, 4); applyZoom(S.zoom, true); });
    $('#cv-zoom-fit').addEventListener('click', fitToWindow);

    $('#cv-export').addEventListener('click', () => {
      doExport(coverScale());
    });

    $('#cv-copy').addEventListener('click', copyCover);
    $('#cv-insert').addEventListener('click', insertToEditor);

    $('#cv-apply-size').addEventListener('click', () => {
      const w = clamp(num($('#cv-w').value, 900), 100, 4000);
      const h = clamp(num($('#cv-h').value, 383), 100, 4000);
      S.presetId = 'custom';
      applyPresetSize(w, h);
    });

    $('#cv-gen-prompt').addEventListener('click', () => {
      buildPrompt();
      WG.toast('提示词已生成');
    });
    $('#cv-copy-prompt').addEventListener('click', () => {
      const t = $('#cv-prompt-out').textContent || '';
      if (!t.trim()) return WG.toast('先生成提示词');
      WG.copy(t);
    });
  }

  function applyPresetSize(w, h) {
    const nw = Math.round(Number(w));
    const nh = Math.round(Number(h));
    if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw < 100 || nh < 100) {
      return WG.toast('尺寸不合法，宽高都要是 100 以上的数字');
    }

    const oldW = S.w || nw;
    const oldH = S.h || nh;
    S.w = nw;
    S.h = nh;
    const rx = w / oldW;
    const ry = h / oldH;
    const rs = Math.min(rx, ry);
    S.layers.forEach((l) => {
      l.x = Math.round(l.x * rx);
      l.y = Math.round(l.y * ry);
      l.w = Math.round(l.w * rx);
      if (l.type !== 'text') l.h = Math.round(l.h * ry);
      if (l.type === 'text') l.size = Math.max(8, Math.round(l.size * rs));
    });
    pushHistory();
    renderAll();
    renderSizeList();
    updateDims();
    WG.toast(`画布已改为 ${w}×${h}`);
  }

  /* ---------- 文件夹素材 ---------- */

  function renderStickers() {
    const box = $('#cv-sticker-grid');
    if (!box || !WG.Stickers) return;
    if (box.dataset.ready === '1') return;
    box.dataset.ready = '1';

    box.innerHTML = WG.Stickers.STICKERS.map((st) => `
      <button class="cv-sticker" data-sticker="${st.id}" title="${WG.esc(st.name)}">
        <img src="${WG.Stickers.renderSticker(st, { withLabel: true })}" alt="${WG.esc(st.name)}" draggable="false">
      </button>
    `).join('');

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.cv-sticker');
      if (!btn) return;
      insertSticker(btn.dataset.sticker);
    });
  }

  function insertSticker(id) {
    const st = WG.Stickers && WG.Stickers.get(id);
    if (!st) return;

    // 插入用「不带字」的图，文字另起一层，这样才能改
    const src = WG.Stickers.renderSticker(st, { withLabel: false });

    const side = Math.round(Math.min(S.w, S.h) * 0.42);
    const left = Math.round((S.w - side) / 2);
    const top = Math.round((S.h - side) / 2);

    const layer = imageLayer(src, {
      name: st.name,
      fit: 'contain',
      w: side,
      h: side,
      x: left,
      y: top,
    });

    const selIdx = S.layers.findIndex((x) => x.id === S.sel);
    if (selIdx >= 0) S.layers.splice(selIdx + 1, 0, layer);
    else S.layers.push(layer);

    let focusId = layer.id;

    // 带文字标签：额外配一个可双击修改的文字层
    if (st.label) {
      const txt = textLayer({
        name: st.label,
        text: st.label,
        size: Math.round(side * 0.13),
        weight: 800,
        color: '#ffffff',
        w: Math.round(side * 0.7),
        x: Math.round(S.w / 2 - side * 0.35),
        y: Math.round(top + side * 0.74),
        align: 'center',
      });
      const at = S.layers.findIndex((x) => x.id === layer.id);
      S.layers.splice(at + 1, 0, txt);
      focusId = txt.id;
    }

    S.sel = focusId;
    pushHistory();
    renderAll();
    WG.toast(st.label ? '已插入「' + st.name + '」，文字双击就能改' : '已插入「' + st.name + '」');
  }

  /**
   * 导出倍率。
   * 公众号正文显示宽度约 677 CSS px，Retina 屏要 1354 物理像素才够锐；
   * 微信粘贴时还会再压一道，所以长边直接给到 2200+ 留余量，
   * 文字边缘才不会一发出去就发糊。上限 4 倍，防止大尺寸把内存打爆。
   */
  function coverScale() {
    const px = Math.ceil(2200 / Math.max(1, S.w));
    return Math.max(2, Math.min(4, px));
  }

  /**
   * 按当前尺寸把画布画成一张图（含背景色 / 背景图 / 所有图层）。
   * 封面 900×383 这类小尺寸走 3 倍图，公众号里更清晰。
   */
  function buildCoverCanvas() {
    const scale = coverScale();
    const cv = document.createElement('canvas');
    cv.width = Math.round(S.w * scale);
    cv.height = Math.round(S.h * scale);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    return Promise.resolve(drawAll(ctx)).then(() => cv);
  }

  function buildCoverBlob() {
    return buildCoverCanvas().then((cv) => new Promise((res, rej) => {
      cv.toBlob((b) => (b ? res(b) : rej(new Error('图片生成失败'))), 'image/png');
    }));
  }

  /**
   * 复制成图片 → 粘到公众号正文。
   * 关键：ClipboardItem 直接吃 Promise<Blob>，所以 write() 能在点击的这一下
   * 同步发起（手势还有效）；要是等画完再去写，Chrome 会以「没有用户手势」拒写。
   * 导出的是整张画布（背景 + 内容一起压进 PNG），不会像 HTML 复制那样丢底色。
   */
  function blobToDataUrl(blob) {
    return new Promise((res) => {
      try {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || ''));
        fr.onerror = () => res('');
        fr.readAsDataURL(blob);
      } catch (e) { res(''); }
    });
  }

  /**
   * 复制成图片 → 粘到公众号正文。
   * 关键：ClipboardItem 直接吃 Promise<Blob>，所以 write() 能在点击的这一下
   * 同步发起（手势还有效）；要是等画完再去写，Chrome 会以「没有用户手势」拒写。
   *
   * 剪贴板里同时放两种格式：
   *   text/html 里的 <img src="data:...">  —— 粘进公众号编辑器时，微信按这张
   *     原始像素的图上传，不再走「位图重采样」，文字边才不会糊；
   *   image/png  —— 给 Word / 飞书 / 聊天窗口这类只认位图的地方用。
   */
  async function copyCover() {
    const btn = $('#cv-copy');
    const old = (btn && btn.textContent) || '复制';

    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      WG.toast('这个浏览器不支持复制图片，先用「导出」保存，再上传到公众号');
      return false;
    }

    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    const blobP = buildCoverBlob();

    const htmlP = blobP.then((b) => blobToDataUrl(b)).then((u) => new Blob([
      '<img src="' + u + '" style="max-width:100%;height:auto;display:block;margin:0 auto;">',
    ], { type: 'text/html' }));

    const done = (blob) => {
      WG.toast('封面已复制（' + Math.round(blob.size / 1024) + ' KB，含背景和内容），去公众号正文 Ctrl+V');
      return true;
    };

    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': htmlP,
        'image/png': blobP,
      })]);
      return done(await blobP);
    } catch (e) {
      /* 少数环境不吃 Promise 版 ClipboardItem：等图画完再写一次 */
      try {
        const blob = await blobP;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return done(blob);
      } catch (e2) {
        WG.toast('复制失败：' + ((e2 && e2.message) || '剪贴板被别的程序占用，关掉再试'));
        return false;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  /**
   * 把当前画布生成图片，交给公众号页面插进正文。
   * 在公众号里打开时本页是 iframe，直接 postMessage 给父窗口；
   * 独立标签页打开时只能退到剪贴板。
   */
  async function insertToEditor() {
    const btn = $('#cv-insert');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }

    try {
      const cv = await buildCoverCanvas();
      const blob = await new Promise((res, rej) => {
        cv.toBlob((b) => (b ? res(b) : rej(new Error('图片生成失败'))), 'image/png');
      });

      // 在公众号页面里的 iframe：直接发给父窗口，并等它回执真实结果
      if (window.parent && window.parent !== window) {
        const buffer = await blob.arrayBuffer();
        const token = 'c' + Date.now().toString(36);

        const onAck = (e) => {
          const d = e.data;
          if (!d || d.type !== 'WG_INSERT_COVER_ACK' || d.token !== token) return;
          clearTimeout(timer);
          window.removeEventListener('message', onAck);
          if (d.ok) {
            WG.toast(d.mode === 'clipboard' ? (d.msg || '图已复制，去正文 Ctrl+V') : '封面已插入公众号正文');
          } else {
            WG.toast('插入失败：' + (d.msg || '编辑器没响应，刷新公众号编辑页再试'));
          }
        };
        window.addEventListener('message', onAck);

        // 页面没回音（多半是扩展刚重载、旧页面里的脚本已失效）→ 明确让用户刷新
        // 插入内部有两三档降级要等，回执最长可能要十几秒，这里别喊太早
        const timer = setTimeout(() => {
          window.removeEventListener('message', onAck);
          WG.toast('没收到公众号页面响应：刷新一下公众号编辑页，再点「插入编辑器」');
        }, 22000);

        window.parent.postMessage({
          type: 'WG_INSERT_COVER',
          token,
          buffer,
          mime: 'image/png',
          w: cv.width,
          h: cv.height,
        }, '*');
        WG.toast('已生成封面，正在插入编辑器…');
        return;
      }

      /* 独立标签页：交给后台转发到公众号编辑页（和豆包图片同一条通道） */
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        try {
          const dataUrl = cv.toDataURL('image/png');
          const resp = await chrome.runtime.sendMessage({
            type: 'WG_IMG_TO_WX', dataUrl, name: 'cover.png', alt: '封面',
          });
          if (resp && resp.ok) { WG.toast('封面已插入公众号正文'); return; }
        } catch (e) { /* 退到剪贴板 */ }
      }

      // 再兜底：复制到剪贴板，让用户自己粘
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        WG.toast('封面已复制，去公众号编辑器按 Ctrl+V（或从公众号页面点「封面」直接插入）');
      } else {
        WG.toast('请从公众号页面点「封面」打开设计器，才能直接插入');
      }
    } catch (e) {
      WG.toast('插入失败：' + (e.message || '未知错误'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || '插入编辑器'; }
    }
  }

  function bindPanes() {
    $$('.cv-ptab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.cv-ptab').forEach((t) => t.classList.remove('is-on'));
        tab.classList.add('is-on');
        $$('.cv-pane').forEach((p) => p.classList.toggle('is-on', p.dataset.pane === tab.dataset.pane));
      });
    });
  }

  /* 两侧面板折叠：默认都收起，点三角展开
     左三角 ↔ 左侧工具面板（图层/版式/尺寸/AI 底图）
     右三角 ↔ 右侧属性面板（位置与尺寸、排版、特效） */
  function bindPanelToggles() {
    const app = $('#cover-app');
    const tl = $('#cv-tri-left');
    const tr = $('#cv-tri-right');
    if (!app || !tl || !tr) return;

    const sync = () => {
      tl.classList.toggle('is-open', app.classList.contains('is-left-open'));
      tr.classList.toggle('is-open', app.classList.contains('is-right-open'));
    };

    const toggle = (cls) => {
      app.classList.toggle(cls);
      sync();
      // 面板宽度变了，画布可用区域跟着变，重新适配一次
      setTimeout(() => { renderAll(); fitToWindow(); }, 30);
      setTimeout(fitToWindow, 240);
    };

    tl.addEventListener('click', () => toggle('is-left-open'));
    tr.addEventListener('click', () => toggle('is-right-open'));

    sync();
  }

  function bindAddButtons() {
    $$('.cv-add').forEach((btn) => {
      btn.addEventListener('click', () => addLayer(btn.dataset.add));
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const view = $('.view:not(.is-hide)');
      if (!view || view.dataset.view !== 'cover') return;

      const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (inField) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }

      if (inField) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (S.sel) { e.preventDefault(); deleteLayer(S.sel); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (S.sel) { e.preventDefault(); duplicateLayer(S.sel); }
      }
      // 方向键微调
      const l = getLayer(S.sel);
      if (l && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') l.y -= step;
        if (e.key === 'ArrowDown') l.y += step;
        if (e.key === 'ArrowLeft') l.x -= step;
        if (e.key === 'ArrowRight') l.x += step;
        renderStage();
        renderInspector();
        updateSelHint();
      }
    });
  }

  function initCover() {
    if (S.ready) return;
    const root = $('.cover-app');
    if (!root) return;
    S.ready = true;

    // 舞台外包一层 box，用于缩放后占位
    const stage = $('#cv-stage');
    if (stage && !stage.parentNode.classList.contains('cv-stage-box')) {
      const box = document.createElement('div');
      box.className = 'cv-stage-box';
      stage.parentNode.insertBefore(box, stage);
      box.appendChild(stage);
    }

    bindPanes();
    bindPanelToggles();
    bindAddButtons();
    bindToolbar();
    bindKeyboard();

    // 风格下拉
    const sel = $('#cv-style');
    if (sel) {
      sel.innerHTML = AI_STYLES.map((s, i) => `<option value="${i}">${WG.esc(s.name)} — ${WG.esc(s.desc.slice(0, 18))}</option>`).join('');
    }

    renderTemplates();
    renderStickers();
    renderPresets();
    renderSizeList();
    bindWheel();
    createCorners();

    const buildEl = $('#cv-build');
    if (buildEl) buildEl.textContent = BUILD;

    const presetSave = $('#cv-preset-save');
    if (presetSave) presetSave.addEventListener('click', savePreset);

    // 有上次的自动存档就接着上次；没有才铺默认画布
    const restored = loadAutosave();

    if (!restored) {
      S.layers = [
        textLayer({
          name: '主标题',
          text: '在这里输入\n封面标题',
          size: Math.round(Math.min(S.w, S.h) * 0.14),
          weight: 900,
          color: '#ffffff',
          w: Math.round(S.w * 0.86),
          x: Math.round(S.w * 0.07),
          y: Math.round(S.h * 0.30),
          align: 'left',
          shadowEnabled: true,
        }),
      ];
      S.sel = S.layers[0].id;
    }

    pushHistory();
    renderAll();
    if (restored) setSaveState('已恢复上次编辑', 'ok');

    // 首次进来等布局稳定再算缩放
    setTimeout(fitToWindow, 60);
    setTimeout(fitToWindow, 260);

    const wrap = $('#cv-stage-wrap');
    if (wrap && window.ResizeObserver) {
      const ro = new ResizeObserver(() => { fitToWindow(); });
      ro.observe(wrap);
    }

    WG.toast('封面设计器已就绪，双击画布文字可直接改');
  }

  /* ---------- 对外 ---------- */

  WG.initCover = initCover;
  WG.coverState = S;

  /* 测试钩子：供 tests/ 页面断言渲染与导出，生产路径不依赖 */
  WG.__coverTest = {
    S,
    drawAll,
    buildCoverCanvas,
    buildCoverBlob,
    copyCover,
    wrapLines,
    wrapLinesWithIndex,
    applyPreset,
    applyPresetSize,
    addLayer,
    deleteLayer,
    duplicateLayer,
    undo,
    redo,
    pushHistory,
    renderAll,
    textLayer,
    shapeLayer,
    renderPresets,
    renderSizeList,
    renderTemplates,
    renderStickers,
    insertSticker,
    savePreset,
    loadPreset,
    loadAutosave,
    saveAutosave,
    scheduleAutosave,
    AUTOSAVE_KEY,
    textContrast,
    contrastRatio,
    relLuminance,
    escapeHtml,
    TEMPLATES,
    PRESETS,
    FONTS,
    AI_STYLES,
    buildPrompt,
    BUILD,
    PRESET_KEY,
    handleFile,
    imageSize,
    setPendingMode: (m) => { pendingImgMode = m; },
    getPendingMode: () => pendingImgMode,
  };

  /* 切到封面视图时重新测量与适配：初始化时视图是隐藏的，量不到真实高度 */
  const origSwitch = WG.switchView;
  WG.switchView = function (name) {
    origSwitch(name);
    if (name === 'cover') {
      if (!S.ready) initCover();
      setTimeout(() => { renderAll(); fitToWindow(); }, 20);
      setTimeout(() => { fitToWindow(); }, 220);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
