/* ============================================================
 * Writer Guard · 团队设置模块
 * 视图：团队设置（操作人 / 品类 / CSV 互换 / 变更日志 / 备份）
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;
  const $$ = WG.$$;
  const esc = WG.esc;
  const KEY = WG.KEY;

  const MODULE_LABEL = {
    assets: '素材台账',
    software: '软件选题库',
    complaints: '投诉看板',
    analytics: '数据复盘',
    dupimg: '图片指纹',
    csv: 'CSV',
    'json-merge': 'JSON 合并',
  };

  const ACTION_LABEL = {
    add: '新增',
    del: '删除',
    import: '导入',
  };

  /* ============================================================
   * 品类
   * ============================================================ */

  function renderCatPick() {
    const box = $('#cat-pick');
    const bar = $('#cat-bar');
    const DICT = root.WG_DICT || {};
    const cats = DICT.categoryRules || {};
    const sel = WG.getCategories();

    if (box) {
      box.innerHTML = Object.keys(cats).map((id) => {
        const c = cats[id];
        const on = sel.includes(id);
        return `<label class="cat-option ${on ? 'is-on' : ''}">
          <input type="checkbox" value="${esc(id)}" ${on ? 'checked' : ''}>
          <div class="cat-option-body">
            <b>${esc(c.name)}</b>
            <span>${esc(c.desc)} · 专属规则 ${c.rules.length} 条</span>
          </div>
        </label>`;
      }).join('');

      box.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          WG.toggleCategory(cb.value);
          renderCatPick();
          renderCatBar();
          WG.toast('品类已更新，重新检测生效');
        });
      });
    }

    const msg = $('#cat-pick-msg');
    if (msg) {
      if (!sel.length) msg.textContent = '当前：仅通用规则';
      else {
        const names = sel.map((id) => (cats[id] ? cats[id].name : id));
        let n = 0;
        sel.forEach((id) => { if (cats[id]) n += cats[id].rules.length; });
        msg.textContent = '当前：' + names.join(' + ') + '（叠加 ' + n + ' 条专属规则）';
      }
    }
  }

  function renderCatBar() {
    const bar = $('#cat-bar');
    if (!bar) return;
    const sel = WG.getCategories();
    const DICT = root.WG_DICT || {};
    const cats = DICT.categoryRules || {};

    bar.querySelectorAll('.cat-chip').forEach((chip) => {
      const on = sel.includes(chip.dataset.cat);
      chip.classList.toggle('is-on', on);
      if (!chip.__bound) {
        chip.__bound = true;
        chip.addEventListener('click', () => {
          WG.toggleCategory(chip.dataset.cat);
          renderCatBar();
          renderCatPick();
        });
      }
    });

    const hint = $('#cat-hint');
    if (hint) {
      if (!sel.length) hint.textContent = '未选则只用通用规则';
      else {
        let n = 0;
        sel.forEach((id) => { if (cats[id]) n += cats[id].rules.length; });
        hint.textContent = '已叠加 ' + n + ' 条专属规则';
      }
    }
  }

  /* ============================================================
   * 变更日志
   * ============================================================ */

  function renderLog() {
    const list = WG.Store.get(KEY.changelog, []);
    const box = $('#log-list');
    const count = $('#log-count');
    if (count) count.textContent = list.length + ' 条';
    if (!box) return;

    if (!list.length) {
      box.innerHTML = WG.emptyHtml('还没有操作记录。团队合并台账时，这里能看清谁动了什么');
      return;
    }

    box.innerHTML = list.slice(0, 200).map((l) => `
      <div class="log-item">
        <span class="log-dot" data-action="${esc(l.action)}"></span>
        <span class="log-op">${esc(l.operator || '—')}</span>
        <span>${esc(ACTION_LABEL[l.action] || l.action)}</span>
        <span class="log-mod">${esc(MODULE_LABEL[l.module] || l.module)}</span>
        <span class="log-target">${esc(l.target || '')}</span>
        <span class="log-time">${esc(WG.fmtTime(l.ts))}</span>
      </div>
    `).join('');
  }

  /* ============================================================
   * 初始化
   * ============================================================ */

  /* ---------- AI 平台接入 ---------- */

  function renderNavDot() {
    const dot = document.getElementById('nav-ai-dot');
    if (!dot) return;
    dot.hidden = !(WG.AI && WG.AI.isReady());
  }

  function initAI() {
    const AI = WG.AI;
    if (!AI) return;

    const form = $('#ai-form');
    const done = $('#ai-done');
    const sel = $('#ai-provider');
    const keyInp = $('#ai-key');
    const baseInp = $('#ai-baseurl');
    const customRow = $('#ai-custom-row');
    const modelInp = $('#ai-model');
    const modelList = $('#ai-model-list');
    const msg = $('#ai-msg');
    const stateEl = $('#ai-state');
    if (!form || !sel) return;

    sel.innerHTML = AI.PROVIDERS
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join('');

    const applyProvider = (id) => {
      const p = AI.providerOf(id);
      baseInp.value = p.baseUrl || '';
      customRow.hidden = p.id !== 'custom';
      modelList.innerHTML = (p.models || []).map((m) => `<option value="${m}"></option>`).join('');
      if (p.models && p.models.length) modelInp.value = p.models[0];
      keyInp.placeholder = p.keyHint || '粘贴 API Key';
    };

    const showDone = (cfg) => {
      form.hidden = true;
      done.hidden = false;
      const p = AI.providerOf(cfg.provider);
      const pv = document.getElementById('ai-done-provider');
      const sb = document.getElementById('ai-done-sub');
      if (pv) pv.textContent = p.name;
      if (sb) sb.textContent = cfg.model + ' · ' + (cfg.lastMsg || '已验证');
      if (stateEl) { stateEl.textContent = '已连接'; stateEl.dataset.kind = 'ok'; }
      renderNavDot();
    };

    const showForm = (cfg) => {
      form.hidden = false;
      done.hidden = true;
      if (stateEl) {
        stateEl.textContent = (cfg && cfg.verified === false) ? '验证失败' : '未配置';
        stateEl.dataset.kind = (cfg && cfg.verified === false) ? 'bad' : '';
      }
      if (cfg) {
        sel.value = cfg.provider || 'openai';
        applyProvider(sel.value);
        keyInp.value = cfg.key || '';
        if (cfg.baseUrl) baseInp.value = cfg.baseUrl;
        if (cfg.model) modelInp.value = cfg.model;
      } else {
        applyProvider('openai');
      }
      renderNavDot();
    };

    const cfg0 = AI.loadConfig();
    if (cfg0 && cfg0.verified) showDone(cfg0);
    else showForm(cfg0 || null);

    sel.addEventListener('change', () => applyProvider(sel.value));

    const saveBtn = $('#btn-ai-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const provider = sel.value;
        const p = AI.providerOf(provider);
        const key = keyInp.value.trim();
        const baseUrl = (baseInp.value.trim() || p.baseUrl || '').replace(/\/+$/, '');
        const model = modelInp.value.trim() || (p.models[0] || '');

        const fail = (t) => { if (msg) { msg.textContent = t; msg.style.color = '#dc2626'; } };

        if (!key) return fail('先填 API Key');
        if (!baseUrl) return fail('先填接口地址');
        if (!model) return fail('先填模型名');

        if (stateEl) { stateEl.textContent = '验证中…'; stateEl.dataset.kind = 'busy'; }
        if (msg) { msg.textContent = '正在连接 ' + baseUrl + ' …'; msg.style.color = ''; }
        saveBtn.disabled = true;

        try {
          const r = await AI.verifyAndSave({ provider, key, baseUrl, model });
          if (r.ok) {
            if (msg) msg.textContent = '';
            showDone(r.config);
            WG.toast('AI 接口已连接');
          } else {
            if (stateEl) { stateEl.textContent = '验证失败'; stateEl.dataset.kind = 'bad'; }
            fail(r.msg);
          }
        } catch (e) {
          if (stateEl) { stateEl.textContent = '验证失败'; stateEl.dataset.kind = 'bad'; }
          fail(e.message || '验证出错');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    const resetBtn = $('#btn-ai-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        AI.clearConfig();
        showForm(null);
        WG.toast('已清除 AI 配置');
      });
    }

    /* 打开设置页时静默复验：不到 24 小时不会真的发请求 */
    if (cfg0 && cfg0.key) {
      AI.silentRecheck().then((r) => {
        if (r.skipped) return;
        const latest = AI.loadConfig();
        if (latest && latest.verified) {
          showDone(latest);
        } else if (latest && stateEl) {
          stateEl.textContent = '验证已失效';
          stateEl.dataset.kind = 'bad';
          renderNavDot();
        }
      }).catch(() => {});
    }

    renderNavDot();
  }
  function initSettings() {
    initAI();

    // 操作人
    const opInput = $('#op-name');
    if (opInput) {
      opInput.value = WG.currentOperator();
      $('#btn-op-save').addEventListener('click', () => {
        WG.setOperator(opInput.value);
        const m = $('#op-msg');
        m.textContent = opInput.value.trim()
          ? '已保存：' + opInput.value.trim()
          : '已清空，之后新增的记录操作人显示为「未命名」';
        WG.toast('操作人已保存');
      });
      opInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#btn-op-save').click();
      });
    }

    renderCatPick();
    renderCatBar();
    renderLog();

    // CSV 导出
    const btnCsvExport = $('#btn-csv-export');
    if (btnCsvExport) {
      btnCsvExport.addEventListener('click', () => {
        WG.exportCsv();
        WG.toast('CSV 台账已导出');
      });
    }

    // CSV 导入（合并）
    const fileCsv = $('#file-csv');
    const btnCsvImport = $('#btn-csv-import');
    if (btnCsvImport && fileCsv) {
      btnCsvImport.addEventListener('click', () => fileCsv.click());
      fileCsv.addEventListener('change', async () => {
        const f = fileCsv.files && fileCsv.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const res = WG.importCsv(text, 'merge');
          if (!res.ok) {
            WG.toast('导入失败：' + res.msg);
          } else {
            renderLog();
            WG.toast('CSV 已合并：新增 ' + res.added + ' / 更新 ' + res.updated);
          }
        } catch (e) {
          WG.toast('文件读取失败');
        } finally {
          fileCsv.value = '';
        }
      });
    }

    // JSON 完整备份导出
    const btnJsonExport = $('#btn-json-export');
    if (btnJsonExport) {
      btnJsonExport.addEventListener('click', () => {
        const payload = {
          app: 'WriterGuard',
          version: '1.1.0',
          exportedAt: new Date().toISOString(),
          operator: WG.currentOperator(),
          data: WG.Store.all(),
        };
        WG.download('writer-guard-backup-' + WG.today() + '.json', JSON.stringify(payload, null, 2));
        WG.toast('JSON 备份已导出');
      });
    }

    // JSON 合并导入
    const fileJson = $('#file-json-merge');
    const btnJsonMerge = $('#btn-json-merge');
    if (btnJsonMerge && fileJson) {
      btnJsonMerge.addEventListener('click', () => fileJson.click());
      fileJson.addEventListener('change', async () => {
        const f = fileJson.files && fileJson.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const payload = JSON.parse(text);
          if (!payload || payload.app !== 'WriterGuard') {
            WG.toast('不是本工具导出的备份文件');
            fileJson.value = '';
            return;
          }
          const res = WG.importJsonMerge(payload);
          if (!res.ok) {
            WG.toast('合并失败：' + res.msg);
          } else {
            renderLog();
            WG.toast('JSON 已合并：新增 ' + res.added + ' / 更新 ' + res.updated);
          }
        } catch (e) {
          WG.toast('文件解析失败');
        } finally {
          fileJson.value = '';
        }
      });
    }

    // 清空日志
    const btnLogClear = $('#btn-log-clear');
    if (btnLogClear) {
      btnLogClear.addEventListener('click', () => {
        WG.Store.set(KEY.changelog, []);
        renderLog();
        WG.toast('变更日志已清空');
      });
    }
  }

  /* 切换视图到设置时刷新一次（数据会变） */
  const origSwitch = WG.switchView;
  WG.switchView = function (name) {
    origSwitch(name);
    if (name === 'settings') {
      initAI();
      renderCatPick();
      renderCatBar();
      renderLog();
    }
    if (name === 'compliance') {
      renderCatBar();
    }
  };

  WG.initSettings = initSettings;
  WG.initAI = initAI;
  WG.renderNavDot = renderNavDot;
  WG.renderCatBar = renderCatBar;
  WG.renderCatPick = renderCatPick;
  WG.renderLog = renderLog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
