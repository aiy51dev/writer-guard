/* ============================================================
 * Writer Guard · 工作台核心
 * 存储 / 工具 / 路由 / 导入导出
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG || (root.WG = {});

  /* ---------- DOM 工具 ---------- */

  WG.$ = (sel, ctx) => (ctx || document).querySelector(sel);
  WG.$$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  WG.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  };

  WG.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  let toastTimer = null;
  WG.toast = function (msg) {
    const box = document.getElementById('toast');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-on'), 1900);
  };

  WG.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      WG.toast('已复制');
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); WG.toast('已复制'); return true; }
      catch (e2) { WG.toast('复制失败，请手动选择'); return false; }
      finally { ta.remove(); }
    }
  };

  WG.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  WG.today = function () {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  WG.fmtTime = function (ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  /* ---------- 存储层 ----------
   * 内存缓存 + 异步持久化，对外是同步 API。
   * 有 chrome.storage 用它，直接双击 HTML 打开时降级 localStorage。
   */

  const STORE_PREFIX = 'wg_';
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  const Store = {
    _cache: {},
    _ready: false,

    async init() {
      if (this._ready) return;
      if (hasChrome) {
        const all = await new Promise((res) => chrome.storage.local.get(null, (v) => res(v || {})));
        Object.keys(all).forEach((k) => {
          if (k.startsWith(STORE_PREFIX)) this._cache[k.slice(STORE_PREFIX.length)] = all[k];
        });
      } else {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(STORE_PREFIX)) {
            try { this._cache[k.slice(STORE_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); }
            catch (e) { /* ignore */ }
          }
        }
      }
      this._ready = true;
    },

    get(key, fallback) {
      const v = this._cache[key];
      return v === undefined ? fallback : v;
    },

    set(key, value) {
      this._cache[key] = value;
      const full = STORE_PREFIX + key;
      if (hasChrome) {
        try { chrome.storage.local.set({ [full]: value }); } catch (e) { /* ignore */ }
      } else {
        try { localStorage.setItem(full, JSON.stringify(value)); } catch (e) { /* ignore */ }
      }
      return value;
    },

    push(key, item, opts) {
      const list = this.get(key, []);
      const rec = this._stamp(item);
      list.unshift(rec);
      this.set(key, list);
      if (!opts || !opts.silent) this._log('add', key, rec);
      return list;
    },

    remove(key, id) {
      const list = this.get(key, []);
      const target = list.find((x) => x.id === id);
      const next = list.filter((x) => x.id !== id);
      this.set(key, next);
      if (target) this._log('del', key, target);
      return next;
    },

    update(key, id, patch) {
      const list = this.get(key, []).map((x) => (
        x.id === id ? Object.assign({}, x, patch, { updatedAt: Date.now() }) : x
      ));
      return this.set(key, list);
    },

    /* 给记录盖上操作人和时间戳，团队合并时靠它判断谁更新 */
    _stamp(item) {
      const op = this.get('operator', '') || '';
      return Object.assign({}, item, {
        operator: item.operator || op || '未命名',
        updatedAt: item.updatedAt || Date.now(),
        createdAt: item.createdAt || Date.now(),
      });
    },

    /* 变更日志：谁在什么时候动了什么，最多留 300 条 */
    _log(action, module, rec) {
      try {
        const op = this.get('operator', '') || '未命名';
        const list = this.get('changelog', []);
        list.unshift({
          id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          ts: Date.now(),
          operator: op,
          action,
          module,
          target: String(rec.name || rec.title || rec.article || rec.id || '').slice(0, 60),
        });
        if (list.length > 300) list.length = 300;
        this.set('changelog', list);
      } catch (e) { /* ignore */ }
    },

    all() {
      return Object.assign({}, this._cache);
    },

    replaceAll(data) {
      Object.keys(this._cache).forEach((k) => delete this._cache[k]);
      Object.keys(data || {}).forEach((k) => {
        if (!k.startsWith('wg_')) this.set(k, data[k]);
      });
    },

    keys() {
      return Object.keys(this._cache);
    },
  };

  WG.Store = Store;

  /* ---------- 数据键 ---------- */

  WG.KEY = {
    assets: 'assets',
    dupimg: 'dupimg',
    software: 'software',
    complaints: 'complaints',
    analytics: 'analytics',
    templates: 'customTemplates',
    lastScan: 'lastScan',
    operator: 'operator',
    changelog: 'changelog',
    categories: 'categories',
    aiConfig: 'aiConfig',
  };

  const KEY = WG.KEY;

  /* ---------- 视图路由 ---------- */

  WG.VIEW_TITLE = {
    writer: ['编辑台', 'Markdown 写，本地排版，一键进公众号'],
    zhilu: ['智录笔记', '视频 + 字幕出截图笔记，封面/图廊/短剧/PPT 一条龙'],
    emotion: ['情绪导演', '把情绪标签拆成精确到秒的脸身声词表演指令'],
    compliance: ['检测台', '粘贴正文，一次跑完红线 + AI 痕迹 + 发布评分'],
    title: ['标题改写', '把标题党改成信息型标题，点击率反而更高'],
    aigovern: ['AI 治理', '降低 AI 痕迹的七个手法与合规边界'],
    fonts: ['字体自查', '字体侵权是公众号最高频的索赔项'],
    assets: ['素材台账', '每张图发之前登记一次，被投诉时这是第一道证据'],
    dupimg: ['重复图预警', '同一张图反复出现，是判定内容农场的强信号'],
    templates: ['模板库', '测试环境、反向结论、对比表、申诉话术，直接取用'],
    annotate: ['截图标注', '自己标注过的图，才是你的二次创作'],
    cover: ['封面设计', '文字本地排版，AI 只画底图，中文字一个都不会错'],
    software: ['软件选题库', '测过的软件记下来，避免重复选题和重复踩坑'],
    complaints: ['投诉看板', '72 小时窗口内必须申诉，逾期默认成立'],
    multiplatform: ['多平台改写', '一次录制，五个平台分发'],
    analytics: ['数据复盘', '后台自动抓取 + 手动录入，找出高分选题的共同特征'],
    settings: ['团队设置', '操作人、品类词库、CSV 台账互换、变更日志'],
  };

  WG.switchView = function (name) {
    WG.$$('.nav-item').forEach((b) => b.classList.toggle('is-on', b.dataset.view === name));
    WG.$$('.view').forEach((v) => v.classList.toggle('is-hide', v.dataset.view !== name));

    const meta = WG.VIEW_TITLE[name] || [name, ''];
    const h1 = document.getElementById('topbar-title');
    const tip = document.getElementById('topbar-tip');
    if (h1) h1.textContent = meta[0];
    if (tip) tip.textContent = meta[1];

    document.getElementById('content').scrollTop = 0;
    location.hash = name;
  };

  WG.initRouter = function () {
    WG.$$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => WG.switchView(btn.dataset.view));
    });
    const initial = (location.hash || '').replace('#', '');
    if (initial && WG.VIEW_TITLE[initial]) WG.switchView(initial);
  };

  /* ---------- 导入导出 ---------- */

  WG.initBackup = function () {
    const btnExport = document.getElementById('btn-export');
    const btnImport = document.getElementById('btn-import');
    const fileInput = document.getElementById('file-import');

    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const payload = {
          app: 'WriterGuard',
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          data: Store.all(),
        };
        WG.download('writer-guard-backup-' + WG.today() + '.json', JSON.stringify(payload, null, 2));
        WG.toast('备份已导出');
      });
    }

    if (btnImport && fileInput) {
      btnImport.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const payload = JSON.parse(text);
          if (!payload || payload.app !== 'WriterGuard' || !payload.data) {
            WG.toast('不是有效的备份文件');
            return;
          }
          Store.replaceAll(payload.data);
          WG.toast('导入成功，即将刷新');
          setTimeout(() => location.reload(), 700);
        } catch (e) {
          WG.toast('文件解析失败');
        } finally {
          fileInput.value = '';
        }
      });
    }
  };

  /* ---------- 小的 UI 构件 ---------- */

  WG.emptyHtml = function (text) {
    return '<div class="empty">' + WG.esc(text) + '</div>';
  };

  WG.riskLabel = {
    low: '<span class="pill pill-good">低</span>',
    mid: '<span class="pill pill-warn">中</span>',
    high: '<span class="pill pill-bad">高</span>',
  };

  WG.sourceLabel = {
    self: '自截自录',
    cc0: 'CC0 图库',
    paid: '付费商用',
    ai: 'AI 生成',
    official: '官网素材',
    other: '其他（高风险）',
  };

  WG.complaintStatus = {
    pending: ['待申诉', 'pill pill-bad'],
    appealed: ['已申诉', 'pill pill-warn'],
    restored: ['已恢复', 'pill pill-good'],
    lost: ['申诉失败', 'pill pill-bad'],
    deleted: ['已删文', 'pill'],
  };

  WG.complaintType = {
    infringe: '侵权',
    rule: '规则违规',
    wash: '洗稿',
    other: '其他',
  };

  /* ============================================================
   * 团队协作：操作人 / 品类 / CSV 台账互换
   * ============================================================ */

  WG.currentOperator = function () {
    return Store.get(KEY.operator, '') || '';
  };

  WG.setOperator = function (name) {
    Store.set(KEY.operator, String(name || '').trim());
  };

  WG.getCategories = function () {
    const v = Store.get(KEY.categories, []);
    return Array.isArray(v) ? v : [];
  };

  WG.setCategories = function (list) {
    Store.set(KEY.categories, Array.isArray(list) ? list : []);
  };

  WG.toggleCategory = function (id) {
    const cur = WG.getCategories();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
    WG.setCategories(next);
    return next;
  };

  /* ---------- 台账 CSV ---------- */

  const CSV_MODULES = [
    { key: KEY.assets, label: '素材台账', cols: ['name', 'source', 'proof', 'expire', 'article', 'note'] },
    { key: KEY.software, label: '软件选题库', cols: ['name', 'ver', 'risk', 'verdict', 'pit', 'date'] },
    { key: KEY.complaints, label: '投诉看板', cols: ['article', 'who', 'type', 'status', 'date', 'deadline'] },
    { key: KEY.analytics, label: '数据复盘', cols: ['title', 'date', 'read', 'finish', 'like', 'fans', 'score', 'ai'] },
  ];

  const ENUMS = {
    source: { self: '自截自录', cc0: 'CC0 图库', paid: '付费商用', ai: 'AI 生成', official: '官网素材', other: '其他' },
    risk: { low: '低', mid: '中', high: '高' },
    type: { infringe: '侵权', rule: '规则违规', wash: '洗稿', other: '其他' },
    status: { pending: '待申诉', appealed: '已申诉', restored: '已恢复', lost: '申诉失败', deleted: '已删文' },
  };

  function reverseEnum(field, label) {
    const m = ENUMS[field];
    if (!m) return label;
    const s = String(label || '').trim();
    for (const k in m) {
      if (m[k] === s) return k;
    }
    return s;
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(cur); cur = '';
      } else if (ch === '\n') {
        row.push(cur); cur = '';
        rows.push(row); row = [];
      } else if (ch === '\r') {
        // skip
      } else {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  /**
   * 导出四张台账为 CSV
   * @param {{returnOnly?: boolean}} opts returnOnly=true 时只返回字符串不触发下载（给测试用）
   */
  WG.exportCsv = function (opts) {
    const allCols = [];
    CSV_MODULES.forEach((m) => m.cols.forEach((c) => {
      if (!allCols.includes(c)) allCols.push(c);
    }));

    const head = ['_module', 'id', 'operator', 'updatedAt'].concat(allCols);
    const rows = [head];

    CSV_MODULES.forEach((m) => {
      const list = Store.get(m.key, []);
      list.forEach((rec) => {
        rows.push(head.map((c) => {
          if (c === '_module') return m.label;
          if (c === 'updatedAt') return WG.fmtTime(rec.updatedAt);
          if (c === 'id') return rec.id || '';
          if (c === 'operator') return rec.operator || '';
          let v = rec[c];
          if (v === undefined || v === null) return '';
          if (ENUMS[c] && ENUMS[c][v]) return ENUMS[c][v];
          return String(v);
        }));
      });
    });

    const csv = '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    if (!opts || !opts.returnOnly) {
      WG.download('writer-guard-台账-' + WG.today() + '.csv', csv, 'text/csv;charset=utf-8');
    }
    return csv;
  };

  function mergeInto(key, incoming) {
    const existing = Store.get(key, []);
    const map = new Map();
    existing.forEach((x) => map.set(x.id, x));

    let added = 0;
    let updated = 0;

    incoming.forEach((item) => {
      if (!item.id) item.id = WG.uid('imp');
      const prev = map.get(item.id);
      if (!prev) {
        map.set(item.id, item);
        added++;
        return;
      }
      const pt = prev.updatedAt || 0;
      const it = item.updatedAt || 0;
      if (it > pt) {
        map.set(item.id, Object.assign({}, prev, item));
        updated++;
      }
    });

    const list = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    Store.set(key, list, true);
    return { added, updated, total: list.length };
  }

  /**
   * 导入 CSV 台账
   * @param {string} text CSV 文本
   * @param {'merge'|'replace'} mode merge=按 id 去重合并，updatedAt 新的赢；replace=清空后写入
   */
  WG.importCsv = function (text, mode) {
    const rows = parseCsv(String(text || '').replace(/^\ufeff/, ''));
    if (rows.length < 2) return { ok: false, msg: '文件里没有数据行' };

    const head = rows[0].map((s) => String(s).trim());
    const iModule = head.indexOf('_module');
    if (iModule < 0) {
      return { ok: false, msg: '缺少 _module 列，这不是本工具导出的台账' };
    }

    const byModule = {};
    CSV_MODULES.forEach((m) => { byModule[m.label] = { key: m.key, cols: m.cols, items: [] }; });

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const label = String(row[iModule] || '').trim();
      const mod = byModule[label];
      if (!mod) continue;

      const rec = {};
      head.forEach((col, i) => {
        if (!col || col.startsWith('_')) return;
        const raw = row[i];
        if (raw === undefined) return;
        const val = String(raw).trim();
        if (!val) return;
        if (col === 'updatedAt') {
          const t = Date.parse(val.replace(/-/g, '/'));
          rec.updatedAt = Number.isFinite(t) ? t : Date.now();
          return;
        }
        if (col === 'id' || col === 'operator') { rec[col] = val; return; }
        if (['read', 'finish', 'like', 'fans', 'score', 'ai'].includes(col)) {
          rec[col] = Number(val.replace(/[^\d.-]/g, '')) || 0;
          return;
        }
        rec[col] = reverseEnum(col, val);
      });

      if (!rec.id) rec.id = WG.uid('imp');
      if (!rec.operator) rec.operator = 'CSV导入';
      if (!rec.updatedAt) rec.updatedAt = Date.now();
      mod.items.push(rec);
    }

    if (mode === 'replace') {
      CSV_MODULES.forEach((m) => Store.set(m.key, []));
    }

    const summary = [];
    let totalAdded = 0;
    let totalUpdated = 0;
    Object.keys(byModule).forEach((label) => {
      const mod = byModule[label];
      if (!mod.items.length) return;
      const r = mergeInto(mod.key, mod.items);
      totalAdded += r.added;
      totalUpdated += r.updated;
      summary.push(label + ' 新增 ' + r.added + ' / 更新 ' + r.updated);
    });

    Store._log('import', 'csv', { name: 'CSV 导入（' + mode + '）' });

    return {
      ok: true,
      added: totalAdded,
      updated: totalUpdated,
      msg: summary.length ? summary.join('；') : '没有可导入的记录',
    };
  };

  /* ---------- JSON 合并导入 ---------- */

  WG.importJsonMerge = function (payload) {
    const data = payload && payload.data;
    if (!data) return { ok: false, msg: '备份文件结构不对' };

    const mergeKeys = [KEY.assets, KEY.software, KEY.complaints, KEY.analytics];
    let added = 0;
    let updated = 0;

    mergeKeys.forEach((k) => {
      const incoming = Array.isArray(data[k]) ? data[k] : [];
      if (!incoming.length) return;
      const r = mergeInto(k, incoming);
      added += r.added;
      updated += r.updated;
    });

    // 图片指纹和日志按并集处理
    const dupIn = Array.isArray(data[KEY.dupimg]) ? data[KEY.dupimg] : [];
    if (dupIn.length) {
      const cur = Store.get(KEY.dupimg, []);
      const seen = new Set(cur.map((x) => x.hash));
      const merged = cur.concat(dupIn.filter((x) => x && !seen.has(x.hash)));
      Store.set(KEY.dupimg, merged.slice(0, 300));
    }

    Store._log('import', 'json-merge', { name: '备份合并' });

    return {
      ok: true,
      added,
      updated,
      msg: '合并完成：新增 ' + added + ' 条，更新 ' + updated + ' 条',
    };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
