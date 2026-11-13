/* ============================================================
 * Writer Guard · 文件夹贴纸库
 *
 * 20 个文件夹样式素材，用 Canvas 矢量绘制成透明 PNG，
 * 插入画布后就是普通图片图层，可以拖动、缩放、导出。
 * 带文字标签的会额外配一个可编辑的文字图层。
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG || (root.WG = {});

  const SIZE = 512;          // 内部绘制尺寸
  const PAD = 40;            // 留白

  /* ---------- 绘图小工具 ---------- */

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function shade(hex, amount) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return hex;
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(((n >> 16) & 255) * (1 + amount));
    const g = clamp(((n >> 8) & 255) * (1 + amount));
    const b = clamp((n & 255) * (1 + amount));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------- 文件夹主体 ---------- */

  function drawFolder(ctx, box, color) {
    const { x, y, w, h } = box;
    const tabW = w * 0.4;
    const tabH = h * 0.16;
    const bodyY = y + tabH * 0.72;

    // 背板凸起
    ctx.beginPath();
    ctx.moveTo(x + 6, bodyY);
    ctx.lineTo(x + 6, y + 8);
    ctx.quadraticCurveTo(x + 6, y, x + tabW * 0.55, y);
    ctx.lineTo(x + tabW, y);
    ctx.quadraticCurveTo(x + tabW + 22, y, x + tabW + 34, y + tabH);
    ctx.lineTo(x + 6, y + tabH);
    ctx.closePath();
    ctx.fillStyle = shade(color, -0.18);
    ctx.fill();

    // 主体
    roundRect(ctx, x, bodyY, w, h - tabH * 0.72, 26);
    const grad = ctx.createLinearGradient(x, bodyY, x, bodyY + h);
    grad.addColorStop(0, shade(color, 0.1));
    grad.addColorStop(1, shade(color, -0.05));
    ctx.fillStyle = grad;
    ctx.fill();

    // 顶部高光
    ctx.save();
    roundRect(ctx, x + 12, bodyY + 14, w - 24, (h - tabH) * 0.42, 18);
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    ctx.fill();
    ctx.restore();

    // 底部阴影线
    ctx.save();
    roundRect(ctx, x + 10, bodyY + h - tabH * 0.72 - 16, w - 20, 8, 4);
    ctx.fillStyle = 'rgba(0,0,0,.06)';
    ctx.fill();
    ctx.restore();
  }

  /* ---------- 各类图标 ---------- */

  const ICONS = {
    doc(ctx, cx, cy, s) {
      const w = s * 0.46;
      const h = s * 0.6;
      const x = cx - w / 2;
      const y = cy - h / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y + 8);
      ctx.quadraticCurveTo(x, y, x + 8, y);
      ctx.lineTo(x + w - 16, y);
      ctx.lineTo(x + w, y + 16);
      ctx.lineTo(x + w, y + h - 8);
      ctx.quadraticCurveTo(x + w, y + h, x + w - 8, y + h);
      ctx.lineTo(x + 8, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w - 16, y);
      ctx.lineTo(x + w - 16, y + 16);
      ctx.lineTo(x + w, y + 16);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const ly = y + 28 + i * 14;
        ctx.beginPath();
        ctx.moveTo(x + 12, ly);
        ctx.lineTo(x + w - 16 - (i === 2 ? 14 : 0), ly);
        ctx.stroke();
      }
    },

    zip(ctx, cx, cy, s) {
      const w = s * 0.44;
      const h = s * 0.6;
      const x = cx - w / 2;
      const y = cy - h / 2;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // 拉链
      const zx = cx;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(zx, y + 6);
      ctx.lineTo(zx, y + h * 0.52);
      ctx.stroke();

      ctx.fillStyle = '#475569';
      for (let i = 0; i < 6; i++) {
        const ty = y + 10 + i * 12;
        ctx.fillRect(zx - 7, ty, 5, 6);
        ctx.fillRect(zx + 2, ty + 4, 5, 6);
      }

      // 拉头
      ctx.fillStyle = '#334155';
      roundRect(ctx, zx - 9, y + h * 0.54, 18, h * 0.3, 5);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      roundRect(ctx, zx - 3, y + h * 0.58, 6, h * 0.16, 3);
      ctx.fill();
    },

    image(ctx, cx, cy, s) {
      const w = s * 0.56;
      const h = s * 0.44;
      const x = cx - w / 2;
      const y = cy - h / 2;
      roundRect(ctx, x, y, w, h, 7);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.save();
      roundRect(ctx, x, y, w, h, 7);
      ctx.clip();

      // 山
      ctx.fillStyle = '#93c5fd';
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w * 0.34, y + h * 0.42);
      ctx.lineTo(x + w * 0.58, y + h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.38, y + h);
      ctx.lineTo(x + w * 0.68, y + h * 0.5);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();

      // 太阳
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x + w * 0.76, y + h * 0.26, h * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    video(ctx, cx, cy, s) {
      const w = s * 0.56;
      const h = s * 0.4;
      const x = cx - w / 2;
      const y = cy - h / 2;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fill();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.05, cy - s * 0.08);
      ctx.lineTo(cx + s * 0.1, cy);
      ctx.lineTo(cx - s * 0.05, cy + s * 0.08);
      ctx.closePath();
      ctx.fill();
    },

    audio(ctx, cx, cy, s) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx - s * 0.08, cy + s * 0.1, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + s * 0.12, cy + s * 0.03, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.03, cy + s * 0.1);
      ctx.lineTo(cx - s * 0.03, cy - s * 0.12);
      ctx.lineTo(cx + s * 0.17, cy - s * 0.19);
      ctx.lineTo(cx + s * 0.17, cy + s * 0.03);
      ctx.stroke();
    },

    code(ctx, cx, cy, s) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const d = s * 0.11;
      ctx.beginPath();
      ctx.moveTo(cx - d * 0.9, cy - d * 0.9);
      ctx.lineTo(cx - d * 2, cy);
      ctx.lineTo(cx - d * 0.9, cy + d * 0.9);
      ctx.moveTo(cx + d * 0.9, cy - d * 0.9);
      ctx.lineTo(cx + d * 2, cy);
      ctx.lineTo(cx + d * 0.9, cy + d * 0.9);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + d * 0.35, cy - d * 1.3);
      ctx.lineTo(cx - d * 0.35, cy + d * 1.3);
      ctx.stroke();
    },

    sheet(ctx, cx, cy, s) {
      const w = s * 0.5;
      const h = s * 0.46;
      const x = cx - w / 2;
      const y = cy - h / 2;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();

      ctx.strokeStyle = 'rgba(16,185,129,.75)';
      ctx.lineWidth = 2.5;
      for (let i = 1; i < 3; i++) {
        const ly = y + (h / 3) * i;
        ctx.beginPath();
        ctx.moveTo(x + 6, ly);
        ctx.lineTo(x + w - 6, ly);
        ctx.stroke();
      }
      for (let i = 1; i < 3; i++) {
        const lx = x + (w / 3) * i;
        ctx.beginPath();
        ctx.moveTo(lx, y + 6);
        ctx.lineTo(lx, y + h - 6);
        ctx.stroke();
      }
    },

    pdf(ctx, cx, cy, s) {
      const w = s * 0.42;
      const h = s * 0.54;
      const x = cx - w / 2;
      const y = cy - h / 2 - s * 0.04;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();

      ctx.fillStyle = '#dc2626';
      roundRect(ctx, x + w * 0.08, y + h * 0.56, w * 0.84, h * 0.3, 5);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 ' + Math.round(h * 0.17) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PDF', cx, y + h * 0.71);
    },

    lock(ctx, cx, cy, s) {
      // 锁身
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, cx - s * 0.16, cy - s * 0.02, s * 0.32, s * 0.26, 7);
      ctx.fill();

      // 锁梁
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.02, s * 0.1, Math.PI, 0);
      ctx.stroke();

      // 锁孔
      ctx.fillStyle = '#f5b544';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.1, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    },

    star(ctx, cx, cy, s) {
      const spikes = 5;
      const outer = s * 0.2;
      const inner = outer * 0.45;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / spikes) * i - Math.PI / 2;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },

    cloud(ctx, cx, cy, s) {
      ctx.fillStyle = '#ffffff';
      const r = s * 0.085;
      ctx.beginPath();
      ctx.arc(cx - s * 0.1, cy + s * 0.02, r, 0, Math.PI * 2);
      ctx.arc(cx, cy - s * 0.045, r * 1.3, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.12, cy + s * 0.02, r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - s * 0.1, cy + s * 0.02, s * 0.22, r);
    },

    gear(ctx, cx, cy, s) {
      const outer = s * 0.17;
      const inner = s * 0.12;
      const teeth = 8;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / teeth) * i;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = '#f5b544';
      ctx.fill();
    },
  };

  /* ---------- 20 个贴纸 ---------- */

  const STICKERS = [
    { id: 'folder-plain', name: '文件夹', color: '#f5b544', icon: '' },
    { id: 'folder-doc', name: '文档', color: '#f5b544', icon: 'doc' },
    { id: 'folder-zip', name: '压缩包', color: '#f5b544', icon: 'zip' },
    { id: 'folder-image', name: '图片', color: '#f5b544', icon: 'image' },
    { id: 'folder-video', name: '视频', color: '#f5b544', icon: 'video' },
    { id: 'folder-audio', name: '音频', color: '#f5b544', icon: 'audio' },
    { id: 'folder-code', name: '代码', color: '#334155', icon: 'code' },
    { id: 'folder-sheet', name: '表格', color: '#10b981', icon: 'sheet' },
    { id: 'folder-pdf', name: 'PDF', color: '#ef4444', icon: 'pdf' },
    { id: 'folder-lock', name: '加密', color: '#6366f1', icon: 'lock' },
    { id: 'folder-star', name: '收藏', color: '#f59e0b', icon: 'star' },
    { id: 'folder-cloud', name: '云端', color: '#0ea5e9', icon: 'cloud' },
    { id: 'folder-gear', name: '设置', color: '#64748b', icon: 'gear' },
    { id: 'folder-blue', name: '蓝色', color: '#3b82f6', icon: 'doc' },
    { id: 'folder-purple', name: '紫色', color: '#8b5cf6', icon: 'doc' },
    { id: 'folder-green', name: '绿色', color: '#22c55e', icon: 'doc' },
    { id: 'folder-pink', name: '粉色', color: '#ec4899', icon: 'doc' },
    { id: 'label-download', name: '下载', color: '#f5b544', icon: 'zip', label: '下载' },
    { id: 'label-resource', name: '资料', color: '#3b82f6', icon: 'doc', label: '资料' },
    { id: 'label-template', name: '模板', color: '#8b5cf6', icon: 'star', label: '模板' },
  ];

  /* ---------- 渲染成 dataURL ---------- */

  const cache = {};

  function renderSticker(st, opts) {
    const withLabel = !opts || opts.withLabel !== false;
    const cacheKey = st.id + (withLabel ? ':label' : ':plain');
    if (cache[cacheKey]) return cache[cacheKey];

    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE;
    const ctx = cv.getContext('2d');

    const w = SIZE - PAD * 2;
    const h = Math.round(w * 0.78);
    const x = PAD;
    const y = Math.round((SIZE - h) / 2);

    drawFolder(ctx, { x, y, w, h }, st.color);

    const cx = x + w / 2;
    const cy = y + h * 0.56;

    if (st.icon && ICONS[st.icon]) {
      ICONS[st.icon](ctx, cx, cy, w);
    }

    if (st.label && withLabel) {
      ctx.font = '800 ' + Math.round(w * 0.11) + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.96)';
      ctx.fillText(st.label, cx, y + h * 0.86);
    }

    const url = cv.toDataURL('image/png');
    cache[cacheKey] = url;
    return url;
  }

  function get(id) {
    return STICKERS.find((s) => s.id === id) || null;
  }

  WG.Stickers = {
    STICKERS,
    SIZE,
    get,
    renderSticker,
    clearCache() { Object.keys(cache).forEach((k) => delete cache[k]); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
