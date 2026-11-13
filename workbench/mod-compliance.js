/* ============================================================
 * Writer Guard · 合规拦截模块
 * 视图：检测台 / 标题改写 / 字体自查
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const E = () => WG.Engine;
  const $ = WG.$;
  const $$ = WG.$$;
  const esc = WG.esc;

  const LEVEL_LABEL = { block: '必删', warn: '高危', tip: '提示' };

  function catName(id) {
    const DICT = root.WG_DICT || {};
    const map = DICT.categoryRules || {};
    return map[id] ? map[id].name : '';
  }

  /* ============================================================
   * 一、检测台
   * ============================================================ */

  function renderHits(hits, limit) {
    if (!hits.length) {
      return WG.emptyHtml('未命中。继续保持：不给破解版、不放网盘、不做诱导。');
    }
    return hits.slice(0, limit || 120).map((h, i) => {
      const swap = h.swap || '';
      const isDelete = /（删除|整段删除）/.test(swap);
      return `
      <div class="hit" data-level="${h.level}" data-hit-i="${i}">
        <div class="hit-top">
          <span class="badge" data-level="${h.level}">${LEVEL_LABEL[h.level] || '提示'}</span>
          <span class="hit-name">${esc(h.groupName)}</span>
          ${h.category && h.category !== 'common' ? `<span class="badge">${esc(catName(h.category))}</span>` : ''}
          <code class="hit-word">${esc(h.word)}</code>
        </div>
        <div class="hit-ctx">${esc(h.context)}</div>
        <div class="hit-why">${esc(h.why)}</div>
        ${swap ? `<div class="hit-swap ${isDelete ? 'is-del' : ''}">
          <span class="hit-swap-label">替换为</span>
          <code class="hit-swap-word">${esc(swap)}</code>
          <button class="hit-swap-btn" data-swap-i="${i}">替换</button>
        </div>` : ''}
        <div class="hit-fix">改法：${esc(h.suggest)}</div>
      </div>`;
    }).join('');
  }

  function renderScore(sc) {
    const ring = $('#score-ring');
    const num = $('#score-num');
    const verdict = $('#score-verdict');
    const sub = $('#score-sub');
    const chips = $('#score-chips');

    num.textContent = sc.percent;
    const level = sc.percent >= 80 ? 'good' : sc.percent >= 60 ? 'mid' : 'bad';
    ring.dataset.level = level;

    if (sc.blockedNow) {
      verdict.textContent = '存在阻断项，不要发';
      verdict.dataset.level = 'bad';
      sub.textContent = '红线或 AI 痕迹超阈值，先改再发';
    } else if (sc.percent < 80) {
      verdict.textContent = '可以发，但有优化项';
      verdict.dataset.level = 'mid';
      sub.textContent = '把没过的项目补上，推荐量会明显不同';
    } else {
      verdict.textContent = '通过，可以发布';
      verdict.dataset.level = 'good';
      sub.textContent = '结构和合规都过线了';
    }

    const fails = sc.checks.filter((c) => !c.pass);
    chips.innerHTML = fails.length
      ? fails.map((c) => `<span>${esc(c.name)}</span>`).join('')
      : '<span>全部通过</span>';

    $('#checklist').innerHTML = sc.checks.map((c) => `
      <div class="check ${c.pass ? 'is-pass' : 'is-fail'}" title="${esc(c.fix || '')}">
        <span class="check-ico">${c.pass ? '✓' : '✕'}</span>
        <span class="check-name">${esc(c.name)}</span>
        ${c.block && !c.pass ? '<span class="badge" data-level="block">阻断</span>' : ''}
        <span class="check-score">${c.pass ? c.score : 0}/${c.score}</span>
      </div>
    `).join('');
  }

  function renderAI(ai) {
    const scoreEl = $('#ai-score');
    scoreEl.textContent = ai.score;
    scoreEl.dataset.level = ai.verdict;

    const bar = $('#ai-bar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, Number(ai.score) || 0));
      const color = pct >= 70 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#10b981';
      bar.style.background =
        'linear-gradient(90deg, ' + color + ' 0%, ' + color + ' ' + pct + '%, ' +
        '#e7ebf2 ' + pct + '%, #e7ebf2 100%)';
    }

    $('#ai-metrics').innerHTML = [
      `命中 ${ai.totalHits} 次`,
      `密度 ${ai.density}/千字`,
      `句长σ ${ai.sentenceStd}`,
      `段长σ ${ai.paragraphStd}`,
      `字数 ${ai.charCount}`,
    ].map((s) => `<span>${esc(s)}</span>`).join('');

    const hintBox = $('#ai-short-hint');
    if (hintBox) {
      hintBox.innerHTML = (ai.charCount > 0 && ai.charCount < 220)
        ? `<div class="tipbox" style="margin-top:9px">样本 ${ai.charCount} 字，偏短。AI 度对短文本不敏感，建议 300 字以上再把这个分数当结论。</div>`
        : '';
    }

    const groups = $('#ai-groups');
    if (!ai.groups.length) {
      groups.innerHTML = WG.emptyHtml('未检出 AI 痕迹词。');
      return;
    }
    groups.innerHTML = ai.groups.map((g) => `
      <div class="hit" data-level="warn">
        <div class="hit-top">
          <span class="badge" data-level="warn">${g.count}</span>
          <span class="hit-name">${esc(g.name)}</span>
        </div>
        <div class="hit-ctx">${g.words.map((w) => `<code class="hit-word">${esc(w)}</code>`).join(' ')}</div>
        <div class="hit-why">${esc(g.why)}</div>
        <div class="hit-fix">改法：${esc(g.fix)}</div>
      </div>
    `).join('');
  }

  function runScan(opts) {
    const title = $('#in-title').value || '';
    const body = $('#in-body').value || '';

    if (!title.trim() && !body.trim()) {
      WG.toast('先粘贴标题或正文');
      return;
    }

    const cats = WG.getCategories ? WG.getCategories() : [];
    const redline = E().scanRedline(title + '\n' + body, cats);
    const ai = E().scanAITrace(body);
    const sc = E().buildScore(title, body, redline, ai);

    renderScore(sc);
    renderAI(ai);
    $('#redline-count').textContent = redline.length + ' 处';

    const rlList = $('#redline-list');
    if (rlList) {
      rlList.innerHTML = renderHits(redline);
      rlList.__hits = redline;
      if (!rlList.__swapBound) {
        rlList.__swapBound = true;
        rlList.addEventListener('click', (ev) => {
          const btn = ev.target.closest('.hit-swap-btn');
          if (!btn) return;
          const h = (rlList.__hits || [])[Number(btn.dataset.swapI)];
          if (h) applySwap(h);
        });
      }
    }

    $('#scan-meta').textContent =
      '已检测 · ' + WG.fmtTime(Date.now()) +
      ' · ' + (body.replace(/\s/g, '').length) + ' 字' +
      (cats.length ? ' · 品类 ' + cats.map(catName).join('+') : '');

    WG.Store.set(WG.KEY.lastScan, {
      title, total: sc.percent, aiScore: ai.score,
      redline: redline.length, ts: Date.now(),
    });

    if (!opts || !opts.silent) {
      WG.toast('检测完成：' + sc.percent + ' 分');
    }
  }

  /* 按建议词替换正文里的第一处命中 */
  function applySwap(h) {
    const ta = $('#in-body');
    if (!ta) return;

    const word = h.word;
    if (!word) return;

    const text = ta.value || '';
    const isDelete = /（删除|整段删除）/.test(h.swap || '');
    const replacement = isDelete ? '' : String(h.swap).replace(/（[^）]*）/g, '').trim();

    const idx = text.indexOf(word);
    if (idx < 0) return WG.toast('正文里已经找不到「' + word + '」了');

    ta.value = text.slice(0, idx) + replacement + text.slice(idx + word.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    WG.toast(isDelete
      ? '已删除「' + word + '」'
      : '「' + word + '」→「' + replacement + '」');

    setTimeout(() => runScan({ silent: true }), 240);
  }

  function initCompliance() {
    const btnScan = $('#btn-scan');
    if (btnScan) btnScan.addEventListener('click', runScan);

    /* ---------- 一键降 AI 味 ---------- */

    let aiFixBackup = null;

    function applyAIFix() {
      const ta = $('#in-body');
      if (!ta) return;
      const src = ta.value || '';
      if (!src.trim()) return WG.toast('先粘贴正文再改写');

      const R = WG.Rewriter;
      if (!R) return WG.toast('改写引擎未加载');

      const r = R.rewrite(src);
      const box = $('#ai-fix-result');

      if (!r.changed) {
        if (box) {
          box.innerHTML = `<div class="aifix-box">
            <div class="aifix-head"><b>没找到能自动改写的点</b></div>
            <div class="aifix-note">规则只能处理词和套话层面的问题。如果 AI 度还是偏高，说明问题在
              <b>句式结构</b>（每句长度太接近）和<b>缺少真实细节</b>——这两项得手动改：
              插一句 5 字以内的短句，再加一条具体版本号或报错原文。</div>
          </div>`;
        }
        return;
      }

      aiFixBackup = src;
      ta.value = r.text;

      const undoBtn = $('#btn-ai-undo');
      if (undoBtn) undoBtn.disabled = false;

      const sum = R.summarize(r.changes);
      const tags = Object.keys(sum)
        .map((k) => `<span class="aifix-tag">${esc(k)} <b>${sum[k]}</b></span>`)
        .join('');

      if (box) {
        box.innerHTML = `<div class="aifix-box">
          <div class="aifix-head">
            <span class="aifix-ok">已改写 ${r.count} 处</span>
            <span class="muted">${r.before} 字 → ${r.after} 字${
              r.saved > 0 ? '（省 ' + r.saved + ' 字）'
                : r.saved < 0 ? '（多 ' + (-r.saved) + ' 字，白话通常比黑话长）'
                : ''
            }</span>
          </div>
          <div class="aifix-tags">${tags}</div>
          <div class="aifix-list">
            ${r.changes.slice(0, 40).map((c) => `<div class="aifix-item">
              <span class="aifix-label">${esc(c.label)}</span>
              <code class="aifix-from">${esc(c.from)}</code>
              <span class="aifix-arrow">→</span>
              <code class="aifix-to">${c.to ? esc(c.to) : '删除'}</code>
            </div>`).join('')}
            ${r.changes.length > 40 ? `<div class="aifix-more">…还有 ${r.changes.length - 40} 处同类修改</div>` : ''}
          </div>
          <div class="aifix-note">改完记得通读一遍：规则只动词，不改句子结构。有读着不顺的地方手动调。</div>
        </div>`;
      }

      WG.toast('已改写 ' + r.count + ' 处，点「恢复原文」可回退');
      runScan();
    }

    function undoAIFix() {
      if (aiFixBackup == null) return WG.toast('没有可恢复的原文');
      const ta = $('#in-body');
      if (ta) ta.value = aiFixBackup;
      aiFixBackup = null;

      const undoBtn = $('#btn-ai-undo');
      if (undoBtn) undoBtn.disabled = true;
      const box = $('#ai-fix-result');
      if (box) box.innerHTML = '';

      runScan();
      WG.toast('已恢复原文');
    }

    const btnFix = $('#btn-ai-fix');
    if (btnFix) btnFix.addEventListener('click', applyAIFix);

    const btnUndo = $('#btn-ai-undo');
    if (btnUndo) btnUndo.addEventListener('click', undoAIFix);

    const btnClear = $('#btn-clear-input');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        $('#in-title').value = '';
        $('#in-body').value = '';
        $('#score-num').textContent = '--';
        $('#ai-score').textContent = '--';
        $('#ai-bar').style.background = '#e7ebf2';
        $('#redline-count').textContent = '0 处';
        $('#redline-list').innerHTML = WG.emptyHtml('清空了。粘贴新内容再检测');
        $('#checklist').innerHTML = '';
        $('#ai-groups').innerHTML = '';
        $('#ai-metrics').innerHTML = '';
        $('#score-verdict').textContent = '等待检测';
        $('#score-verdict').removeAttribute('data-level');
        $('#score-sub').textContent = '填好内容后点「开始检测」';
        $('#score-chips').innerHTML = '';
        $('#score-ring').removeAttribute('data-level');
        $('#scan-meta').textContent = '未检测';
      });
    }

    const btnPasteTitle = $('#btn-paste-title');
    if (btnPasteTitle) {
      btnPasteTitle.addEventListener('click', async () => {
        try {
          const t = await navigator.clipboard.readText();
          $('#in-title').value = t.trim().slice(0, 200);
          WG.toast('标题已粘贴');
        } catch (e) {
          WG.toast('浏览器未授权读取剪贴板，请手动粘贴');
        }
      });
    }

    const btnPasteBody = $('#btn-paste-body');
    if (btnPasteBody) {
      btnPasteBody.addEventListener('click', async () => {
        try {
          const t = await navigator.clipboard.readText();
          $('#in-body').value = t;
          WG.toast('正文已粘贴');
        } catch (e) {
          WG.toast('浏览器未授权读取剪贴板，请手动粘贴');
        }
      });
    }

    // 快捷键 Ctrl/Cmd + Enter 直接检测
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const v = $('.view:not(.is-hide)');
        if (v && v.dataset.view === 'compliance') {
          e.preventDefault();
          runScan();
        }
      }
    });

    // 恢复上一次结果摘要
    const last = WG.Store.get(WG.KEY.lastScan, null);
    if (last && last.title) {
      $('#scan-meta').textContent = '上次检测 ' + WG.fmtTime(last.ts) + ' · ' + last.total + ' 分';
    }
  }

  /* ============================================================
   * 二、标题改写
   * ============================================================ */

  function initTitleRewrite() {
    const btn = $('#btn-rewrite');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const title = ($('#title-input').value || '').trim();
      if (!title) { WG.toast('先输入一个标题'); return; }

      const issues = E().detectTitleIssues(title);
      const diag = $('#title-diagnose');

      if (!issues.length) {
        diag.innerHTML = `<div class="para"><p>没检出明显问题。可以再自己看两点：</p>
          <p>1. 标题里有没有一个具体数字</p><p>2. 有没有一个具体场景词</p></div>`;
      } else {
        diag.innerHTML = issues.map((i) => `
          <div class="hit" data-level="${i.level === 'warn' ? 'warn' : 'tip'}">
            <div class="hit-top">
              <span class="badge" data-level="${i.level === 'warn' ? 'warn' : ''}">${esc(i.kind)}</span>
              <code class="hit-word">${esc(i.word)}</code>
            </div>
            <div class="hit-fix">改法：${esc(i.fix)}</div>
          </div>
        `).join('');
      }

      const cands = E().rewriteTitle(title);
      const box = $('#title-suggest');
      if (!cands.length) {
        box.innerHTML = WG.emptyHtml('原标题里能提取的信息太少，先写清楚「哪个软件 + 做什么」再试');
        return;
      }
      box.innerHTML = cands.map((c, i) => `
        <div class="hit" data-level="tip" style="cursor:pointer" data-title="${esc(c.text)}">
          <div class="hit-top">
            <span class="badge">${i + 1}</span>
            <span class="hit-name">${esc(c.text)}</span>
            <span class="muted" style="margin-left:auto">${c.text.length} 字</span>
          </div>
          <div class="hit-fix">${esc(c.note)}</div>
        </div>
      `).join('');

      $$('#title-suggest .hit').forEach((el) => {
        el.addEventListener('click', () => WG.copy(el.dataset.title));
      });
    });

    $('#title-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
    });
  }

  /* ============================================================
   * 三、字体自查
   * ============================================================ */

  function initFontCheck() {
    const DICT = root.WG_DICT || {};
    const allowBox = $('#font-allow');
    const denyBox = $('#font-deny');

    if (allowBox) {
      allowBox.innerHTML = ((DICT.fonts && DICT.fonts.allow) || [])
        .map((f) => `<span class="tag good">${esc(f)}</span>`).join('');
    }
    if (denyBox) {
      denyBox.innerHTML = ((DICT.fonts && DICT.fonts.deny) || [])
        .map((f) => `<span class="tag bad">${esc(f)}</span>`).join('');
    }

    const btn = $('#btn-font-check');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const input = $('#font-input').value || '';
      const results = E().checkFonts(input);
      const box = $('#font-result');

      if (!results.length) {
        box.innerHTML = WG.emptyHtml('没读到字体名，一行一个贴进来');
        return;
      }

      const bad = results.filter((r) => r.status === 'deny');
      const unknown = results.filter((r) => r.status === 'unknown');

      box.innerHTML = `
        <div class="checklist" style="margin-top:12px">
          ${results.map((r) => {
            const pass = r.status === 'allow';
            const cls = r.status === 'deny' ? 'is-fail' : pass ? 'is-pass' : '';
            const ico = r.status === 'deny' ? '✕' : pass ? '✓' : '?';
            const tag = r.status === 'deny'
              ? '<span class="badge" data-level="block">需授权</span>'
              : pass ? '<span class="pill pill-good">可商用</span>'
                     : '<span class="pill pill-warn">未收录，自行核对</span>';
            return `<div class="check ${cls}">
              <span class="check-ico">${ico}</span>
              <span class="check-name">${esc(r.name)}</span>
              ${tag}
            </div>`;
          }).join('')}
        </div>
        ${bad.length ? `<div class="warnbox" style="margin-top:12px">
          <p>命中 <b>${bad.length}</b> 个需授权字体。字体公司有成熟的取证流程，公众号是最容易批量取证的场景。</p>
          <p>立刻换掉，或者去字体厂商官网买商用授权并留好订单号。</p>
        </div>` : ''}
        ${unknown.length ? `<div class="warnbox" style="margin-top:10px">
          <p>有 <b>${unknown.length}</b> 个字体不在词库里。判断方法：去字体官网找「授权说明」，只有明确写了「免费商用」的才能用在公众号。</p>
        </div>` : ''}
      `;
    });
  }

  /* ---------- 对外 ---------- */

  WG.initCompliance = initCompliance;
  WG.initTitleRewrite = initTitleRewrite;
  WG.initFontCheck = initFontCheck;
  WG.runScan = runScan;
})(typeof globalThis !== 'undefined' ? globalThis : this);
