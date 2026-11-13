/* ============================================================
 * Writer Guard · 数据模块
 * 视图：软件选题库 / 投诉看板 / 数据复盘
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;
  const $$ = WG.$$;
  const esc = WG.esc;
  const KEY = WG.KEY;

  /* ============================================================
   * 一、软件选题库
   * ============================================================ */

  function renderSoftware() {
    const list = WG.Store.get(KEY.software, []);
    const q = (($('#sw-search') && $('#sw-search').value) || '').trim().toLowerCase();
    const filtered = q
      ? list.filter((s) => [s.name, s.verdict, s.pit, s.ver]
          .some((v) => String(v || '').toLowerCase().includes(q)))
      : list;

    const tbody = $('#sw-table tbody');
    if (!tbody) return;

    tbody.innerHTML = filtered.length
      ? filtered.map((s) => `<tr>
          <td>${esc(s.name)}</td>
          <td>${esc(s.ver || '—')}</td>
          <td>${WG.riskLabel[s.risk] || ''}</td>
          <td>${esc(s.verdict || '—')}</td>
          <td>${esc(s.date || '—')}</td>
          <td><button class="row-del" data-del="${s.id}" title="删除">×</button></td>
        </tr>`).join('')
      : `<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:24px">
          还没有记录。测过的软件记一行，下次就不会重复选题、重复踩坑。
        </td></tr>`;

    const count = $('#sw-count');
    if (count) count.textContent = filtered.length + ' 条';
  }

  function initSoftware() {
    const btn = $('#btn-sw-add');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const name = ($('#sw-name').value || '').trim();
      if (!name) { WG.toast('软件名不能为空'); return; }

      WG.Store.push(KEY.software, {
        id: WG.uid('sw'),
        name,
        ver: ($('#sw-ver').value || '').trim(),
        risk: $('#sw-risk').value,
        date: $('#sw-date').value || WG.today(),
        verdict: ($('#sw-verdict').value || '').trim(),
        pit: ($('#sw-pit').value || '').trim(),
        createdAt: Date.now(),
      });

      $('#sw-name').value = '';
      $('#sw-ver').value = '';
      $('#sw-verdict').value = '';
      $('#sw-pit').value = '';

      renderSoftware();
      WG.toast('已入库');
    });

    $('#sw-search').addEventListener('input', renderSoftware);

    $('#sw-table').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      WG.Store.remove(KEY.software, b.dataset.del);
      renderSoftware();
      WG.toast('已删除');
    });

    renderSoftware();
  }

  /* ============================================================
   * 二、投诉看板
   * ============================================================ */

  const APPEAL_DEFAULT = `尊敬的平台审核团队：

本人对《__文章标题__》一文于 __日期__ 收到投诉一事，现提交申诉，理由如下：

一、内容性质
该文为对 __软件名称__ 的________（功能介绍 / 使用教程 / 横向评测），属介绍与评论性质，非复制、非传播原作品。

二、素材来源
文中全部界面截图为本人于 __设备__ 上实际操作后录制并后期标注，原始录屏文件已留存，可随时提供；拍摄/录制时间为 __日期__。

三、引用范围
文中提及的软件名称、商标均归其权利人所有，本文仅在必要限度内为说明问题而提及，未构成对原作品的替代，未影响权利人正常使用。

四、诉求
请求复核并恢复该文。如仍需调整，请具体指明需修改处，本人愿意配合修改后重新发布。

附件：原始录屏文件、截图源文件、素材授权凭证

申诉人：__公众号名称__
__日期__`;

  function renderComplaints() {
    const list = WG.Store.get(KEY.complaints, []);
    const tbody = $('#cp-table tbody');
    if (!tbody) return;

    const today = WG.today();

    tbody.innerHTML = list.length
      ? list.map((c) => {
          const [label, cls] = WG.complaintStatus[c.status] || ['未知', 'pill'];
          let deadline = c.deadline ? esc(c.deadline) : '—';
          if (c.deadline && c.status === 'pending') {
            const diff = Math.round(
              (new Date(c.deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000
            );
            if (diff < 0) deadline = `<span style="color:#c9252d">已逾期</span>`;
            else if (diff <= 1) deadline = `<span style="color:#c9252d">剩 ${diff} 天</span>`;
            else deadline = esc(c.deadline) + `<br><span class="muted">剩 ${diff} 天</span>`;
          }
          return `<tr>
            <td>${esc(c.article || '—')}</td>
            <td>${esc(c.who || '—')}</td>
            <td>${esc(WG.complaintType[c.type] || '其他')}</td>
            <td>${esc(c.date || '—')}</td>
            <td><span class="${cls}">${esc(label)}</span></td>
            <td>${deadline}</td>
            <td><button class="row-del" data-del="${c.id}" title="删除">×</button></td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="7" style="text-align:center;color:#8b949e;padding:24px">
          还没有投诉记录。收到投诉第一件事：记下日期，72 小时内必须申诉。
        </td></tr>`;

    const count = $('#cp-count');
    if (count) count.textContent = list.length + ' 条';
  }

  function initComplaints() {
    const pre = $('#appeal-template');
    if (pre) {
      const saved = WG.Store.get('appealTemplate', '');
      if (saved) pre.textContent = saved;
      else pre.textContent = APPEAL_DEFAULT;
    }

    const btnCopy = $('#btn-copy-appeal');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        WG.copy(pre ? pre.textContent : APPEAL_DEFAULT);
      });
    }

    const btn = $('#btn-cp-add');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const article = ($('#cp-article').value || '').trim();
      if (!article) { WG.toast('文章标题不能为空'); return; }

      const date = $('#cp-date').value || WG.today();
      let deadline = $('#cp-deadline').value;
      if (!deadline) {
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() + 3);
        const p = (n) => String(n).padStart(2, '0');
        deadline = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      }

      WG.Store.push(KEY.complaints, {
        id: WG.uid('cp'),
        article,
        who: ($('#cp-who').value || '').trim(),
        type: $('#cp-type').value,
        date,
        deadline,
        status: $('#cp-status').value,
        createdAt: Date.now(),
      });

      $('#cp-article').value = '';
      $('#cp-who').value = '';
      $('#cp-deadline').value = '';

      renderComplaints();
      WG.toast('已登记，截止日 ' + deadline);
    });

    $('#cp-table').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      WG.Store.remove(KEY.complaints, b.dataset.del);
      renderComplaints();
      WG.toast('已删除');
    });

    renderComplaints();
  }

  /* ============================================================
   * 三、数据复盘
   * ============================================================ */

  function renderAnalytics() {
    const list = WG.Store.get(KEY.analytics, []);
    const tbody = $('#an2-table tbody');
    const count = $('#an2-count');
    if (count) count.textContent = list.length + ' 篇';

    if (!tbody) return;

    tbody.innerHTML = list.length
      ? list.map((a) => `<tr>
          <td>${esc(a.title)}</td>
          <td>${esc(a.date || '—')}</td>
          <td class="num">${esc(a.read || '—')}</td>
          <td class="num">${a.finish ? esc(a.finish) + '%' : '—'}</td>
          <td class="num">${esc(a.like || '—')}</td>
          <td class="num">${esc(a.fans || '—')}</td>
          <td class="num">${esc(a.score || '—')}</td>
          <td class="num">${esc(a.ai || '—')}</td>
          <td><button class="row-del" data-del="${a.id}" title="删除">×</button></td>
        </tr>`).join('')
      : `<tr><td colspan="9" style="text-align:center;color:#8b949e;padding:24px">
          还没有数据。累计录 10 篇以上，才能看出评分、AI 度和完读率之间的关系。
        </td></tr>`;

    renderStats(list);
    drawChart(list);
  }

  function renderStats(list) {
    const box = $('#an2-stats');
    if (!box) return;

    if (!list.length) {
      box.innerHTML = '';
      return;
    }

    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const reads = list.map((x) => Number(x.read) || 0).filter((n) => n > 0);
    const finishes = list.map((x) => Number(x.finish) || 0).filter((n) => n > 0);

    const highScore = list.filter((x) => Number(x.score) >= 80);
    const lowScore = list.filter((x) => Number(x.score) < 60);

    const avgHigh = avg(highScore.map((x) => Number(x.finish) || 0));
    const avgLow = avg(lowScore.map((x) => Number(x.finish) || 0));

    box.innerHTML = `
      <div class="stat">
        <div class="stat-label">平均阅读</div>
        <div class="stat-value">${Math.round(avg(reads)) || '—'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">平均完读率</div>
        <div class="stat-value">${finishes.length ? avg(finishes).toFixed(1) : '—'}<small>%</small></div>
      </div>
      <div class="stat">
        <div class="stat-label">评分≥80 篇均完读</div>
        <div class="stat-value">${highScore.length ? avgHigh.toFixed(1) : '—'}<small>%</small></div>
      </div>
      <div class="stat">
        <div class="stat-label">评分&lt;60 篇均完读</div>
        <div class="stat-value">${lowScore.length ? avgLow.toFixed(1) : '—'}<small>%</small></div>
      </div>
    `;
  }

  function drawChart(list) {
    const cv = $('#an2-chart');
    if (!cv) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth || 640;
    const cssH = 180;
    cv.width = cssW * dpr;
    cv.height = cssH * dpr;
    cv.style.width = '100%';
    cv.style.height = cssH + 'px';

    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!list.length) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('录入数据后这里会出现趋势', cssW / 2, cssH / 2);
      return;
    }

    const data = list.slice(0, 12).slice().reverse();
    const pad = { l: 38, r: 38, t: 16, b: 26 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;

    // 网格
    ctx.strokeStyle = '#f0f1f3';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
    }

    const maxRead = Math.max(...data.map((x) => Number(x.read) || 0), 1);

    const xAt = (i) => data.length === 1 ? pad.l + w / 2 : pad.l + (w / (data.length - 1)) * i;
    const yRead = (v) => pad.t + h - ((Number(v) || 0) / maxRead) * h;
    const yScore = (v) => pad.t + h - ((Number(v) || 0) / 100) * h;

    // 阅读量折线
    ctx.strokeStyle = '#1f6feb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xAt(i), y = yRead(d.read);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    data.forEach((d, i) => {
      ctx.fillStyle = '#1f6feb';
      ctx.beginPath();
      ctx.arc(xAt(i), yRead(d.read), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 评分折线
    ctx.strokeStyle = '#30a46c';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xAt(i), y = yScore(d.score);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 轴标
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(maxRead), pad.l - 6, pad.t + 4);
    ctx.fillText('0', pad.l - 6, pad.t + h + 4);
    ctx.textAlign = 'left';
    ctx.fillText('100', pad.l + w + 6, pad.t + 4);
    ctx.fillText('0', pad.l + w + 6, pad.t + h + 4);

    // 图例
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f6feb';
    ctx.fillText('— 阅读量', pad.l, cssH - 8);
    ctx.fillStyle = '#30a46c';
    ctx.fillText('-- 发布评分', pad.l + 70, cssH - 8);
  }

  function initAnalytics() {
    const btn = $('#btn-an2-add');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const title = ($('#an2-title').value || '').trim();
      if (!title) { WG.toast('文章标题不能为空'); return; }

      WG.Store.push(KEY.analytics, {
        id: WG.uid('an'),
        title,
        date: $('#an2-date').value || WG.today(),
        read: Number($('#an2-read').value) || 0,
        finish: Number($('#an2-finish').value) || 0,
        like: Number($('#an2-like').value) || 0,
        fans: Number($('#an2-fans').value) || 0,
        score: Number($('#an2-score').value) || 0,
        ai: Number($('#an2-ai').value) || 0,
        createdAt: Date.now(),
      });

      $('#an2-title').value = '';
      $('#an2-read').value = '';
      $('#an2-finish').value = '';
      $('#an2-like').value = '';
      $('#an2-fans').value = '';
      $('#an2-score').value = '';
      $('#an2-ai').value = '';

      renderAnalytics();
      WG.toast('已录入');
    });

    $('#an2-table').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      WG.Store.remove(KEY.analytics, b.dataset.del);
      renderAnalytics();
      WG.toast('已删除');
    });

    renderAnalytics();
    window.addEventListener('resize', () => {
      clearTimeout(initAnalytics._t);
      initAnalytics._t = setTimeout(() => drawChart(WG.Store.get(KEY.analytics, [])), 180);
    });
  }

  /* ---------- 对外 ---------- */

  WG.initSoftware = initSoftware;
  WG.initComplaints = initComplaints;
  WG.initAnalytics = initAnalytics;

  /* ============================================================
   * 四、从公众号后台抓取数据
   * ============================================================ */

  let scrapeRows = [];

  function cleanTitle(s) {
    return String(s || '').replace(/[\s\u3000]+/g, '').replace(/[，。！？、；：""''（）()《》【】\-—]/g, '');
  }

  function activeTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs && tabs[0]));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function sendToTab(tabId, msg) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, msg: chrome.runtime.lastError.message });
          else resolve(res || { ok: false, msg: '没有响应' });
        });
      } catch (e) {
        resolve({ ok: false, msg: e.message });
      }
    });
  }

  function renderScrapePreview(records, meta) {
    const box = $('#scrape-preview');
    if (!box) return;

    if (!records || !records.length) {
      box.innerHTML = '';
      return;
    }

    const existing = WG.Store.get(KEY.analytics, []);
    const map = new Map();
    existing.forEach((x) => map.set(cleanTitle(x.title), x));

    scrapeRows = records.map((r) => {
      const prev = map.get(cleanTitle(r.title));
      let kind = 'new';
      if (prev) {
        const changed =
          Number(r.read) > Number(prev.read || 0) ||
          Number(r.finish) > Number(prev.finish || 0) ||
          Number(r.like) > Number(prev.like || 0);
        kind = changed ? 'upd' : 'same';
      }
      return Object.assign({}, r, {
        kind,
        prevId: prev ? prev.id : null,
        pick: kind !== 'same',
      });
    });

    const kindLabel = { new: '新增', upd: '更新', same: '无变化' };
    const cnt = { new: 0, upd: 0, same: 0 };
    scrapeRows.forEach((r) => cnt[r.kind]++);

    box.innerHTML = `
      <div class="scrape-table">
        <div class="muted" style="margin-bottom:8px">
          来源：${meta.source === 'network' ? '接口拦截' : meta.source === 'dom' ? '页面表格' : '无'}
          · 抓到 ${scrapeRows.length} 条（新增 ${cnt.new} / 更新 ${cnt.upd} / 无变化 ${cnt.same}）
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th style="width:34px"><input type="checkbox" id="scrape-all" class="row-pick" checked></th>
            <th>标题</th><th>日期</th><th>阅读</th><th>完读</th><th>在看</th><th>状态</th>
          </tr></thead>
          <tbody>
            ${scrapeRows.map((r, i) => `<tr>
              <td><input type="checkbox" class="row-pick" data-i="${i}" ${r.pick ? 'checked' : ''}></td>
              <td>${esc(r.title)}</td>
              <td>${esc(r.date || '—')}</td>
              <td class="num">${r.read || 0}</td>
              <td class="num">${r.finish ? r.finish + '%' : '—'}</td>
              <td class="num">${r.like || 0}</td>
              <td><span class="scrape-tag" data-kind="${r.kind}">${kindLabel[r.kind]}</span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="scrape-actions">
          <button class="btn btn-primary" id="btn-scrape-apply">写入复盘看板</button>
          <span class="muted">只写入勾选的行；更新会覆盖原有阅读/完读/在看数值</span>
        </div>
      </div>
    `;

    const all = box.querySelector('#scrape-all');
    if (all) {
      all.addEventListener('change', () => {
        box.querySelectorAll('.row-pick[data-i]').forEach((cb) => {
          cb.checked = all.checked;
          scrapeRows[Number(cb.dataset.i)].pick = all.checked;
        });
      });
    }

    box.querySelectorAll('.row-pick[data-i]').forEach((cb) => {
      cb.addEventListener('change', () => {
        scrapeRows[Number(cb.dataset.i)].pick = cb.checked;
      });
    });

    const apply = box.querySelector('#btn-scrape-apply');
    if (apply) {
      apply.addEventListener('click', () => {
        const picked = scrapeRows.filter((r) => r.pick);
        if (!picked.length) { WG.toast('没有勾选任何行'); return; }

        let added = 0;
        let updated = 0;

        picked.forEach((r) => {
          const list = WG.Store.get(KEY.analytics, []);
          const idx = list.findIndex((x) => x.id === r.prevId);

          if (idx >= 0) {
            list[idx] = Object.assign({}, list[idx], {
              read: r.read || list[idx].read,
              finish: r.finish || list[idx].finish,
              like: r.like || list[idx].like,
              fans: r.fans || list[idx].fans,
              date: r.date || list[idx].date,
              updatedAt: Date.now(),
            });
            WG.Store.set(KEY.analytics, list);
            updated++;
          } else {
            WG.Store.push(KEY.analytics, {
              id: WG.uid('an'),
              title: r.title,
              date: r.date || WG.today(),
              read: r.read || 0,
              finish: r.finish || 0,
              like: r.like || 0,
              fans: r.fans || 0,
              score: 0,
              ai: 0,
              source: 'scrape',
            });
            added++;
          }
        });

        renderAnalytics();
        renderScrapePreview(records, meta);
        WG.toast('已写入：新增 ' + added + ' 条，更新 ' + updated + ' 条');
      });
    }
  }

  async function doScrape() {
    const msg = $('#scrape-msg');
    const tab = await activeTab();

    if (!tab || !tab.id) {
      if (msg) msg.textContent = '读不到当前标签页';
      return;
    }
    if (!/^https:\/\/mp\.weixin\.qq\.com\//.test(tab.url || '')) {
      if (msg) msg.textContent = '当前标签页不是公众号后台，先切到数据页';
      const box = $('#scrape-preview');
      if (box) {
        box.innerHTML = `<div class="warnbox" style="margin-top:12px">
          <p><b>当前标签页不是公众号后台。</b></p>
          <p>操作顺序：</p>
          <p>1. 点上面的「打开图文分析页」</p>
          <p>2. 在页面里点一次查询或翻页，让数据加载出来</p>
          <p>3. 回到这个标签页点「抓取当前标签页」</p>
        </div>`;
      }
      return;
    }

    if (msg) msg.textContent = '抓取中…';
    const res = await sendToTab(tab.id, { type: 'WG_SCRAPE_DATA' });

    if (!res || !res.ok) {
      const hint = (res && res.diagnostic && res.diagnostic.hint) || (res && res.msg) || '没有抓到数据';
      if (msg) msg.textContent = '未抓到';
      $('#scrape-preview').innerHTML = `<div class="warnbox" style="margin-top:12px">
        <p>${esc(hint)}</p>
        <p>如果一直抓不到，说明公众号后台换了接口，用下面的「录入一篇的复盘数据」手动填，或改 <code>content/data-scrape.js</code> 里的字段映射。</p>
      </div>`;
      return;
    }

    if (msg) msg.textContent = '抓到 ' + res.records.length + ' 条 · ' + (res.source === 'network' ? '接口拦截' : '页面表格');
    renderScrapePreview(res.records, res);
  }

  function initScrape() {
    const btn = $('#btn-scrape');
    if (!btn) return;

    btn.addEventListener('click', doScrape);

    const btnOpen = $('#btn-scrape-open');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        try {
          chrome.tabs.create({ url: 'https://mp.weixin.qq.com/' });
          WG.toast('已打开公众号后台，登录后进「内容分析 → 图文分析」');
        } catch (e) {
          WG.toast('打开失败，手动访问 mp.weixin.qq.com');
        }
      });
    }

    const btnClear = $('#btn-scrape-clear');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        const tab = await activeTab();
        if (!tab || !tab.id) return;
        const r = await sendToTab(tab.id, { type: 'WG_SCRAPE_CLEAR' });
        WG.toast(r && r.ok ? '缓存已清空，去数据页点一次查询再抓' : '清空失败');
        $('#scrape-preview').innerHTML = '';
        const msg = $('#scrape-msg');
        if (msg) msg.textContent = '未抓取';
      });
    }
  }

  WG.initScrape = initScrape;
})(typeof globalThis !== 'undefined' ? globalThis : this);
