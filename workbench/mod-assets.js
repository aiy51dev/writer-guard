/* ============================================================
 * Writer Guard · 资产管理模块
 * 视图：素材台账 / 重复图预警
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;
  const $$ = WG.$$;
  const esc = WG.esc;
  const KEY = WG.KEY;

  /* ============================================================
   * 一、素材台账
   * ============================================================ */

  function assetRow(a) {
    const today = WG.today();
    let statusHtml = '<span class="pill">正常</span>';
    if (a.expire) {
      if (a.expire < today) statusHtml = '<span class="pill pill-bad">已过期</span>';
      else if (daysBetween(today, a.expire) <= 30) statusHtml = '<span class="pill pill-warn">30天内到期</span>';
    }
    if (a.source === 'other') statusHtml = '<span class="pill pill-bad">高风险来源</span>';
    if (a.source === 'official') statusHtml = '<span class="pill pill-warn">需确认授权</span>';

    return `<tr>
      <td>${esc(a.name)}</td>
      <td>${esc(WG.sourceLabel[a.source] || a.source)}</td>
      <td>${esc(a.proof || '—')}</td>
      <td>${esc(a.expire || '—')}</td>
      <td>${esc(a.article || '—')}</td>
      <td>${statusHtml}</td>
      <td><button class="row-del" data-del="${a.id}" title="删除">×</button></td>
    </tr>`;
  }

  function daysBetween(a, b) {
    const t1 = new Date(a + 'T00:00:00').getTime();
    const t2 = new Date(b + 'T00:00:00').getTime();
    return Math.round((t2 - t1) / 86400000);
  }

  function renderAssets() {
    const list = WG.Store.get(KEY.assets, []);
    const q = (($('#asset-search') && $('#asset-search').value) || '').trim().toLowerCase();
    const filtered = q
      ? list.filter((a) => [a.name, a.article, a.note, a.proof]
          .some((v) => String(v || '').toLowerCase().includes(q)))
      : list;

    const tbody = $('#asset-table tbody');
    if (!tbody) return;

    tbody.innerHTML = filtered.length
      ? filtered.map(assetRow).join('')
      : `<tr><td colspan="7" style="text-align:center;color:#8b949e;padding:24px">
          还没有记录。每张图发之前登记一次，被投诉时这就是你的第一道证据。
        </td></tr>`;

    const count = $('#asset-count');
    if (count) count.textContent = filtered.length + ' 条';
  }

  function initAssets() {
    const btn = $('#btn-asset-add');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const name = ($('#as-name').value || '').trim();
      if (!name) { WG.toast('素材名称不能为空'); return; }

      WG.Store.push(KEY.assets, {
        id: WG.uid('as'),
        name,
        source: $('#as-source').value,
        proof: ($('#as-proof').value || '').trim(),
        expire: $('#as-expire').value || '',
        article: ($('#as-article').value || '').trim(),
        note: ($('#as-note').value || '').trim(),
        createdAt: Date.now(),
      });

      $('#as-name').value = '';
      $('#as-proof').value = '';
      $('#as-expire').value = '';
      $('#as-article').value = '';
      $('#as-note').value = '';

      renderAssets();
      WG.toast('已登记');
    });

    $('#asset-search').addEventListener('input', renderAssets);

    $('#asset-table').addEventListener('click', (e) => {
      const btnDel = e.target.closest('[data-del]');
      if (!btnDel) return;
      WG.Store.remove(KEY.assets, btnDel.dataset.del);
      renderAssets();
      WG.toast('已删除');
    });

    renderAssets();
  }

  /* ============================================================
   * 二、重复图预警
   * ============================================================ */

  // 感知哈希：缩到 9x8 灰度，比较相邻像素，得到 64 bit 指纹
  function hashImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const w = 9, h = 8;
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;

          const gray = [];
          for (let i = 0; i < w * h; i++) {
            gray.push(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
          }

          let bits = '';
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w - 1; x++) {
              bits += gray[y * w + x] > gray[y * w + x + 1] ? '1' : '0';
            }
          }
          let hex = '';
          for (let i = 0; i < bits.length; i += 4) {
            hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
          }

          // 缩略图
          const maxW = 160;
          const ratio = Math.min(1, maxW / img.width);
          const tw = Math.max(1, Math.round(img.width * ratio));
          const th = Math.max(1, Math.round(img.height * ratio));
          const tc = document.createElement('canvas');
          tc.width = tw; tc.height = th;
          tc.getContext('2d').drawImage(img, 0, 0, tw, th);
          const thumb = tc.toDataURL('image/jpeg', 0.62);

          URL.revokeObjectURL(url);
          resolve({ hash: hex, thumb, width: img.width, height: img.height });
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 999;
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      d += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
    }
    return d;
  }

  function renderDup() {
    const list = WG.Store.get(KEY.dupimg, []);
    const box = $('#dup-list');
    const count = $('#dup-count');
    if (count) count.textContent = list.length + ' 张';
    if (!box) return;

    if (!list.length) {
      box.innerHTML = WG.emptyHtml('还没有登记图片。把你用过的图拖进来建立指纹库');
      return;
    }

    box.innerHTML = list.map((it) => `
      <div class="thumb ${it.dup ? 'is-dup' : ''}" data-hash="${esc(it.hash)}">
        ${it.dup ? '<span class="thumb-flag">重复</span>' : ''}
        <img src="${it.thumb}" alt="">
        <div class="thumb-meta">
          ${esc(it.name)}<br>
          ${it.width}×${it.height}<br>
          ${esc(WG.fmtTime(it.ts))}
        </div>
      </div>
    `).join('');

    box.querySelectorAll('.thumb').forEach((el) => {
      el.addEventListener('click', () => {
        const hash = el.dataset.hash;
        const next = WG.Store.get(KEY.dupimg, []).filter((x) => x.hash !== hash);
        WG.Store.set(KEY.dupimg, next);
        renderDup();
        WG.toast('已删除指纹记录');
      });
    });
  }

  async function ingestFiles(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (!list.length) { WG.toast('没有可用的图片'); return; }

    const store = WG.Store.get(KEY.dupimg, []);
    let dupCount = 0;

    for (const f of list) {
      try {
        const info = await hashImage(f);
        // 和已存库比对
        let best = 999;
        for (const old of store) {
          const d = hamming(info.hash, old.hash);
          if (d < best) best = d;
        }
        const isDup = best <= 5;
        if (isDup) dupCount++;

        store.unshift({
          id: WG.uid('img'),
          name: f.name,
          hash: info.hash,
          thumb: info.thumb,
          width: info.width,
          height: info.height,
          ts: Date.now(),
          dup: isDup,
          nearest: best === 999 ? null : best,
        });
      } catch (e) { /* skip */ }
    }

    WG.Store.set(KEY.dupimg, store.slice(0, 300));
    renderDup();
    WG.toast(dupCount > 0
      ? `登记 ${list.length} 张，其中 ${dupCount} 张疑似重复`
      : `登记 ${list.length} 张，未发现重复`);
  }

  function initDup() {
    const drop = $('#dup-drop');
    const file = $('#dup-file');
    if (!drop || !file) return;

    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      ingestFiles(file.files);
      file.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
      });
    });
    drop.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files) ingestFiles(e.dataTransfer.files);
    });

    const btnCheck = $('#btn-dup-check');
    if (btnCheck) {
      btnCheck.addEventListener('click', () => {
        const list = WG.Store.get(KEY.dupimg, []);
        if (list.length < 2) { WG.toast('至少要有 2 张才能比对'); return; }
        let flagged = 0;
        for (let i = 0; i < list.length; i++) {
          list[i].dup = false;
          for (let j = 0; j < list.length; j++) {
            if (i === j) continue;
            if (hamming(list[i].hash, list[j].hash) <= 5) { list[i].dup = true; break; }
          }
          if (list[i].dup) flagged++;
        }
        WG.Store.set(KEY.dupimg, list);
        renderDup();
        WG.toast(flagged ? `发现 ${flagged} 张重复或高度相似` : '没有发现重复');
      });
    }

    const btnClear = $('#btn-dup-clear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        WG.Store.set(KEY.dupimg, []);
        renderDup();
        WG.toast('已清空图片指纹');
      });
    }

    renderDup();
  }

  /* ---------- 对外 ---------- */

  WG.initAssets = initAssets;
  WG.initDup = initDup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
