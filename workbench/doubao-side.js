/* 豆包侧窗外壳：加载提示的显隐 + 新窗口兜底链接。
 * 注意：本文件是 MV3 扩展页面脚本（不能内联在 html 里，CSP script-src 'self' 会禁掉）。 */
(function () {
  var frame = document.getElementById('frame');
  var tip = document.getElementById('tip');
  if (!frame || !tip) return;

  var done = false;
  function hide() {
    if (done) return;
    done = true;
    tip.classList.add('is-off');
  }

  /* 豆包 load 事件到了就收提示（再留 260ms 防白屏一闪） */
  frame.addEventListener('load', function () { setTimeout(hide, 260); });

  /* 兜底：跨域 iframe 的 load 有时来得早或根本不来，6 秒后无论如何收掉提示，
   * 让用户直接看到豆包本体 */
  setTimeout(hide, 6000);

  var ext = document.getElementById('ext');
  if (ext) {
    ext.addEventListener('click', function (e) {
      e.preventDefault();
      var url = 'https://www.doubao.com/chat/';
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: url });
          return;
        }
      } catch (err) { /* 落到 window.open */ }
      window.open(url, '_blank', 'noopener');
    });
  }
})();
