/* ============================================================
 * Writer Guard · 网络钩子（MAIN world）
 * 在页面上下文里 hook fetch / XHR，把公众号后台的数据接口响应
 * 转发给隔离世界做解析。只在 mp.weixin.qq.com 域内生效。
 * ============================================================ */
(function () {
  'use strict';

  if (window.__WG_NET_HOOKED__) return;
  window.__WG_NET_HOOKED__ = true;

  const MAX_BODY = 3 * 1024 * 1024;   // 单条响应上限 3MB
  const MAX_SEND = 60;                // 最多转发 60 条，避免内存堆积
  let sent = 0;

  // 公众号数据相关路径特征。宁可少抓，也不要抓一堆无关响应拖慢页面。
  const PATH_HINT = /(appmsganalysis|appmsg|operate|statis|analysis|report|comment|fans|user_analysis|cgi-bin\/misc)/i;

  function shouldTake(url) {
    if (sent >= MAX_SEND) return false;
    if (!url) return false;
    return PATH_HINT.test(String(url));
  }

  function ship(url, body, kind) {
    if (!body || typeof body !== 'string') return;
    if (body.length > MAX_BODY) return;
    if (sent >= MAX_SEND) return;
    sent++;
    try {
      window.postMessage({
        __wgNet: true,
        url: String(url).slice(0, 600),
        kind: kind || 'text',
        body: body,
        ts: Date.now(),
      }, '*');
    } catch (e) { /* ignore */ }
  }

  /* ---------- XMLHttpRequest ---------- */

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__wgUrl = url; } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      try {
        this.addEventListener('load', function () {
          try {
            const url = this.__wgUrl || '';
            if (!shouldTake(url)) return;
            const rt = this.responseType;
            if (rt === '' || rt === 'text') {
              ship(url, this.responseText, 'text');
            } else if (rt === 'json') {
              ship(url, JSON.stringify(this.response), 'json');
            }
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }

  /* ---------- fetch ---------- */

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string'
        ? input
        : (input && input.url) || '';

      const p = origFetch.apply(this, arguments);

      if (shouldTake(url)) {
        try {
          p.then((res) => {
            try {
              const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
              if (!/json|text\/html|text\/plain/i.test(ct)) return;
              res.clone().text().then((t) => ship(url, t, /json/i.test(ct) ? 'json' : 'html'))
                .catch(() => { /* ignore */ });
            } catch (e) { /* ignore */ }
          }).catch(() => { /* ignore */ });
        } catch (e) { /* ignore */ }
      }

      return p;
    };
  }
})();
