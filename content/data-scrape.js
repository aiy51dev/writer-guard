/* ============================================================
 * Writer Guard · 后台数据抓取（隔离世界）
 * 接收 MAIN world 转发来的接口响应，自适应提取图文数据。
 * 接口字段改名也能吃住，DOM 表格作为兜底。
 * ============================================================ */
(function () {
  'use strict';

  if (window.__WG_SCRAPE_LOADED__) return;
  window.__WG_SCRAPE_LOADED__ = true;

  const MAX_BUF = 40;
  const buf = [];

  /* ============================================================
   * 一、收集网络响应
   * ============================================================ */

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__wgNet !== true) return;
    if (typeof d.body !== 'string') return;

    buf.push({ url: d.url || '', kind: d.kind || 'text', body: d.body, ts: d.ts || Date.now() });
    while (buf.length > MAX_BUF) buf.shift();
  });

  /* ============================================================
   * 二、字段映射
   * ============================================================ */

  const FIELDS = {
    title: ['title', 'appmsg_title', 'msg_title', 'article_title', 'name', 'content_title'],
    read: ['read_num', 'readnum', 'read_count', 'int_page_read_count', 'total_read', 'page_read', 'read'],
    finish: ['finish_rate', 'complete_rate', 'finish_percent', 'finish_ratio', 'progress', 'read_rate'],
    like: ['like_num', 'likenum', 'old_like_num', 'praise_num', 'like_count', 'like'],
    share: ['share_num', 'share_count', 'forward_num', 'share_user', 'share'],
    fans: ['add_fans', 'new_fans', 'fans_add', 'increase_fans', 'fans_count', 'fans'],
    date: ['date', 'stat_date', 'publish_date', 'sent_time', 'create_time', 'ref_date', 'msg_date', 'pub_time'],
  };

  function lowerIndex(obj) {
    const m = {};
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) m[k.toLowerCase()] = k;
    }
    return m;
  }

  function pick(obj, keys) {
    const li = lowerIndex(obj);
    for (const k of keys) {
      const real = li[k];
      if (real === undefined) continue;
      const v = obj[real];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return undefined;
  }

  function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  function toPct(v) {
    if (v === null || v === undefined || v === '') return 0;
    const s = String(v);
    const n = Number(s.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) return 0;
    // 0.42 → 42；42 → 42；42% → 42
    if (n > 0 && n <= 1 && !s.includes('%')) return Math.round(n * 1000) / 10;
    return Math.round(n * 10) / 10;
  }

  function toDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' || /^\d{10}$|^\d{13}$/.test(String(v))) {
      let n = Number(v);
      if (n < 1e12) n *= 1000;
      const d = new Date(n);
      if (!isNaN(d.getTime())) {
        const p = (x) => String(x).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      }
    }
    const s = String(v);
    const m = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
    return '';
  }

  function normalize(o) {
    return {
      title: String(pick(o, FIELDS.title) || '').trim(),
      read: toNum(pick(o, FIELDS.read)),
      finish: toPct(pick(o, FIELDS.finish)),
      like: toNum(pick(o, FIELDS.like)),
      share: toNum(pick(o, FIELDS.share)),
      fans: toNum(pick(o, FIELDS.fans)),
      date: toDate(pick(o, FIELDS.date)),
    };
  }

  function hasKey(obj, keys) {
    const li = lowerIndex(obj);
    return keys.some((k) => li[k] !== undefined && obj[li[k]] !== '' && obj[li[k]] !== null);
  }

  /* ============================================================
   * 三、在 JSON 里找记录数组
   * ============================================================ */

  function findRecordArray(node, depth) {
    if (!node || depth > 9) return null;

    if (Array.isArray(node)) {
      const objs = node.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length) {
        const sample = objs[0];
        if (hasKey(sample, FIELDS.title) && hasKey(sample, FIELDS.read)) return node;
      }
      for (const item of node) {
        const r = findRecordArray(item, depth + 1);
        if (r) return r;
      }
      return null;
    }

    if (typeof node === 'object') {
      for (const k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        const r = findRecordArray(node[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  function extractFromJson(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return null;
    }
    const arr = findRecordArray(obj, 0);
    if (!arr || !arr.length) return null;

    const records = arr
      .filter((x) => x && typeof x === 'object')
      .map(normalize)
      .filter((r) => r.title && r.title.length > 1);

    return records.length ? records : null;
  }

  /* ============================================================
   * 四、DOM 表格兜底
   * ============================================================ */

  function extractFromDom() {
    const out = [];
    const tables = document.querySelectorAll('table');

    for (const t of tables) {
      let headCells = Array.from(t.querySelectorAll('thead th')).map((c) => c.innerText.trim());
      let bodyRows = Array.from(t.querySelectorAll('tbody tr'));

      if (!headCells.length) {
        const firstRow = t.querySelector('tr');
        if (!firstRow) continue;
        headCells = Array.from(firstRow.querySelectorAll('th, td')).map((c) => c.innerText.trim());
        bodyRows = Array.from(t.querySelectorAll('tr')).slice(1);
      }
      if (!headCells.length || !bodyRows.length) continue;

      const idx = {
        title: headCells.findIndex((h) => /标题|文章/.test(h)),
        read: headCells.findIndex((h) => /阅读人数|阅读量|阅读/.test(h)),
        finish: headCells.findIndex((h) => /完读|完成率/.test(h)),
        like: headCells.findIndex((h) => /在看|点赞/.test(h)),
        share: headCells.findIndex((h) => /分享|转发/.test(h)),
        fans: headCells.findIndex((h) => /涨粉|新增粉丝/.test(h)),
        date: headCells.findIndex((h) => /时间|日期/.test(h)),
      };

      if (idx.title < 0 || idx.read < 0) continue;

      for (const tr of bodyRows) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (!cells.length) continue;
        const txt = (i) => (i >= 0 && cells[i] ? cells[i].innerText.trim() : '');

        const title = txt(idx.title);
        if (!title) continue;

        out.push({
          title,
          read: toNum(txt(idx.read)),
          finish: toPct(txt(idx.finish)),
          like: toNum(txt(idx.like)),
          share: toNum(txt(idx.share)),
          fans: toNum(txt(idx.fans)),
          date: toDate(txt(idx.date)),
        });
      }
      if (out.length) break;
    }
    return out.length ? out : null;
  }

  /* ============================================================
   * 五、合并 + 去重
   * ============================================================ */

  function cleanTitle(s) {
    return String(s || '').replace(/[\s\u3000]+/g, '').replace(/[，。！？、；：""''（）()《》【】\-—]/g, '');
  }

  function dedupeMerge(list) {
    const map = new Map();
    list.forEach((r) => {
      const key = cleanTitle(r.title);
      if (!key) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, r);
        return;
      }
      map.set(key, {
        title: prev.title.length >= r.title.length ? prev.title : r.title,
        read: Math.max(prev.read || 0, r.read || 0),
        finish: Math.max(prev.finish || 0, r.finish || 0),
        like: Math.max(prev.like || 0, r.like || 0),
        share: Math.max(prev.share || 0, r.share || 0),
        fans: Math.max(prev.fans || 0, r.fans || 0),
        date: prev.date || r.date,
      });
    });
    return Array.from(map.values());
  }

  /* ============================================================
   * 六、抓取主流程
   * ============================================================ */

  function scrape() {
    const all = [];
    const diag = { bufferSize: buf.length, jsonHit: 0, domHit: 0, urls: [] };

    // 从新到旧扫缓冲
    for (let i = buf.length - 1; i >= 0; i--) {
      const item = buf[i];
      if (diag.urls.length < 8) diag.urls.push(item.url);
      const recs = extractFromJson(item.body);
      if (recs) {
        diag.jsonHit++;
        all.push.apply(all, recs);
      }
    }

    if (!all.length) {
      const domRecs = extractFromDom();
      if (domRecs) {
        diag.domHit = 1;
        all.push.apply(all, domRecs);
      }
    }

    const records = dedupeMerge(all);

    return {
      ok: records.length > 0,
      source: diag.jsonHit ? 'network' : (diag.domHit ? 'dom' : 'none'),
      records,
      diagnostic: Object.assign(diag, {
        hint: records.length
          ? ''
          : (buf.length
            ? '抓到了 ' + buf.length + ' 条接口响应，但没有识别出图文数据。请确认当前页面是「内容分析 / 图文分析」，并点一次查询或翻页触发加载。'
            : '页面还没加载过数据接口。请先打开「内容分析 → 图文分析」，点一次查询或翻页，再回来抓取。'),
      }),
    };
  }

  /* ============================================================
   * 七、消息接口
   * ============================================================ */

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return false;

      if (msg.type === 'WG_SCRAPE_PING') {
        sendResponse({
          ok: true,
          bufferSize: buf.length,
          href: location.href,
          title: document.title,
        });
        return true;
      }

      if (msg.type === 'WG_SCRAPE_DATA') {
        let result;
        try {
          result = scrape();
        } catch (e) {
          result = { ok: false, source: 'none', records: [], diagnostic: { hint: '解析出错：' + e.message } };
        }
        result.href = location.href;
        result.pageTitle = document.title;
        sendResponse(result);
        return true;
      }

      if (msg.type === 'WG_SCRAPE_CLEAR') {
        buf.length = 0;
        sendResponse({ ok: true });
        return true;
      }

      return false;
    });
  } catch (e) { /* ignore */ }

  /* 测试钩子：仅供 tests/ 页面对解析逻辑做断言，生产路径不依赖它 */
  try {
    window.__WG_SCRAPE_TEST__ = {
      extractFromJson,
      extractFromDom,
      normalize,
      dedupeMerge,
      findRecordArray,
    };
  } catch (e) { /* ignore */ }
})();
