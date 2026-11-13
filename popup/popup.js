/* ============================================================
 * Writer Guard · 弹窗
 * ============================================================ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  function openWorkbench() {
    chrome.runtime.sendMessage({ type: 'WG_OPEN_WORKBENCH' }, () => {
      window.close();
    });
  }

  function activeTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      cb(tabs && tabs[0]);
    });
  }

  function isWechatUrl(url) {
    return typeof url === 'string' && url.startsWith('https://mp.weixin.qq.com/');
  }

  function loadLastScan() {
    chrome.storage.local.get(['wg_lastScan'], (res) => {
      const d = res && res.wg_lastScan;
      if (!d) return;
      $('#s-score').textContent = d.total != null ? d.total : '—';
      $('#s-ai').textContent = d.aiScore != null ? d.aiScore : '—';
      $('#s-red').textContent = d.redline != null ? d.redline : '—';
    });
  }

  function loadDictVersion() {
    try {
      const dict = window.WG_DICT;
      if (dict) $('#foot').textContent = '词库 v' + dict.version + ' · 红线 ' + dict.redline.length + ' 类 / AI ' + dict.aiTrace.length + ' 类';
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadLastScan();

    $('#btn-open').addEventListener('click', openWorkbench);

    ['zhilu', 'emotion'].forEach((id) => {
      const b = document.getElementById('btn-' + id);
      if (!b) return;
      b.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('workbench/workbench.html#' + id) });
        window.close();
      });
    });

    $('#btn-scan-page').addEventListener('click', () => {
      activeTab((tab) => {
        if (!tab || !isWechatUrl(tab.url)) {
          setHint('当前标签页不是公众号页面。先在 chrome://extensions 里确认扩展已启用，再打开 mp.weixin.qq.com 的图文编辑页。', true);
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'WG_GET_REPORT' }, (res) => {
          if (chrome.runtime.lastError || !res || !res.ok) {
            setHint('页面还没准备好，刷新公众号编辑页再试。', true);
            return;
          }
          const r = res.report;
          $('#s-score').textContent = r.percent;
          $('#s-ai').textContent = r.ai.score;
          $('#s-red').textContent = r.redline.length;
          setHint(
            r.blockedNow
              ? '有阻断项，共 ' + r.blocked.length + ' 处必删风险，别发。'
              : '当前评分 ' + r.percent + '，' + (r.percent >= 80 ? '可以发布。' : '还有优化项。'),
            r.blockedNow
          );
        });
      });
    });

    $('#btn-panel').addEventListener('click', () => {
      activeTab((tab) => {
        if (!tab || !isWechatUrl(tab.url)) {
          setHint('当前标签页不是公众号页面。', true);
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'WG_OPEN_PANEL' }, () => {
          if (chrome.runtime.lastError) {
            setHint('页面还没准备好，刷新再试。', true);
            return;
          }
          window.close();
        });
      });
    });
  });

  function setHint(text, danger) {
    const el = $('#hint');
    if (!el) return;
    el.textContent = text;
    if (danger) {
      el.style.background = '#fff8f8';
      el.style.borderColor = '#f8cfd0';
      el.style.color = '#c9252d';
    } else {
      el.style.background = '#f0f6ff';
      el.style.borderColor = '#ddf4ff';
      el.style.color = '#0a5cd6';
    }
  }

  // popup 里也能读到 dict（通过 script 标签引入不方便，改为向 background 要）
  chrome.runtime.sendMessage({ type: 'WG_GET_DICT_META' }, (res) => {
    if (res && res.version) {
      $('#foot').textContent = '词库 v' + res.version + ' · 红线 ' + res.redline + ' 类 / AI ' + res.ai + ' 类';
    } else {
      loadDictVersion();
    }
  });
})();
