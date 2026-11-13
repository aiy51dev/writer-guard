/* ============================================================
 * Writer Guard · 工作台内嵌豆包
 *
 * 右侧抽屉里直接 iframe 豆包网页（实测豆包未禁止被嵌入）。
 * 三种用法：
 *   - 内嵌：在工作台右侧直接聊，不打断排版预览
 *   - 程序化推送：编辑台「起标题 / 写正文 / 降 AI 味 / 生成摘要」
 *     没配 API 时，直接把提示词送进这个内置侧窗并点发送
 *     （不再开一个新的豆包网页标签页，不打断当前工作流）
 *   - 独立窗口：如果内嵌页提示未登录（iframe 不带第三方登录态），
 *     一键开独立窗——工作台自动挤到左半屏，豆包占右半屏
 *
 * 推送协议（跨域 iframe，只能用 postMessage 跟 content/doubao.js 对话）
 *   父 → iframe : { __wgDoubao:'REQ', token, reqId, op:'PING' | 'FILL', prompt, send }
 *   iframe → 父 : { __wgDoubao:'RES', token, reqId, ok, ready, sent, mode, msg }
 *   用 token 认自己人：只有拿对 token 的回包才算数，
 *   豆包页里别的第三方 iframe 也伪造不出这个 token。
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;
  const DOUBAO_URL = 'https://www.doubao.com/chat/';
  const TAG = '__wgDoubao';

  function initDoubaoDock() {
    const openBtn = $('#doubao-open');
    const drawer = $('#doubao-drawer');
    if (!openBtn || !drawer) return;

    const frame = $('#doubao-frame');
    const closeBtn = $('#doubao-close');
    /* 每次现读，别在 init 时快照——方便将来换镜像地址 / 自动化测试改指向 */
    const frameSrc = () => (frame && frame.dataset && frame.dataset.src) || DOUBAO_URL;

    function setOpen(v) {
      drawer.hidden = !v;
      openBtn.classList.toggle('is-on', v);
      // 首次打开再加载，避免常驻 iframe 拖慢工作台
      if (v && frame && !frame.getAttribute('src')) loadFrame();
      if (!v) { armed = false; clearTimeout(leaveTimer); leaveTimer = null; }
    }

    function loadFrame() {
      if (!frame) return;
      try { frame.src = frameSrc(); } catch (e) { /* ignore */ }
    }

    /* 豆包白屏 / 渲染进程被杀时，重载一次往往就好了 */
    function reloadFrame() {
      if (!frame) return;
      try { frame.src = 'about:blank'; } catch (e) { /* ignore */ }
      setTimeout(loadFrame, 60);
    }

    openBtn.addEventListener('click', () => setOpen(drawer.hidden));
    if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));

    /* ------------------------------------------------------------
     * 鼠标一离开豆包侧栏就收起（用户要求：不管什么时候离开都收）
     * ------------------------------------------------------------
     * 抽屉里装的是跨域 iframe：指针一进 iframe，父页面就收不到
     * mousemove/mouseleave 了，靠 drawer 的 mouseleave 经常漏判，
     * 表现就是「鼠标早走了，侧栏还杵在那」。
     * 所以改成自己按坐标判断：document 上捕获 mousemove，
     * 指针既不在抽屉里、也不在「豆包」按钮上 → 立刻收起。
     * armed：只有指针真的进过侧栏，才算「离开」，避免刚推送完
     * （鼠标还在编辑台按钮上）就把侧栏收掉。
     * ------------------------------------------------------------ */
    let leaveTimer = null;
    let armed = false;
    let dbDragging = false;
    let x = 0;
    let y = 0;

    const hitRect = (el, pad) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const p = pad || 0;
      return x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p;
    };

    const inZone = () => hitRect(drawer, 0) || hitRect(openBtn, 8);

    function collapseNow() {
      clearTimeout(leaveTimer);
      leaveTimer = null;
      armed = false;
      setOpen(false);
    }

    function onMove(e) {
      x = e.clientX;
      y = e.clientY;
      if (drawer.hidden || dbDragging) return;
      if (inZone()) {
        armed = true;
        clearTimeout(leaveTimer);
        leaveTimer = null;
        return;
      }
      if (!armed) return;
      if (leaveTimer) return;
      /* 60ms 缓冲：只是鼠标抖出去一下不算离开 */
      leaveTimer = setTimeout(collapseNow, 60);
    }

    document.addEventListener('mousemove', onMove, true);
    /* 指针甩出浏览器窗口 → 也算离开，立刻收。
     * 注意：指针移进抽屉里的跨域 iframe 时，父文档同样会触发 mouseleave，
     * 那不是「离开」，得按坐标再确认一次，否则一点豆包输入框侧栏就没了。 */
    document.addEventListener('mouseleave', (e) => {
      if (drawer.hidden || dbDragging) return;
      if (typeof e.clientX === 'number') { x = e.clientX; y = e.clientY; }
      if (inZone()) return;
      if (armed) collapseNow();
    });

    // 宽度自定义：拖抽屉左缘调宽（340–1200px），记住选择
    const grip = $('#db-grip');
    const W_KEY = 'doubaoDrawerW';

    function applyW(px) {
      const w = Math.max(340, Math.min(1200, px | 0));
      drawer.style.width = w + 'px';
      return w;
    }

    try {
      const savedW = Number(WG.Store.get(W_KEY, 0));
      if (savedW >= 340 && savedW <= 1200) drawer.style.width = savedW + 'px';
    } catch (e) { /* 保持默认宽 */ }

    if (grip) {
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = drawer.getBoundingClientRect().width;
        let last = startW;
        grip.classList.add('is-drag');

        const move = (ev) => { last = applyW(startW + (startX - ev.clientX)); };
        const up = () => {
          dbDragging = false;
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          grip.classList.remove('is-drag');
          try { WG.Store.set(W_KEY, last); } catch (err) { /* ignore */ }
          /* 松手时指针可能已经在抽屉外了，补一次判定，别让它赖着不收 */
          if (!inZone() && armed) collapseNow();
        };
        dbDragging = true;
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }

    /* ---------- 跨域 postMessage 通道 ---------- */

    const waiters = new Map();
    let seq = 0;
    const token = 'wg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d[TAG] !== 'RES') return;
      if (d.token !== token) return;            // 不是我们发的，丢掉
      if (frame && e.source && e.source !== frame.contentWindow) return;
      const hit = waiters.get(d.reqId);
      if (!hit) return;
      waiters.delete(d.reqId);
      clearTimeout(hit.timer);
      hit.resolve(d);
    });

    function ask(op, extra, timeout) {
      return new Promise((resolve) => {
        if (!frame || !frame.contentWindow) {
          resolve({ ok: false, msg: '豆包窗口还没加载' });
          return;
        }
        const reqId = ++seq;
        const timer = setTimeout(() => {
          waiters.delete(reqId);
          resolve({ ok: false, msg: '豆包页面没回音' });
        }, timeout || 8000);
        waiters.set(reqId, { resolve, timer });
        try {
          frame.contentWindow.postMessage(
            Object.assign({ [TAG]: 'REQ', token, reqId, op }, extra || {}),
            '*'
          );
        } catch (err) {
          waiters.delete(reqId);
          clearTimeout(timer);
          resolve({ ok: false, msg: '跟豆包窗口通信失败' });
        }
      });
    }

    /* 等 iframe 首屏加载完（只加一次 load 监听，别每次都挂） */
    let frameLoadPromise = null;
    function ensureFrame() {
      if (!frame) return Promise.resolve(false);
      if (!frame.getAttribute('src')) loadFrame();
      if (frameLoadPromise) return frameLoadPromise;
      frameLoadPromise = new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(true);
        };
        frame.addEventListener('load', () => setTimeout(finish, 260), { once: true });
        // 已经加载完（load 不会再触发）时兜底
        setTimeout(finish, 12000);
      });
      return frameLoadPromise;
    }

    /* 豆包是 SPA，content script 装好 + 输入框渲染好都要时间，轮询等。
     * 注意 ready:false 也是「回包了」——这说明 content script 在，
     * 只是豆包还没渲染出输入框（多半是登录页），不能当成可用。 */
    async function waitReady(budget) {
      const dl = Date.now() + (budget || 10000);
      let last = { ok: false, msg: '侧窗里的豆包还没加载完' };
      while (Date.now() < dl) {
        const r = await ask('PING', null, 1200);
        if (r && r.ok && r.ready !== false) return r;
        if (r && r.ready === false) {
          last = { ok: false, msg: '豆包页开了，但没找到输入框（可能还没登录）' };
        } else if (r && r.ok === false) {
          last = { ok: false, msg: r.msg || '豆包页没回音' };
        }
        await new Promise((res) => setTimeout(res, 260));
      }
      return last;
    }

    /**
     * 兜底：跨域 iframe 里的 content script 可能根本没注入
     * （扩展重载过、豆包比扩展先加载、被浏览器拦了一次），
     * 这时 postMessage 永远等不到回音。
     * 让后台把填充函数直接注入到本标签页的豆包帧里，效果和技能面板一样。
     */
    function injectFill(text, send) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        setTimeout(() => finish({ ok: false, msg: '注入填充超时' }), 16000);
        try {
          chrome.runtime.sendMessage(
            { type: 'WG_DOUBAO_FILL_FRAME', prompt: text, send: send },
            (r) => {
              const err = chrome.runtime.lastError;
              if (err) return finish({ ok: false, msg: err.message || '后台无响应' });
              finish(r || { ok: false, msg: '后台无响应' });
            }
          );
        } catch (e) {
          finish({ ok: false, msg: e.message || '后台无响应' });
        }
      });
    }

    /**
     * 把提示词推进右侧内置豆包的输入框。
     * 返回 { ok, sent, msg, dock:true }
     */
    async function push(prompt, opts) {
      const text = String(prompt || '').trim();
      if (!text) return { ok: false, msg: '提示词是空的' };

      setOpen(true);
      await ensureFrame();

      const send = !(opts && opts.send === false);

      /* ① 正常路线：iframe 里的 content script 收 postMessage 代填 */
      let ready = await waitReady(4500);
      if (!ready || !ready.ok) {
        /* 重载一次，让扩展重新把 content script 注入这一帧 */
        reloadFrame();
        ready = await waitReady(7000);
      }

      let lastMsg = (ready && ready.msg) || '';
      if (ready && ready.ok) {
        const r = await ask('FILL', { prompt: text, send: send }, send ? 20000 : 9000);
        if (r && r.ok) return Object.assign({ dock: true }, r);
        lastMsg = (r && r.msg) || '提示词没填进去';
      }

      /* ② 兜底：后台直接注入填充函数（和技能面板同一条插入管线） */
      const inj = await injectFill(text, send);
      if (inj && inj.ok) return Object.assign({ dock: true, via: 'inject' }, inj);

      const why = (inj && inj.msg) || lastMsg || '豆包页没响应';
      return {
        ok: false,
        dock: true,
        reason: 'not-ready',
        msg: /登录/i.test(why) ? why : '侧窗里的豆包还没就绪（' + why + '）',
      };
    }

    WG.doubaoDock = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      isOpen: () => !drawer.hidden,
      isLoaded: () => !!(frame && frame.getAttribute('src')),
      push: push,
      ping: () => ask('PING', null, 1500),
    };
  }

  WG.initDoubaoDock = initDoubaoDock;
})(typeof window !== 'undefined' ? window : this);
