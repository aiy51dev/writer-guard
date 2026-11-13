/* ============================================================
 * Writer Guard · Markdown → 公众号排版引擎
 *
 * 这一层是从开源 skill「md-to-wechat」的排版思路上搬过来的：
 * 原版把 Markdown 丢给第三方渲染服务（feishu2weixin.maolai.cc）
 * 换 HTML，需要注册账号 + THEME_ID，离线不可用。
 * 这里改成纯本地渲染：解析 → 拼内联样式，零网络、零依赖，
 * 主题自己做，样式全部内联（公众号编辑器只认内联样式）。
 *
 * 对外：
 *   WG.MD2WX.render(md, {theme})  → 微信可直接粘贴的 HTML
 *   WG.MD2WX.plainText(md)        → 去标记的纯文本（摘要/剪贴板兜底）
 *   WG.MD2WX.stats(md)            → { chars, cn, en, words, minutes }
 *   WG.MD2WX.digest(md, max)      → 自动摘要
 *   WG.MD2WX.THEMES               → 主题表
 *   WG.MD2WX.firstImage(md)       → 正文第一张图（当封面用）
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG || (root.WG = {});

  const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
  const MONO = "ui-monospace,'SF Mono',Consolas,'Cascadia Code',monospace";

  /* ---------- 主题 ----------
   * h2 样式变体：bar 左竖条 / center 居中细线 / underline 粗下划线 / box 反白色块
   */

  const THEMES = [
    {
      id: 'ink', name: '墨蓝', desc: '测评 · 教程 · 工具',
      accent: '#2563eb', accentSoft: '#eff4ff', title: '#0f172a', text: '#3f4652',
      line: '#e5e8ef', muted: '#9aa1ab', strong: '#1d4ed8',
      bodySize: 16, lineHeight: 1.85, letterSpacing: 0.4, gap: 18,
      h2: 'bar', h2Weight: 700,
      codeBg: '#eef1f6', codeColor: '#1d4ed8', codeBlockBg: '#f7f8fa',
      hlGreen: '#d7f5c4', hlGreenText: '#1f4d12',
      hlPurple: '#ede6ff', hlPurpleText: '#5b21b6',
    },
    {
      id: 'simple', name: '简约白', desc: '什么题材都稳',
      accent: '#111827', accentSoft: '#f4f5f7', title: '#000000', text: '#333333',
      line: '#e8e8e8', muted: '#9aa1ab', strong: '#000000',
      bodySize: 16, lineHeight: 1.9, letterSpacing: 0.6, gap: 20,
      h2: 'center', h2Weight: 700,
      codeBg: '#f2f3f5', codeColor: '#111827', codeBlockBg: '#fafafa',
      hlGreen: '#e4f7d8', hlGreenText: '#21500f',
      hlPurple: '#f0e8ff', hlPurpleText: '#5b21b6',
    },
    {
      id: 'warm', name: '暖橘', desc: '生活 · 职场 · 成长',
      accent: '#ea580c', accentSoft: '#fff7ed', title: '#7c2d12', text: '#4a4038',
      line: '#f1e6dd', muted: '#a89a90', strong: '#c2410c',
      bodySize: 16, lineHeight: 1.88, letterSpacing: 0.5, gap: 19,
      h2: 'underline', h2Weight: 700,
      codeBg: '#fdf1e7', codeColor: '#c2410c', codeBlockBg: '#fffaf5',
      hlGreen: '#dcfce7', hlGreenText: '#14532d',
      hlPurple: '#f3e8ff', hlPurpleText: '#6b21a8',
    },
    {
      id: 'forest', name: '松绿', desc: '科普 · 读书 · 干货',
      accent: '#059669', accentSoft: '#ecfdf5', title: '#064e3b', text: '#374151',
      line: '#e3efe9', muted: '#94a3a8', strong: '#047857',
      bodySize: 16, lineHeight: 1.9, letterSpacing: 0.5, gap: 19,
      h2: 'bar', h2Weight: 700,
      codeBg: '#e7f6ef', codeColor: '#047857', codeBlockBg: '#f6fbf8',
      hlGreen: '#ccf5dd', hlGreenText: '#065f46',
      hlPurple: '#ede9fe', hlPurpleText: '#5b21b6',
    },
    {
      id: 'gov', name: '红金', desc: '党建 · 政务 · 通报',
      accent: '#b91c1c', accentSoft: '#fef3f2', title: '#7f1d1d', text: '#333333',
      line: '#efe0dd', muted: '#a89693', strong: '#b91c1c',
      bodySize: 17, lineHeight: 1.95, letterSpacing: 0.8, gap: 20,
      h2: 'box', h2Weight: 700,
      codeBg: '#f8eeec', codeColor: '#9a3412', codeBlockBg: '#fdf8f7',
      hlGreen: '#e5f5d8', hlGreenText: '#1f4d12',
      hlPurple: '#f0e8ff', hlPurpleText: '#5b21b6',
    },
    {
      id: 'slate', name: '商务灰', desc: 'B 端 · 行业 · 报告',
      accent: '#334155', accentSoft: '#f1f5f9', title: '#0f172a', text: '#3f4652',
      line: '#e2e8f0', muted: '#94a3b8', strong: '#1e293b',
      bodySize: 16, lineHeight: 1.85, letterSpacing: 0.3, gap: 18,
      h2: 'bar', h2Weight: 600,
      codeBg: '#eef2f7', codeColor: '#1e293b', codeBlockBg: '#f8fafc',
      hlGreen: '#d9f2e4', hlGreenText: '#14532d',
      hlPurple: '#e9e5f9', hlPurpleText: '#4c1d95',
    },
  ];

  function themeOf(id) {
    for (let i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return THEMES[0];
  }

  /* ---------- 基础工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // 占位符用私有区字符，esc() 不会碰它
  const PH = (i) => '\u0001' + i + '\u0001';
  const PH_HAS = /\u0001\d+\u0001/;
  const PH_ALL = /\u0001(\d+)\u0001/g;

  /* ---------- 行内渲染 ---------- */

  function bold(t, T) {
    return '<strong style="font-weight:700;color:' + T.strong + ';">' + t + '</strong>';
  }

  function em(t, T) {
    return '<em style="font-style:italic;color:' + T.strong + ';">' + t + '</em>';
  }

  function mark(t, bg, color) {
    return '<span style="background-color:' + bg + ';color:' + color +
      ';padding:0 2px;border-radius:2px;">' + t + '</span>';
  }

  function safeUrl(url) {
    const u = String(url || '').trim();
    if (/^(javascript|vbscript|data:text\/html)/i.test(u)) return '#';
    return u;
  }

  /* 本地图片代号：智录笔记发过来的截图是 dataURL（几百 KB），
   * 直接写进 Markdown 就是一坨没法看的「图片代码」。
   * 所以正文里只留 `![图注](wgimg:xxx)` 这么短一个代号，
   * 真图存在工作台的图片库（WG.imgStore）里，渲染时再换回来。
   * 换不回来（清过缓存 / 换了浏览器）也不显示代码，只显示一个灰框。 */
  const RE_WGIMG = /\(\s*wgimg:([\w.-]+)\s*\)/g;
  const RE_WGIMG_MISS = /^wgimg-missing:/i;

  function imgMissing(alt, T) {
    const label = alt && alt !== '图片' && alt !== 'image' ? alt : '截图';
    return '<span style="display:block;padding:20px 14px;border:1px dashed ' + T.line +
      ';border-radius:6px;background:#f8fafc;color:' + T.muted +
      ';font-size:13px;line-height:1.7;text-align:center;">🖼 ' + esc(label) +
      '（原图没带过来，在智录笔记里重新点一次「发到编辑台」就好）</span>';
  }

  function imgTag(url, alt, T, block) {
    if (RE_WGIMG_MISS.test(String(url || ''))) return imgMissing(alt, T);
    const style = block
      ? 'display:block;max-width:100%;height:auto;margin:0 auto;border-radius:4px;'
      : 'max-width:100%;height:auto;vertical-align:middle;border-radius:3px;';
    return '<img src="' + esc(safeUrl(url)) + '" alt="' + esc(alt || '') +
      '" style="' + style + '">';
  }

  /* 把 wgimg 代号换成真图地址；查不到就换成缺图标记（绝不回落成 base64 文本） */
  function resolveImgs(md, imgs) {
    const src = String(md == null ? '' : md);
    if (src.indexOf('wgimg:') < 0) return { md: src, miss: 0 };
    let miss = 0;
    const out = src.replace(RE_WGIMG, (m, key) => {
      const u = imgs && imgs[key];
      if (u) return '(' + u + ')';
      miss++;
      return '(wgimg-missing:' + key + ')';
    });
    return { md: out, miss: miss };
  }

  function inline(src, T) {
    const store = [];
    let s = String(src == null ? '' : src);

    // ① 行内代码
    s = s.replace(/`([^`\n]+)`/g, (m, code) => {
      store.push('<code style="background:' + T.codeBg + ';color:' + T.codeColor +
        ';padding:1px 5px;margin:0 1px;border-radius:3px;font-size:' + (T.bodySize - 1) +
        'px;font-family:' + MONO + ';">' + esc(code) + '</code>');
      return PH(store.length - 1);
    });

    // ② 图片（必须先于链接，否则 ![]() 会被链接规则吃掉）
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;[^&]*&quot;|\s+"[^"]*")?\s*\)/g, (m, alt, url) => {
      store.push(imgTag(url, alt, T, false));
      return PH(store.length - 1);
    });

    // ③ 链接
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (m, text, url) => {
      store.push('<a href="' + esc(safeUrl(url)) + '" style="color:' + T.accent +
        ';text-decoration:none;border-bottom:1px solid ' + T.accent + ';padding-bottom:1px;">' +
        esc(text) + '</a>');
      return PH(store.length - 1);
    });

    // ④ 转义
    s = esc(s);

    // ⑤ 高亮（==绿底== / ~~紫底~~，与公众号助手插件的高亮语法一致）
    s = s.replace(/==([^=\n]+)==/g, (m, t) => mark(t, T.hlGreen, T.hlGreenText));
    s = s.replace(/~~([^~\n]+)~~/g, (m, t) => mark(t, T.hlPurple, T.hlPurpleText));

    // ⑥ 粗体 / 斜体
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, (m, t) =>
      '<strong style="font-weight:700;color:' + T.strong + ';"><em style="font-style:italic;">' + t + '</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, (m, t) => bold(t, T));
    s = s.replace(/__([^_\n]+)__/g, (m, t) => bold(t, T));
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, (m, p1, t) => p1 + em(t, T));
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, (m, p1, t) => p1 + em(t, T));

    // ⑦ 还原占位符
    let guard = 0;
    while (PH_HAS.test(s) && guard++ < 6) {
      s = s.replace(PH_ALL, (m, i) => (store[Number(i)] !== undefined ? store[Number(i)] : ''));
    }

    // 段内换行 → <br>，中文写作里这是「硬换行」的意思
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  /* ---------- 块解析 ---------- */

  const RE_HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
  const RE_HEAD = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const RE_QUOTE = /^\s{0,3}>\s?/;
  const RE_LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const RE_TABLE_ROW = /^\s*\|/;
  const RE_TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

  function indentOf(line) {
    const m = /^(\s*)/.exec(line);
    return m ? m[1].replace(/\t/g, '    ').length : 0;
  }

  function splitRow(line) {
    let s = String(line).trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    // 支持 \| 转义
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  function buildList(items, baseIndent) {
    const rootNode = { ordered: items[0].ordered, items: [] };
    const stack = [{ indent: baseIndent, node: rootNode }];

    items.forEach((it) => {
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];

      if (it.indent > top.indent && top.node.items.length) {
        const child = { ordered: it.ordered, items: [] };
        top.node.items[top.node.items.length - 1].children.push(child);
        stack.push({ indent: it.indent, node: child });
      }

      const target = stack[stack.length - 1].node;
      target.items.push({ text: it.text, children: [] });
    });

    return rootNode;
  }

  function parseList(lines, start) {
    const items = [];
    const baseIndent = indentOf(lines[start]);
    let i = start;

    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(RE_LI);

      if (m) {
        const ind = m[1].replace(/\t/g, '    ').length;
        if (ind < baseIndent) break;
        // 同层级换列表类型（- 换成 1.）说明旧列表已结束，别硬吃进同一个列表
        if (ind === baseIndent && items.length && /^\d/.test(m[2]) !== items[0].ordered) break;
        items.push({ indent: ind, ordered: /^\d/.test(m[2]), text: m[3] });
        i++;
        continue;
      }

      if (/^\s*$/.test(line)) {
        const nx = lines[i + 1];
        if (nx && RE_LI.test(nx) && indentOf(nx) >= baseIndent) { i++; continue; }
        break;
      }

      // 列表项的续行
      if (items.length) {
        items[items.length - 1].text += (items[items.length - 1].text ? '\n' : '') + line.trim();
        i++;
        continue;
      }
      break;
    }

    return { node: buildList(items, baseIndent), next: i };
  }

  function isBlockStart(line, next) {
    if (!line.trim()) return true;
    if (RE_HR.test(line)) return true;
    if (RE_HEAD.test(line)) return true;
    if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
    if (RE_QUOTE.test(line)) return true;
    if (RE_LI.test(line)) return true;
    if (RE_TABLE_ROW.test(line) && next != null && RE_TABLE_SEP.test(next) && next.indexOf('-') >= 0) return true;
    if (/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) return true;
    return false;
  }

  function parseBlocks(lines) {
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      /* 代码块 */
      const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/);
      if (fence) {
        const ch = fence[1][0];
        const lang = fence[2] || '';
        const closeRe = new RegExp('^\\s*' + (ch === '`' ? '`{3,}' : '~{3,}') + '\\s*$');
        i++;
        const buf = [];
        while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push({ type: 'code', lang: lang, text: buf.join('\n') });
        continue;
      }

      /* 分割线 */
      if (RE_HR.test(line)) { out.push({ type: 'hr' }); i++; continue; }

      /* 标题 */
      const h = line.match(RE_HEAD);
      if (h) {
        out.push({ type: 'head', level: Math.min(6, h[1].length), text: h[2] });
        i++;
        continue;
      }

      /* 引用 */
      if (RE_QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          buf.push(lines[i].replace(RE_QUOTE, ''));
          i++;
        }
        out.push({ type: 'quote', children: parseBlocks(buf) });
        continue;
      }

      /* 表格 */
      if (RE_TABLE_ROW.test(line) && lines[i + 1] && RE_TABLE_SEP.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && RE_TABLE_ROW.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push({ type: 'table', head: head, rows: rows });
        continue;
      }

      /* 列表 */
      if (RE_LI.test(line)) {
        const r = parseList(lines, i);
        out.push({ type: 'list', node: r.node });
        i = r.next;
        continue;
      }

      /* 独占一行的图片 → 图注 */
      const img = line.match(/^\s*!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)\s*$/);
      if (img) {
        out.push({ type: 'figure', alt: img[1], url: img[2] });
        i++;
        continue;
      }

      /* 段落 */
      const buf = [];
      while (i < lines.length && !isBlockStart(lines[i], lines[i + 1])) {
        buf.push(lines[i].trim());
        i++;
      }
      // 段落可能是被 isBlockStart 挡下来的单行（比如 '---' 边界），兜底推进
      if (!buf.length) { buf.push(lines[i].trim()); i++; }
      out.push({ type: 'para', text: buf.join('\n') });
    }

    return out;
  }

  /* ---------- 块渲染 ---------- */

  function h2Wrap(text, T) {
    const base = 'margin:34px 0 16px;font-size:19px;line-height:1.55;font-weight:' + T.h2Weight +
      ';color:' + T.title + ';letter-spacing:.3px;';

    if (T.h2 === 'center') {
      return '<h2 style="' + base + 'text-align:center;"><span style="display:inline-block;' +
        'padding:0 10px 7px;border-bottom:2px solid ' + T.accent + ';">' + text + '</span></h2>';
    }
    if (T.h2 === 'underline') {
      return '<h2 style="' + base + '"><span style="display:inline-block;padding-bottom:5px;' +
        'border-bottom:3px solid ' + T.accent + ';">' + text + '</span></h2>';
    }
    if (T.h2 === 'box') {
      return '<h2 style="margin:34px 0 16px;font-size:18px;line-height:1.6;font-weight:' + T.h2Weight +
        ';color:#ffffff;background-color:' + T.accent + ';padding:9px 14px;border-radius:3px;' +
        'letter-spacing:.5px;">' + text + '</h2>';
    }
    // bar
    return '<h2 style="margin:34px 0 16px;font-size:19px;line-height:1.55;font-weight:' + T.h2Weight +
      ';color:' + T.title + ';letter-spacing:.3px;border-left:4px solid ' + T.accent +
      ';padding:2px 0 2px 11px;">' + text + '</h2>';
  }

  function listHtml(node, T, depth) {
    const tag = node.ordered ? 'ol' : 'ul';
    const style = node.ordered
      ? 'margin:' + (depth ? '7px 0 4px' : '0 0 ' + T.gap + 'px') + ';padding-left:24px;list-style-type:decimal;'
      : 'margin:' + (depth ? '7px 0 4px' : '0 0 ' + T.gap + 'px') + ';padding-left:22px;list-style-type:disc;';

    const items = node.items.map((it) => {
      const child = it.children.length
        ? it.children.map((c) => listHtml(c, T, depth + 1)).join('')
        : '';
      return '<li style="margin:6px 0;font-size:' + T.bodySize + 'px;line-height:1.82;color:' +
        T.text + ';">' + inline(it.text, T) + child + '</li>';
    }).join('');

    return '<' + tag + ' style="' + style + '">' + items + '</' + tag + '>';
  }

  function renderBlocks(blocks, T) {
    return blocks.map((b) => {
      switch (b.type) {
        case 'head': {
          const lv = b.level;
          if (lv === 1) {
            return '<h1 style="margin:0 0 20px;font-size:22px;line-height:1.5;font-weight:700;color:' +
              T.title + ';">' + inline(b.text, T) + '</h1>';
          }
          if (lv === 2) return h2Wrap(inline(b.text, T), T);
          const size = lv === 3 ? 17 : lv === 4 ? 16 : 15;
          const mark2 = lv === 3
            ? '<span style="display:inline-block;width:6px;height:6px;background-color:' + T.accent +
              ';border-radius:1px;margin-right:8px;vertical-align:3px;"></span>'
            : '';
          return '<h' + lv + ' style="margin:24px 0 12px;font-size:' + size + 'px;line-height:1.6;' +
            'font-weight:600;color:' + T.title + ';">' + mark2 + inline(b.text, T) + '</h' + lv + '>';
        }

        case 'para':
          return '<p style="margin:0 0 ' + T.gap + 'px;font-size:' + T.bodySize + 'px;line-height:' +
            T.lineHeight + ';color:' + T.text + ';letter-spacing:' + T.letterSpacing + 'px;">' +
            inline(b.text, T) + '</p>';

        case 'quote':
          return '<blockquote style="margin:0 0 ' + T.gap + 'px;padding:13px 16px;border-left:3px solid ' +
            T.accent + ';background-color:' + T.accentSoft + ';border-radius:0 4px 4px 0;color:#5b6472;">' +
            renderBlocks(b.children, Object.assign({}, T, { gap: 8, text: '#5b6472' })) + '</blockquote>';

        case 'list':
          return listHtml(b.node, T, 0);

        case 'table': {
          const cellBase = 'padding:9px 10px;border:1px solid ' + T.line + ';text-align:left;' +
            'vertical-align:top;font-size:' + (T.bodySize - 1) + 'px;line-height:1.7;';
          const th = b.head.map((c) =>
            '<th style="' + cellBase + 'background-color:' + T.accentSoft + ';color:' + T.title +
            ';font-weight:600;">' + inline(c, T) + '</th>').join('');
          const trs = b.rows.map((row) => {
            const tds = row.map((c) =>
              '<td style="' + cellBase + 'color:' + T.text + ';">' + inline(c, T) + '</td>').join('');
            return '<tr>' + tds + '</tr>';
          }).join('');
          return '<section style="margin:0 0 ' + T.gap + 'px;overflow-x:auto;">' +
            '<table style="width:100%;border-collapse:collapse;table-layout:auto;">' +
            '<thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></section>';
        }

        case 'code':
          return '<section style="margin:0 0 ' + T.gap + 'px;background-color:' + T.codeBlockBg +
            ';border:1px solid ' + T.line + ';border-radius:6px;padding:13px 15px;overflow-x:auto;">' +
            '<pre style="margin:0;font-family:' + MONO + ';font-size:13px;line-height:1.7;color:#3f4652;' +
            'white-space:pre;overflow-x:auto;"><code>' + esc(b.text) + '</code></pre></section>';

        case 'figure': {
          /* 「截图1」「图1」这类自动取的名字不当图注，只有人工写的说明才显示 */
          const isAuto = /^(截图|图片|image|img|图)\s*\d*$/i.test(String(b.alt || '').trim());
          const caption = b.alt && b.alt.trim() && !isAuto
            ? '<span style="display:block;margin-top:8px;font-size:12.5px;color:' + T.muted +
              ';text-align:center;line-height:1.6;">' + esc(b.alt) + '</span>'
            : '';
          return '<section style="margin:0 0 ' + T.gap + 'px;text-align:center;">' +
            imgTag(b.url, b.alt, T, true) + caption + '</section>';
        }

        case 'hr':
          return '<hr style="border:0;border-top:1px solid ' + T.line + ';margin:' + (T.gap + 10) + 'px 0;">';

        default:
          return '';
      }
    }).join('\n');
  }

  /* ---------- 对外 ---------- */

  function render(md, opts) {
    const T = themeOf(opts && opts.theme);
    /* 本地代号 → 真图；opts.imgs 是 { key: dataURL } 映射 */
    const r = resolveImgs(md, opts && opts.imgs);
    const blocks = parseBlocks(r.md.replace(/\r\n?/g, '\n').split('\n'));
    const body = renderBlocks(blocks, T);

    return '<section style="font-size:' + T.bodySize + 'px;color:' + T.text + ';line-height:' +
      T.lineHeight + ';letter-spacing:' + T.letterSpacing + 'px;font-family:' + FONT +
      ';text-align:left;word-wrap:break-word;word-break:break-word;">' + body + '</section>';
  }

  function plainText(md) {
    let s = String(md == null ? '' : md);
    s = s.replace(/```[\s\S]*?```/g, ' ');
    s = s.replace(/~~~[\s\S]*?~~~/g, ' ');
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    s = s.replace(/^\s{0,3}>\s?/gm, '');
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    s = s.replace(/^\s*\d+[.)]\s+/gm, '');
    s = s.replace(/^\s*\|/gm, '');
    s = s.replace(/\|/g, ' ');
    s = s.replace(/[*_`~=]/g, '');
    s = s.replace(/\n{2,}/g, '\n');
    return s.trim();
  }

  function stats(md) {
    const text = plainText(md);
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (text.match(/[A-Za-z]+/g) || []).length;
    const chars = text.replace(/\s/g, '').length;
    const words = cn + en;
    return {
      chars: chars,
      cn: cn,
      en: en,
      words: words,
      minutes: Math.max(1, Math.ceil(words / 400)),
    };
  }

  function digest(md, max) {
    const text = plainText(md).replace(/\n+/g, ' ').trim();
    const lim = max || 100;
    if (text.length <= lim) return text;
    return text.slice(0, lim).replace(/[，、。；,;.\s]+$/, '') + '…';
  }

  function firstImage(md, imgs) {
    const stripped = String(md || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]+`/g, '');
    const m = stripped.match(/!\[[^\]]*\]\(\s*((?:https?:\/\/|data:)[^)\s]+)/);
    if (m) return m[1];
    const local = stripped.match(/!\[[^\]]*\]\(\s*wgimg:([\w.-]+)\s*\)/);
    if (local && imgs && imgs[local[1]]) return imgs[local[1]];
    return '';
  }

  WG.MD2WX = {
    THEMES: THEMES,
    themeOf: themeOf,
    render: render,
    plainText: plainText,
    stats: stats,
    digest: digest,
    firstImage: firstImage,
    resolveImgs: resolveImgs,
    // 测试钩子
    _parse: parseBlocks,
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
