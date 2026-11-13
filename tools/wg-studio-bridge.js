/* ============================================================
 * Writer Guard · Studio Bridge
 * ------------------------------------------------------------
 * 由 tools/build-studio.py 内联注入到 studio/*.html 的最前面。
 * 目的：让原样的独立 HTML 应用能在扩展的 MV3 沙箱页里 100% 跑起来。
 *
 * 解决四件事：
 *   1. 沙箱页是 opaque origin，localStorage 会抛 SecurityError → 内存实现 + 存到 chrome.storage
 *   2. 沙箱页受 CORS 限制，调 apihub.agnes-ai.com / Bing TTS 会失败 → 交给扩展后台反代
 *   3. 沙箱里 <a download> 下载可能被拦 → 交给工作台页面落盘
 *   4. 沙箱里 alert/confirm 可能被拦 → 用页内弹窗接管（wgAlert / wgConfirm / wgPrompt）
 * 另外顺手加「发到编辑台」入口，把结果送进发布安全台。
 * ============================================================ */
(function () {
  'use strict';

  var APP = '__WG_APP__';           /* emotion | zhilu */
  var TAG = '__wgStudio';
  var inFrame = window.parent && window.parent !== window;

  var bridgeOn = false;             /* 父窗口握手成功后才启用网络/下载桥 */
  var pending = {};                 /* 网络请求等待表 */
  var seq = 0;

  function post(msg) {
    if (!inFrame) return;
    msg[TAG] = APP;
    try { window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ }
  }

  /* ============================================================
   * 1. localStorage 兜底
   * ============================================================ */

  var nativeLS = null;
  try {
    nativeLS = window.localStorage;
    nativeLS.getItem('__wg_probe__');
  } catch (e) { nativeLS = null; }

  var mem = Object.create(null);
  var dirty = Object.create(null);
  var removed = Object.create(null);
  var flushTimer = null;

  function flushNow() {
    if (!inFrame) return;
    clearTimeout(flushTimer);
    flushTimer = null;
    var set = {};
    Object.keys(dirty).forEach(function (k) { set[k] = mem[k]; });
    var del = Object.keys(removed);
    dirty = Object.create(null);
    removed = Object.create(null);
    if (Object.keys(set).length || del.length) post({ type: 'WG_LS_WRITE', set: set, del: del });
  }

  function scheduleFlush() {
    if (!inFrame) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushNow, 60);
  }

  /* 页面要走了：把攒着的改动立刻发出去，别等防抖（这是「关掉再开数据没了」的元凶之一） */
  function bindFlushOnLeave() {
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushNow();
    });
  }

  var shim = {
    getItem: function (k) {
      k = String(k);
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    setItem: function (k, v) {
      k = String(k);
      mem[k] = String(v);
      delete removed[k];
      dirty[k] = 1;
      scheduleFlush();
    },
    removeItem: function (k) {
      k = String(k);
      delete mem[k];
      delete dirty[k];
      removed[k] = 1;
      scheduleFlush();
    },
    clear: function () {
      Object.keys(mem).forEach(function (k) { delete mem[k]; removed[k] = 1; });
      dirty = Object.create(null);
      scheduleFlush();
    },
    key: function (i) {
      var ks = Object.keys(mem);
      return i >= 0 && i < ks.length ? ks[i] : null;
    },
    get length() { return Object.keys(mem).length; }
  };

  if (!nativeLS) {
    var installed = false;
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: shim });
      installed = true;
    } catch (e) { /* 再试原型链 */ }
    if (!installed) {
      try {
        Object.defineProperty(Object.getPrototypeOf(window), 'localStorage', {
          configurable: true,
          get: function () { return shim; }
        });
      } catch (e2) { /* 实在拦不住就让原代码自己报错 */ }
    }
    try {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: shim });
    } catch (e3) { /* ignore */ }
  }

  /* 种子数据到了以后，把页面启动时读过一遍的状态再刷新一次 */
  function refreshAppState() {
    var fns = ['loadWmPresets', 'renderWmPresets', 'loadApiConfig', 'renderTplButtons',
      'ad_loadHistory', 'ad_renderHistory', 'vp_loadFromStorage'];
    fns.forEach(function (n) {
      try { if (typeof window[n] === 'function') window[n](); } catch (e) { /* ignore */ }
    });
    try {
      /* 顶层 let 变量（跨脚本可见），把记忆和摘要补回来 */
      if (typeof chatMemory !== 'undefined' && mem.zhilu_chat_memory) {
        chatMemory = JSON.parse(mem.zhilu_chat_memory);
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof subtitleDigest !== 'undefined' && mem.zhilu_subtitle_digest) {
        subtitleDigest = mem.zhilu_subtitle_digest;
      }
    } catch (e) { /* ignore */ }
  }

  function applySeed(data) {
    /* 种子来自上次会话的持久化数据，加载时以它为准：
       应用启动常常先写一份默认值（比如水印预设），不覆盖就会丢用户数据 */
    Object.keys(data || {}).forEach(function (k) {
      mem[k] = String(data[k]);
      delete dirty[k];
      delete removed[k];
    });
    refreshAppState();
  }

  /* ============================================================
   * 2. fetch 反代（沙箱页受 CORS 限制，走扩展后台）
   * ============================================================ */

  var nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  function b64ToBytes(b64) {
    var bin = atob(b64 || '');
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function headersToObject(h) {
    var out = {};
    try {
      if (!h) return out;
      if (typeof h.forEach === 'function' && typeof h.get === 'function') {
        h.forEach(function (v, k) { out[k] = v; });
      } else if (Array.isArray(h)) {
        h.forEach(function (p) { out[p[0]] = p[1]; });
      } else {
        Object.keys(h).forEach(function (k) { out[k] = h[k]; });
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function bridgeFetch(url, init) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq);
      var timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error('请求超时：本地桥接没有响应'));
      }, 240000);

      pending[id] = function (d) {
        clearTimeout(timer);
        if (!d.ok) {
          var err = new Error(d.error || ('HTTP ' + d.status));
          err.status = d.status;
          return reject(err);
        }
        try {
          resolve(new Response(b64ToBytes(d.bodyB64), {
            status: d.status || 200,
            statusText: d.statusText || '',
            headers: d.headers || {}
          }));
        } catch (e) { reject(e); }
      };

      post({
        type: 'WG_FETCH',
        id: id,
        url: url,
        method: (init.method || 'GET').toUpperCase(),
        headers: headersToObject(init.headers),
        body: typeof init.body === 'string' ? init.body : null
      });
    });
  }

  window.fetch = function (input, init) {
    var url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { /* ignore */ }
    var bodyOk = !init || !init.body || typeof init.body === 'string';

    if (!bridgeOn || !/^https?:/i.test(url) || !bodyOk) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(new Error('fetch 不可用'));
    }
    return bridgeFetch(url, init || {}).catch(function (err) {
      if (nativeFetch) return nativeFetch(input, init);   /* 桥接不通就退回直连 */
      throw err;
    });
  };

  /* ============================================================
   * 3. 下载中转（<a download href="blob:"> 交给工作台落盘）
   * ============================================================ */

  document.addEventListener('click', function (e) {
    if (!bridgeOn) return;
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!/^blob:/i.test(href)) return;

    e.preventDefault();
    e.stopPropagation();

    if (!nativeFetch) return;
    nativeFetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        post({
          type: 'WG_DOWNLOAD',
          filename: a.getAttribute('download') || 'download',
          mime: blob.type || 'application/octet-stream',
          bodyB64: s.slice(s.indexOf(',') + 1)
        });
      };
      fr.readAsDataURL(blob);
    }).catch(function () { /* 失败就算了，用户还能用「复制」 */ });
  }, true);

  /* ============================================================
   * 4. 弹窗接管（沙箱里 alert/confirm 可能被拦，全部用页内弹窗）
   * ============================================================ */

  function toast(msg, kind) {
    var box = document.getElementById('__wg_toast');
    if (!box) {
      box = document.createElement('div');
      box.id = '__wg_toast';
      box.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:36px', 'transform:translateX(-50%) translateY(10px)',
        'max-width:78vw', 'padding:10px 18px', 'border-radius:10px', 'font:600 13px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif',
        'background:#111827', 'color:#f8fafc', 'box-shadow:0 10px 30px rgba(0,0,0,.28)',
        'opacity:0', 'transition:opacity .18s, transform .18s', 'pointer-events:none', 'z-index:2147483000',
        'word-break:break-word', 'text-align:center'
      ].join(';');
      document.documentElement.appendChild(box);
    }
    box.textContent = String(msg);
    box.style.borderLeft = '3px solid ' + (kind === 'error' ? '#ef4444' : '#0d9488');
    box.style.opacity = '1';
    box.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(box.__timer);
    box.__timer = setTimeout(function () {
      box.style.opacity = '0';
      box.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2600);
  }

  function dialog(opt) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(15,23,42,.45)', 'z-index:2147483001',
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:24px'
      ].join(';');

      var card = document.createElement('div');
      card.style.cssText = [
        'width:min(420px,100%)', 'background:#fff', 'border-radius:16px', 'padding:22px 22px 16px',
        'box-shadow:0 24px 60px rgba(15,23,42,.28)',
        'font:14px/1.65 system-ui,-apple-system,"Microsoft YaHei",sans-serif', 'color:#1e293b'
      ].join(';');

      var h = document.createElement('div');
      h.textContent = opt.title || '请确认';
      h.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:10px';

      var p = document.createElement('div');
      p.textContent = opt.message || '';
      p.style.cssText = 'color:#475569;white-space:pre-wrap;word-break:break-word';

      card.appendChild(h);
      card.appendChild(p);

      var input = null;
      if (opt.input) {
        input = document.createElement('input');
        input.type = 'text';
        input.value = opt.defaultValue || '';
        input.placeholder = opt.placeholder || '';
        input.style.cssText = 'width:100%;margin-top:12px;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none;box-sizing:border-box';
        card.appendChild(input);
      }

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px';

      function close(v) {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      }

      if (opt.cancelText !== false) {
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = opt.cancelText || '取消';
        cancel.style.cssText = 'padding:8px 16px;border:1px solid #e2e8f0;background:#fff;color:#475569;border-radius:10px;font-size:13px;cursor:pointer';
        cancel.onclick = function () { close(opt.input ? null : false); };
        row.appendChild(cancel);
      }

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = opt.okText || '确定';
      ok.style.cssText = 'padding:8px 18px;border:0;background:#0d9488;color:#fff;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer';
      ok.onclick = function () { close(opt.input ? input.value : true); };
      row.appendChild(ok);

      card.appendChild(row);
      mask.appendChild(card);
      mask.addEventListener('mousedown', function (e) {
        if (e.target === mask) close(opt.input ? null : false);
      });

      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(opt.input ? null : false); }
        if (e.key === 'Enter') { e.stopPropagation(); close(opt.input ? input.value : true); }
      }
      document.addEventListener('keydown', onKey, true);

      document.documentElement.appendChild(mask);
      setTimeout(function () { (input || ok).focus(); }, 30);
    });
  }

  window.wgAlert = function (msg) { toast(msg); };
  window.wgConfirm = function (msg, opt) {
    opt = opt || {};
    return dialog({ title: opt.title || '请确认', message: msg, okText: opt.okText, cancelText: opt.cancelText });
  };
  window.wgPrompt = function (msg, def) {
    return dialog({ title: '输入内容', message: msg, input: true, defaultValue: def || '' });
  };

  /* 原生 alert 换掉：沙箱里可能没反应，而且 iframe 里阻塞式弹窗体验差 */
  window.alert = function (msg) { toast(msg, 'error'); };

  /* ============================================================
   * 4.5 文件选择器接管（File System Access API 沙箱降级）
   * ------------------------------------------------------------
   * 沙箱文档里调用 showOpenFilePicker 会直接抛：
   *   SecurityError: Sandboxed documents aren't allowed to show a file picker.
   * 而应用里普遍写成 if (window.showOpenFilePicker) { ... } —— 一看"有"
   * 就直接走，异常被 catch 吞掉，表现就是点了完全没反应（智录笔记的
   * 「📄 SRT」就是这样挂的）。原生 <input type=file> 在沙箱里是能用的
   * （真用户点击有手势即可），所以这里用页内文件框重新实现同名 API，
   * 返回一个只有 getFile() 的假 handle，应用代码一行都不用改。
   * ============================================================ */

  function acceptOf(types) {
    var exts = [], mimes = [];
    (types || []).forEach(function (t) {
      var acc = (t && t.accept) || {};
      Object.keys(acc).forEach(function (m) {
        if (m && m !== '*/*') mimes.push(m);
        (acc[m] || []).forEach(function (x) {
          var s = String(x);
          if (s.charAt(0) === '.') exts.push(s.toLowerCase());
        });
      });
    });
    var uniq = function (a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); };
    return uniq(exts).concat(uniq(mimes)).join(',');
  }

  function abortError() {
    try { return new DOMException('用户取消选择', 'AbortError'); }
    catch (e) {
      var err = new Error('用户取消选择');
      err.name = 'AbortError';
      return err;
    }
  }

  /* 页内文件选择框：透明 input 铺满虚线区，用户真点它，系统文件框照常弹 */
  function pickFileDialog(opt) {
    opt = opt || {};
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.setAttribute('data-wg-filepicker', APP);
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483002;display:flex;align-items:center;justify-content:center;padding:24px';

      var card = document.createElement('div');
      card.style.cssText = [
        'width:min(440px,100%)', 'background:#fff', 'border-radius:16px', 'padding:20px 20px 16px',
        'box-shadow:0 24px 60px rgba(15,23,42,.28)',
        'font:14px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif', 'color:#1e293b'
      ].join(';');

      var h = document.createElement('div');
      h.textContent = opt.title || '选择文件';
      h.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:12px';

      var zone = document.createElement('div');
      zone.style.cssText = [
        'position:relative', 'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'gap:6px', 'height:146px', 'border:2px dashed #cbd5e1',
        'border-radius:14px', 'background:#f8fafc', 'color:#64748b', 'font-size:13px',
        'text-align:center', 'padding:0 18px', 'transition:.16s', 'overflow:hidden'
      ].join(';');

      var icon = document.createElement('div');
      icon.textContent = '📄';
      icon.style.cssText = 'font-size:26px;line-height:1';

      var main = document.createElement('div');
      main.textContent = '点击这里选择文件';
      main.style.cssText = 'font-weight:600;color:#334155';

      var sub = document.createElement('div');
      var acc = acceptOf(opt.types);
      sub.textContent = (acc ? '支持 ' + acc.replace(/,/g, ' / ') : '任意文件') + '，也可以直接拖进来';
      sub.style.cssText = 'font-size:12px;color:#94a3b8;word-break:break-all';

      var input = document.createElement('input');
      input.type = 'file';
      if (acc) input.accept = acc;
      input.multiple = !!opt.multiple;
      input.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer';

      zone.appendChild(icon);
      zone.appendChild(main);
      zone.appendChild(sub);
      zone.appendChild(input);

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.style.cssText = 'padding:8px 16px;border:1px solid #e2e8f0;background:#fff;color:#475569;border-radius:10px;font-size:13px;cursor:pointer';

      row.appendChild(cancel);
      card.appendChild(h);
      card.appendChild(zone);
      card.appendChild(row);
      mask.appendChild(card);

      var done = false;
      function close(files) {
        if (done) return;
        done = true;
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        document.removeEventListener('keydown', onKey, true);
        resolve(files);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      }

      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (files.length) close(opt.multiple ? files : [files[0]]);
      });
      cancel.onclick = function () { close(null); };
      mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(null); });

      /* 拖拽进来同样算数 */
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.style.borderColor = '#0d9488';
        zone.style.background = '#f0fdfa';
      });
      zone.addEventListener('dragleave', function () {
        zone.style.borderColor = '#cbd5e1';
        zone.style.background = '#f8fafc';
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) close(opt.multiple ? files : [files[0]]);
      });

      document.addEventListener('keydown', onKey, true);
      document.documentElement.appendChild(mask);
      /* 不主动 focus input：避免抢焦后用户看不到内容，点一下就开了 */
      setTimeout(function () { cancel.blur(); }, 0);
    });
  }

  function makeFileHandle(file) {
    return {
      kind: 'file',
      name: file.name,
      __wgFile: file,
      getFile: function () { return Promise.resolve(file); },
      isSameEntry: function (other) { return Promise.resolve(!!other && other.name === file.name); },
      queryPermission: function () { return Promise.resolve('granted'); },
      requestPermission: function () { return Promise.resolve('granted'); }
    };
  }

  function saveBlob(blob, filename) {
    return new Promise(function (resolve) {
      var send = function (b64) {
        post({ type: 'WG_DOWNLOAD', filename: filename, mime: blob.type || 'application/octet-stream', bodyB64: b64 });
        resolve();
      };
      if (inFrame && bridgeOn) {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || '');
          send(s.slice(s.indexOf(',') + 1));
        };
        fr.onerror = function () { resolve(); };
        fr.readAsDataURL(blob);
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      resolve();
    });
  }

  function define(name, fn) {
    try {
      Object.defineProperty(window, name, { configurable: true, writable: true, value: fn });
    } catch (e) {
      try { window[name] = fn; } catch (e2) { /* 拦不住就用原生（会抛 SecurityError） */ }
    }
  }

  define('showOpenFilePicker', function (opt) {
    return pickFileDialog(opt).then(function (files) {
      if (!files || !files.length) throw abortError();
      return files.map(makeFileHandle);
    });
  });

  define('showSaveFilePicker', function (opt) {
    opt = opt || {};
    var name = opt.suggestedName || 'download';
    var chunks = [];
    return Promise.resolve({
      kind: 'file',
      name: name,
      createWritable: function () {
        return Promise.resolve({
          write: function (data) { chunks.push(data); return Promise.resolve(); },
          close: function () { return saveBlob(new Blob(chunks), name); },
          abort: function () { chunks.length = 0; return Promise.resolve(); }
        });
      }
    });
  });

  define('showDirectoryPicker', function () {
    toast('沙箱环境不支持选文件夹，请用「选择文件」逐个挑，或直接拖拽进页面', 'error');
    return Promise.reject(abortError());
  });

  /* ============================================================
   * 5. 与工作台通信
   * ============================================================ */

  /* 团队/工作台里配好的 API：内置应用自己没填 Key 时直接复用 */
  var teamAI = null;

  function setTeamAI(ai) {
    teamAI = (ai && ai.key && ai.baseUrl && ai.model) ? ai : null;
    try { window.WG_TEAM_AI = teamAI; } catch (e) { /* ignore */ }
    try {
      window.dispatchEvent(new CustomEvent('wg-ai', { detail: teamAI }));
    } catch (e2) { /* 老内核不支持 CustomEvent 构造就算了 */ }
    try { if (typeof window.wgOnTeamAI === 'function') window.wgOnTeamAI(teamAI); } catch (e3) { /* ignore */ }
  }

  window.wgGetTeamAI = function () { return teamAI; };

  function onMsg(e) {
    var d = e.data;
    if (!d || d[TAG] !== 'PARENT') return;

    if (d.type === 'WG_BRIDGE_HELLO') {
      bridgeOn = true;
      applySeed(d.ls || {});
      setTeamAI(d.ai);
      return;
    }
    if (d.type === 'WG_AI_CFG') {
      setTeamAI(d.ai);
      return;
    }
    if (d.type === 'WG_LS_SEED') {
      applySeed(d.ls || {});
      return;
    }
    if (d.type === 'WG_FETCH_RES') {
      var w = pending[d.id];
      if (w) {
        delete pending[d.id];
        w(d);
      }
      return;
    }
    if (d.type === 'WG_STUDIO_CMD' && d.cmd === 'toast') {
      toast(d.msg || '');
    }
  }

  window.addEventListener('message', onMsg);

  bindFlushOnLeave();

  var tries = 0;
  function handshake() {
    if (!inFrame || bridgeOn) return;
    post({ type: 'WG_READY' });
    if (++tries < 14) setTimeout(handshake, 350);
  }
  handshake();

  /* ============================================================
   * 6. 和发布安全台的联动入口
   * ============================================================ */

  /* ---------- 转 Markdown：结构、样式能留的都留，图片只留短代号 ---------- */

  /* 截图是 dataURL（几百 KB 一大坨），写进 Markdown 就是满屏「图片代码」，
   * 编辑台还会被撑到卡死。这里只写 `![截图](wgimg:k3f9a-1)`，
   * 真图单独递给工作台存起来，排版预览时再换回真图显示。 */
  var localImgs = {};
  var imgSeq = 0;

  function imgMd(im) {
    var src = im.getAttribute('src') || '';
    var alt = (im.getAttribute('alt') || '').trim();
    if (!src) return '';
    if (/^(data:|blob:)/i.test(src)) {
      var n = ++imgSeq;
      var key = 'k' + Date.now().toString(36) + n;
      localImgs[key] = src;
      return '![' + (alt || '截图' + n) + '](wgimg:' + key + ')';
    }
    return '![' + alt + '](' + src + ')';
  }

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1,
    SVG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1, NAV: 1, LABEL: 1,
  };
  var SKIP_CLS = /note-actions-between|note-btn|subtitle-item|no-md|hide-in-md/;

  function skipEl(n) {
    if (!n || !n.tagName) return false;
    if (SKIP_TAGS[n.tagName]) return true;
    var cls = typeof n.className === 'string' ? n.className : '';
    if (cls && SKIP_CLS.test(cls)) return true;
    if (n.getAttribute && n.getAttribute('data-wg-skip') != null) return true;
    return false;
  }

  function hasBg(n) {
    var st = (n.getAttribute && (n.getAttribute('style') || '')) || '';
    if (!/background/i.test(st)) return false;
    if (/background\s*:\s*(none|transparent)/i.test(st)) return false;
    return true;
  }

  function mdInline(node) {
    var s = '';
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { s += n.nodeValue.replace(/[\s\u00a0]+/g, ' '); return; }
      if (n.nodeType !== 1) return;
      if (skipEl(n)) return;

      var t = n.tagName;
      if (t === 'BR') { s += '\n'; return; }
      if (t === 'IMG') { s += imgMd(n); return; }

      if (t === 'STRONG' || t === 'B') {
        var bx = mdInline(n).trim();
        if (bx) s += '**' + bx + '**';
        return;
      }
      if (t === 'EM' || t === 'I') {
        var it = mdInline(n).trim();
        if (it) s += '*' + it + '*';
        return;
      }
      if (t === 'CODE') { s += '`' + n.textContent.replace(/`/g, '') + '`'; return; }
      if (t === 'A') {
        var at = mdInline(n).trim();
        var href = n.getAttribute('href') || '';
        if (!at) return;
        s += /^https?:/i.test(href) ? '[' + at + '](' + href + ')' : at;
        return;
      }
      /* 段落/文字上刷了底色 → 用编辑台的绿底高亮语法，视觉上留得住 */
      if (t === 'MARK') {
        var mk0 = mdInline(n).trim();
        if (mk0) { s += '==' + mk0 + '=='; return; }
      }
      if (t === 'SPAN' || t === 'FONT' || t === 'DIV' || t === 'SECTION') {
        if (hasBg(n)) {
          var mk = mdInline(n).trim();
          if (mk) { s += '==' + mk + '=='; return; }
        }
      }
      s += mdInline(n);
    });
    return s;
  }

  var BLOCK_TAG = {
    P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, ASIDE: 1,
    FIGURE: 1, FIGCAPTION: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, PRE: 1, BLOCKQUOTE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, HR: 1,
  };

  function tableMd(n) {
    var rows = [];
    Array.prototype.forEach.call(n.querySelectorAll('tr'), function (tr) {
      var cells = [];
      Array.prototype.forEach.call(tr.children, function (td) {
        cells.push(mdInline(td).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim());
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return '';
    var head = rows[0];
    var out = ['| ' + head.join(' | ') + ' |', '| ' + head.map(function () { return '---'; }).join(' | ') + ' |'];
    rows.slice(1).forEach(function (r) {
      while (r.length < head.length) r.push('');
      out.push('| ' + r.slice(0, head.length).join(' | ') + ' |');
    });
    return out.join('\n');
  }

  function htmlToMd(root) {
    localImgs = {};
    imgSeq = 0;
    var out = [];

    function emit(block) {
      var s = String(block == null ? '' : block).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (s) out.push(s);
    }

    function inlineOf(n) {
      return mdInline(n).replace(/[ \t]{2,}/g, ' ').replace(/ *\n */g, '\n').trim();
    }

    function walk(node) {
      var buf = '';
      function flush() {
        var s = buf.replace(/[\s\u00a0]+/g, ' ').trim();
        buf = '';
        if (s) emit(s);
      }

      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) {
          var v = n.nodeValue.replace(/[\s\u00a0]+/g, ' ');
          if (v.trim()) buf += (/[\u4e00-\u9fa5]$/.test(buf) || buf === '' ? '' : ' ') + v;
          return;
        }
        if (n.nodeType !== 1) return;
        if (skipEl(n)) return;

        var t = n.tagName;

        /* 正文里直接挂的截图（智录笔记就是这种结构）：单独成块 */
        if (t === 'IMG') {
          flush();
          var sIm = imgMd(n);
          if (sIm) emit(sIm);
          return;
        }

        if (!BLOCK_TAG[t]) {
          if (t === 'BR') { flush(); return; }
          buf += mdInline(n);
          return;
        }

        flush();

        if (t === 'HR') { emit('---'); return; }

        if (/^H[1-6]$/.test(t)) {
          var lv = Number(t[1]);
          var htxt = inlineOf(n).replace(/\n+/g, ' ');
          if (htxt) emit(new Array(lv + 1).join('#') + ' ' + htxt);
          return;
        }

        if (t === 'PRE') {
          emit('```\n' + n.textContent.replace(/\s+$/, '') + '\n```');
          return;
        }

        if (t === 'BLOCKQUOTE') {
          var q = inlineOf(n);
          if (!q) { walk(n); return; }
          emit(q.split('\n').map(function (l) { return '> ' + l; }).join('\n'));
          return;
        }

        if (t === 'UL' || t === 'OL') {
          var i = 0;
          Array.prototype.forEach.call(n.children, function (li) {
            if (li.tagName !== 'LI' || skipEl(li)) return;
            i++;
            var txt = inlineOf(li).replace(/\n+/g, ' ');
            if (txt) emit((t === 'OL' ? i + '. ' : '- ') + txt);
          });
          return;
        }

        if (t === 'TABLE') { emit(tableMd(n)); return; }

        if (t === 'FIGURE') {
          Array.prototype.forEach.call(n.querySelectorAll('img'), function (im) {
            var s = imgMd(im);
            if (s) emit(s);
          });
          var cap = n.querySelector('figcaption');
          if (cap) {
            var c = inlineOf(cap);
            if (c) emit(c);
          }
          return;
        }

        /* 容器元素：里面有块级子元素就继续往里走 */
        var hasBlockKid = false;
        Array.prototype.forEach.call(n.children, function (c2) {
          if (c2.tagName && BLOCK_TAG[c2.tagName]) hasBlockKid = true;
        });

        if (hasBlockKid) { walk(n); return; }

        var txt2 = inlineOf(n);
        if (!txt2) {
          /* 只剩图片的段落 */
          Array.prototype.forEach.call(n.querySelectorAll('img'), function (im) {
            var s2 = imgMd(im);
            if (s2) emit(s2);
          });
          return;
        }
        /* 智录笔记里带底色的段落 → 用引用块表达「卡片」感，别让排版塌成一片纯文字 */
        if (hasBg(n)) {
          emit(txt2.split('\n').map(function (l) { return '> ' + l; }).join('\n'));
        } else {
          emit(txt2);
        }
      });

      flush();
    }

    walk(root);

    /* 图片单独抽出来，连同代号一起递给工作台 */
    return {
      md: out.join('\n\n').trim(),
      imgs: localImgs,
    };
  }

  function plainOf(root) {
    return String((root.innerText || root.textContent || '')).replace(/\n{3,}/g, '\n\n').trim();
  }

  function makeBtn(label, bg, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'padding:6px 14px', 'border:none', 'border-radius:40px', 'font-weight:600', 'font-size:12px',
      'cursor:pointer', 'color:#fff', 'background:' + bg, 'transition:.2s', 'font-family:inherit',
      'white-space:nowrap'
    ].join(';');
    b.onmouseenter = function () { b.style.filter = 'brightness(1.08)'; };
    b.onmouseleave = function () { b.style.filter = ''; };
    b.onclick = handler;
    return b;
  }

  function sendToWriter(md, title, imgs) {
    if (!md) return toast('内容还是空的');
    if (!inFrame) return toast('请从「发布安全台 → 编辑台」里打开本页，才能一键发送');
    var n = 0;
    try { n = Object.keys(imgs || {}).length; } catch (e) { n = 0; }
    post({ type: 'WG_TO_WRITER', md: md, title: title || '', imgs: imgs || {} });
    toast('已发到编辑台' + (n ? '（含 ' + n + ' 张截图，正文里用短代号，预览是真图）' : '') + '，去「编辑台」接着写');
  }

  function sendToCompliance(text) {
    if (!text) return toast('内容还是空的');
    if (!inFrame) return toast('请从「发布安全台」里打开本页，才能送检');
    post({ type: 'WG_TO_COMPLIANCE', text: text });
    toast('已送合规检测');
  }

  /* ------------------------------------------------------------
   * 公众号标题栏：占据原来那两行说明文字的位置
   * 输入标题 → 点「插入到公众号标题」→ 直接写进公众号编辑器的标题框
   * ------------------------------------------------------------ */
  var WX_TITLE_KEY = 'zhilu_wx_title';
  var WX_TITLE_MAX = 64;

  function setWxTitle(title) {
    var text = String(title || '').trim();
    if (!text) return toast('标题还是空的');
    /* 顺手用标题替换文章头里的旧标题，导出/封面都能用上 */
    try {
      var t = document.querySelector('.article-title');
      if (t) t.textContent = text;
    } catch (e) { /* ignore */ }
    post({ type: 'WG_SET_WX_TITLE', title: text });
    toast('已发送：' + text);
  }

  function mountTitleBar() {
    var preview = document.querySelector('.article-preview');
    if (!preview || preview.querySelector('.__wg_titlebar')) return;

    var oldTitle = preview.querySelector('.article-title');
    var oldMeta = preview.querySelector('.article-meta');
    if (oldTitle) oldTitle.style.display = 'none';
    if (oldMeta) oldMeta.style.display = 'none';

    /* 无底色、无边框、无标题标签：只留一条细分隔线，和公众号后台标题输入区一致 */
    var bar = document.createElement('div');
    bar.className = '__wg_titlebar';
    bar.style.cssText = [
      'display:flex', 'align-items:center', 'gap:10px',
      'margin:0 0 18px 0', 'padding:0 0 9px 0',
      'background:transparent', 'border:0', 'border-bottom:1px solid #eceff3'
    ].join(';');

    var barStyle = document.createElement('style');
    barStyle.textContent =
      '#__wg_title_input{border:0!important;background:transparent!important;box-shadow:none!important;outline:none}' +
      '#__wg_title_input::placeholder{color:#b8c0cc;font-weight:400}' +
      '#__wg_title_btn:hover{color:#0f766e!important}';
    bar.appendChild(barStyle);

    var input = document.createElement('input');
    input.type = 'text';
    input.id = '__wg_title_input';
    input.placeholder = '填写公众号标题';
    input.maxLength = WX_TITLE_MAX;
    input.style.cssText = [
      'flex:1 1 auto', 'min-width:0', 'width:100%', 'padding:0', 'margin:0',
      'border:0', 'background:transparent',
      'color:#111827', 'font:600 21px/1.45 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
      'letter-spacing:.2px'
    ].join(';');

    var cnt = document.createElement('span');
    cnt.style.cssText = 'flex:0 0 auto;font:11px/1 system-ui,sans-serif;color:#a3adbb;text-align:right;font-variant-numeric:tabular-nums';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = '__wg_title_btn';
    btn.textContent = '插入';
    btn.title = '插入到公众号编辑器标题栏';
    btn.style.cssText = [
      'flex:0 0 auto', 'padding:2px 2px', 'border:0', 'border-radius:0',
      'background:transparent', 'color:#0d9488',
      'font:600 13px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
      'cursor:pointer', 'white-space:nowrap'
    ].join(';');

    var saved = '';
    try { saved = localStorage.getItem(WX_TITLE_KEY) || ''; } catch (e) { saved = ''; }
    if (saved) input.value = saved;

    function syncCount() {
      var n = input.value.length;
      cnt.textContent = n + '/' + WX_TITLE_MAX;
      cnt.style.color = n > 60 ? '#dc2626' : '#64748b';
    }
    syncCount();

    input.addEventListener('input', function () {
      syncCount();
      try { localStorage.setItem(WX_TITLE_KEY, input.value); } catch (e) { /* ignore */ }
      if (oldTitle) oldTitle.textContent = input.value || oldTitle.getAttribute('data-wg-orig') || '';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); setWxTitle(input.value); }
    });

    btn.onclick = function () { setWxTitle(input.value); };

    bar.appendChild(input);
    bar.appendChild(cnt);
    bar.appendChild(btn);

    if (oldTitle && oldTitle.parentNode === preview) preview.insertBefore(bar, oldTitle);
    else preview.insertBefore(bar, preview.firstChild);
  }

  function mountEntrances() {
    if (APP === 'zhilu') {
      mountTitleBar();
      var bar = document.querySelector('.top-bar');
      if (!bar) return;
      var article = function () { return document.getElementById('articleContent'); };
      bar.appendChild(makeBtn('✍️ 发到编辑台', '#0d9488', function () {
        var root = article();
        if (!root) return toast('还没有内容');
        var r = htmlToMd(root);
        if (!r.md) return toast('这篇笔记还没有正文');
        var t = document.querySelector('.article-title');
        sendToWriter(r.md, t ? t.textContent.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '').trim() : '', r.imgs);
      }));
      bar.appendChild(makeBtn('🛡 送合规检测', '#4338ca', function () {
        var root = article();
        if (!root) return toast('还没有内容');
        sendToCompliance(plainOf(root));
      }));
      return;
    }

    /* 情绪导演：贴在输出面板的按钮行上 */
    var rows = document.querySelectorAll('.panel .btn-row');
    var row = rows.length ? rows[rows.length - 1] : null;
    if (!row) return;
    row.appendChild(makeBtn('✍️ 发到编辑台', '#0d9488', function () {
      var out = document.getElementById('outputText');
      var text = out ? out.value.trim() : '';
      if (!text) return toast('先生成情绪导演词');
      var first = (text.split('\n').find(function (l) { return /^#/.test(l.trim()); }) || '').replace(/^#+\s*/, '').trim();
      sendToWriter(text, first);
    }));
    row.appendChild(makeBtn('🛡 送合规检测', '#4338ca', function () {
      var out = document.getElementById('outputText');
      sendToCompliance(out ? out.value.trim() : '');
    }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountEntrances);
  } else {
    mountEntrances();
  }

  /* 暴露给页面内脚本用 */
  window.WGStudio = {
    toast: toast,
    toWriter: sendToWriter,
    toCompliance: sendToCompliance,
    setWxTitle: setWxTitle,
    htmlToMd: htmlToMd,     /* 调试 / 自动化测试用 */
    isBridged: function () { return bridgeOn; }
  };

  /* 页面报错捎给工作台，方便排查（不影响页面本身） */
  window.addEventListener('error', function (e) {
    if (!bridgeOn || !e || !e.message) return;
    post({ type: 'WG_LOG', level: 'error', message: String(e.message).slice(0, 300), where: String(e.filename || '').slice(-60) + ':' + (e.lineno || 0) });
  });
})();
