/* ============================================================
 * Writer Guard · 启动
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;

  async function boot() {
    try {
      await WG.Store.init();
    } catch (e) {
      console.warn('[WG] 存储初始化失败，退化为内存模式', e);
    }

    // 设置模块先跑：它会包装 switchView，让切页时刷新品类和日志
    try {
      if (typeof WG.initSettings === 'function') WG.initSettings();
    } catch (e) {
      console.error('[WG] initSettings 失败', e);
    }

    WG.initRouter();
    WG.initBackup();

    const modules = [
      'initWriter',
      'initDoubaoDock',
      'initCompliance',
      'initTitleRewrite',
      'initFontCheck',
      'initAssets',
      'initDup',
      'initTemplates',
      'initAnnotate',
      'initCover',
      'initSoftware',
      'initComplaints',
      'initAnalytics',
      'initScrape',
      'initMultiplatform',
      'initStudio',
    ];

    modules.forEach((fn) => {
      try {
        if (typeof WG[fn] === 'function') WG[fn]();
      } catch (e) {
        console.error('[WG] 模块初始化失败:', fn, e);
      }
    });

    // 品类条需要在检测页初始化后同步一次
    try {
      if (typeof WG.renderCatBar === 'function') WG.renderCatBar();
    } catch (e) { /* ignore */ }

    const dict = root.WG_DICT || {};
    console.log('[Writer Guard] 词库版本', dict.version || 'unknown', '· 模块已加载', modules.length + 1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
