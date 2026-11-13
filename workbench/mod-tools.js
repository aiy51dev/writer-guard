/* ============================================================
 * Writer Guard · 生产工具模块
 * 视图：模板库 / 截图标注 / 多平台改写
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG;
  const $ = WG.$;
  const $$ = WG.$$;
  const esc = WG.esc;

  /* ============================================================
   * 一、模板库
   * ============================================================ */

  function initTemplates() {
    const box = $('#template-list');
    if (!box) return;

    const DICT = root.WG_DICT || {};
    const list = DICT.templates || [];

    box.innerHTML = list.map((t) => `
      <div class="tpl" data-id="${esc(t.id)}">
        <div class="tpl-head">
          <b>${esc(t.name)}</b>
          <div class="card-actions">
            <button class="btn btn-sm" data-act="copy">复制</button>
            <button class="btn btn-sm btn-ghost" data-act="insert">插入检测台</button>
          </div>
        </div>
        <div class="tpl-desc">${esc(t.desc)}</div>
        <pre class="tpl-body">${esc(t.body)}</pre>
      </div>
    `).join('');

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const tpl = btn.closest('.tpl');
      const id = tpl.dataset.id;
      const item = list.find((x) => x.id === id);
      if (!item) return;

      if (btn.dataset.act === 'copy') {
        WG.copy(item.body);
      } else {
        const ta = $('#in-body');
        if (ta) {
          ta.value = ta.value ? ta.value + '\n\n' + item.body : item.body;
          WG.switchView('compliance');
          WG.toast('已插入正文，记得点检测');
        }
      }
    });
  }

  /* ============================================================
   * 二、截图标注
   *   · 滚轮悬浮放大看细节（指针锚点缩放 / 中键·空格拖动 / 双击切档）
   *   · 原创指纹：重编码 + 亚像素微扰 + 分块差异调色（肉眼不可见）
   *   · 光效滤镜：亮度/对比/饱和/色温/锐化/颗粒/暗角 + 自定义背景光
   *   · 分块融合：块参数线性过渡，放大到 800% 也没有接缝
   * ============================================================ */

  const AN_WORK_MAX = 1800;   // 工作分辨率长边上限（公众号够用，处理也快）
  const AN_ZOOM_MIN = 0.1;
  const AN_ZOOM_MAX = 12;

  /* 指纹强度：全部控制在 1~2 个色阶以内，PSNR 稳定在 40dB 以上 */
  const AN_STRENGTH = {
    light: { bri: 0.004, con: 0.006, sat: 0.005, temp: 0.005, noise: 0.9, block: 0.006 },
    std: { bri: 0.008, con: 0.012, sat: 0.009, temp: 0.008, noise: 1.7, block: 0.011 },
    strong: { bri: 0.012, con: 0.018, sat: 0.012, temp: 0.012, noise: 2.4, block: 0.016 },
  };

  const AN_LOOK_PRESET = {
    clean: { bri: 104, con: 103, sat: 104, temp: 2, sharp: 18, grain: 0, vig: 0, glowOn: true, glow: 22, glowSize: 90, glowX: 50, glowY: 20, glowColor: '#ffffff' },
    warm: { bri: 103, con: 102, sat: 108, temp: 12, sharp: 10, grain: 4, vig: 10, glowOn: true, glow: 30, glowSize: 86, glowX: 62, glowY: 28, glowColor: '#ffd9a0' },
    cool: { bri: 102, con: 104, sat: 96, temp: -10, sharp: 12, grain: 0, vig: 6, glowOn: true, glow: 24, glowSize: 82, glowX: 40, glowY: 22, glowColor: '#cfe6ff' },
    film: { bri: 100, con: 108, sat: 92, temp: 5, sharp: 6, grain: 22, vig: 28, glowOn: true, glow: 18, glowSize: 96, glowX: 50, glowY: 40, glowColor: '#fff0d0' },
    reset: { bri: 100, con: 100, sat: 100, temp: 0, sharp: 0, grain: 0, vig: 0, glowOn: false, glow: 35, glowSize: 80, glowX: 50, glowY: 35, glowColor: '#fff3d6' },
  };

  const AN = {
    canvas: null,
    ctx: null,
    stage: null,
    hud: null,
    img: null,        // 原始 Image
    src: null,        // 原始像素（工作分辨率）
    base: null,       // 处理后的底图
    ops: [],
    cur: null,
    sel: -1,
    move: null,
    tool: 'arrow',
    color: '#e5484d',
    width: 3,
    drawing: false,
    pan: null,
    space: false,
    z: 1,
    fitZ: 1,
    seed: 0,
    rounds: 1,
    busy: false,
    pending: false,
    timer: 0,
    hudTimer: 0,
    srcSha: '',
    P: {
      fp: { on: true, strength: 'std', recode: true, noise: true, block: true, resample: false },
      look: {
        bri: 100, con: 100, sat: 100, temp: 0, sharp: 0, grain: 0, vig: 0,
        glowOn: false, glow: 35, glowSize: 80, glowX: 50, glowY: 35, glowColor: '#fff3d6',
      },
      slice: { on: false, mode: 'strip', count: 4, feather: 60 },
    },
    stats: { psnr: 0, stitch: 0, w: 0, h: 0 },
  };

  /* ---------- 小工具 ---------- */

  function anNow() {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  }

  function anRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function anRgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 'rgba(255,243,214,' + a + ')';
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  async function anSha256(buf) {
    try {
      if (!root.crypto || !root.crypto.subtle || !buf) return '';
      const d = await root.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }

  const AN_CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function anCrc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = AN_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* 往 PNG 里写 tEXt：告诉任何读图工具「这张是谁、什么时候、用什么参数生成的」 */
  function anInjectPngText(buf, entries) {
    const u8 = new Uint8Array(buf);
    if (u8.length < 40 || u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) return buf;
    const enc = new TextEncoder();
    const parts = [u8.subarray(0, 33)];  // 8 字节签名 + IHDR（25 字节）
    entries.forEach((pair) => {
      const data = enc.encode(pair[0] + '\u0000' + pair[1]);
      const chunk = new Uint8Array(12 + data.length);
      const dv = new DataView(chunk.buffer);
      dv.setUint32(0, data.length);
      chunk.set(enc.encode('tEXt'), 4);
      chunk.set(data, 8);
      dv.setUint32(8 + data.length, anCrc32(chunk.subarray(4, 8 + data.length)));
      parts.push(chunk);
    });
    parts.push(u8.subarray(33));
    let len = 0;
    parts.forEach((p) => { len += p.length; });
    const out = new Uint8Array(len);
    let off = 0;
    parts.forEach((p) => { out.set(p, off); off += p.length; });
    return out.buffer;
  }

  /* ---------- 图像处理 ---------- */

  function anCloneCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    return c;
  }

  /* 分块参数场：每个像素的微调系数在相邻块之间线性过渡，所以永远不会有硬边 */
  function anFillField(arr, count, amp, feather, rnd) {
    const len = arr.length;
    if (count <= 1 || !amp) { arr.fill(0); return; }
    const vals = [];
    for (let i = 0; i < count; i++) vals.push((rnd() * 2 - 1) * amp);
    const k = 1 + ((100 - Math.max(0, Math.min(100, feather))) / 100) * 5;
    for (let i = 0; i < len; i++) {
      const pos = (i / len) * count - 0.5;
      let bi = Math.floor(pos);
      let t = pos - bi;
      if (bi < 0) { bi = 0; t = 0; }
      else if (bi >= count - 1) { bi = count - 2; t = 1; }
      if (k > 1.01) {
        t = t < 0.5 ? 0.5 * Math.pow(2 * t, k) : 1 - 0.5 * Math.pow(2 * (1 - t), k);
      }
      arr[i] = vals[bi] * (1 - t) + vals[bi + 1] * t;
    }
  }

  function anNeedProcess() {
    const L = AN.P.look;
    return AN.P.fp.on || AN.P.slice.on || L.bri !== 100 || L.con !== 100 || L.sat !== 100 ||
      L.temp !== 0 || L.grain > 0 || L.vig > 0 || (L.glowOn && L.glow > 0);
  }

  function anHexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return { r: 255, g: 243, b: 214 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /* 一次像素遍历，把所有活都干完：调色 + 分块微差 + 噪点 + 暗角 + 背景光
   *  opts.look  : true=做调色（亮度/对比/饱和/色温/锐化颗粒/暗角/背景光）
   *  opts.fpScale: 扰动幅度系数，多轮叠加时按 1/√n 缩放，总量恒定、画质不衰减 */
  function anProcess(canvas, seed, withGlow, opts) {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return canvas;

    const o = opts || {};
    const doLook = o.look !== false;
    const k2 = (o.fpScale == null || !(o.fpScale > 0)) ? 1 : o.fpScale;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const frame = ctx.getImageData(0, 0, w, h);
    const s = frame.data;

    const L = AN.P.look;
    const fp = AN.P.fp;
    const sl = AN.P.slice;
    const S = AN_STRENGTH[fp.strength] || AN_STRENGTH.std;

    const blocksY = sl.on ? Math.max(2, sl.count | 0) : 1;
    const blocksX = (sl.on && sl.mode === 'grid') ? 2 : 1;
    const fieldAmp = ((fp.on && fp.block) ? S.block : (sl.on ? 0.008 : 0)) * k2;

    const rnd = anRandom(seed);
    const ky = new Float32Array(h);
    const kx = new Float32Array(w);
    anFillField(ky, blocksY, fieldAmp, sl.feather, rnd);
    anFillField(kx, blocksX, fieldAmp, sl.feather, rnd);

    /* 颗粒属于「调色」，只在 look 那一遍加，叠加多轮不会再噪一层 */
    const nAmp = (doLook ? (L.grain / 100) * 16 : 0) +
      ((fp.on && fp.noise ? S.noise : 0) * k2);
    const fB = doLook ? L.bri / 100 : 1;
    const fC = doLook ? L.con / 100 : 1;
    const fS = doLook ? L.sat / 100 : 1;
    const fT = doLook ? L.temp / 100 : 0;
    const vig = doLook ? L.vig / 100 : 0;

    /* 背景光：只提亮暗部，亮部几乎不动，所以细节不会被洗掉 */
    const glowOn = doLook && !!withGlow && L.glowOn && L.glow > 0;
    const gAmp = glowOn ? (L.glow / 100) : 0;
    const gCol = anHexRgb(L.glowColor);
    const gx = w * (Math.max(0, Math.min(100, L.glowX)) / 100);
    const gy = h * (Math.max(0, Math.min(100, L.glowY)) / 100);
    const gRad = Math.max(w, h) * (Math.max(20, Math.min(150, L.glowSize)) / 100) * 0.95;
    const gRad2 = gRad * gRad || 1;
    const gqx = new Float32Array(w);

    if (fB === 1 && fC === 1 && fS === 1 && fT === 0 && !nAmp && !vig && !fieldAmp && !gAmp) return canvas;

    const cx = w / 2;
    const cy = h / 2;
    const maxR2 = cx * cx + cy * cy || 1;
    const vx = new Float32Array(w);
    if (vig) {
      for (let x = 0; x < w; x++) vx[x] = ((x - cx) * (x - cx)) / maxR2;
    }
    if (gAmp) {
      for (let x = 0; x < w; x++) gqx[x] = (x - gx) * (x - gx);
    }

    const out = ctx.createImageData(w, h);
    const d = out.data;

    for (let y = 0; y < h; y++) {
      const kyv = ky[y];
      const rowOff = y * w * 4;
      const dy2 = vig ? ((y - cy) * (y - cy)) / maxR2 : 0;
      const gqy = gAmp ? (y - gy) * (y - gy) : 0;

      for (let x = 0; x < w; x++) {
        const i = rowOff + x * 4;
        let r = s[i];
        let g = s[i + 1];
        let b = s[i + 2];
        const k = kyv + kx[x];

        if (fB !== 1 || k) {
          const m = fB * (1 + k * 0.75);
          r *= m; g *= m; b *= m;
        }
        if (fC !== 1 || k) {
          const c = 1 + (fC - 1) * (1 + k * 0.9);
          r = (r - 128) * c + 128;
          g = (g - 128) * c + 128;
          b = (b - 128) * c + 128;
        }
        if (fS !== 1 || k) {
          const sat = 1 + (fS - 1) * (1 + k * 0.7);
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = gray + (r - gray) * sat;
          g = gray + (g - gray) * sat;
          b = gray + (b - gray) * sat;
        }
        if (fT || k) {
          const t = fT + k * 0.6;
          r *= 1 + t * 0.18;
          b *= 1 - t * 0.18;
        }
        if (nAmp) {
          let nz = (x * 374761393 + y * 668265263 + seed) | 0;
          nz = Math.imul(nz ^ (nz >>> 13), 1274126177) | 0;
          nz = (nz ^ (nz >>> 16)) >>> 0;
          const nv = (nz / 4294967295 - 0.5) * 2 * nAmp;
          r += nv; g += nv; b += nv;
        }
        if (vig) {
          const vf = 1 - vig * 0.7 * (vx[x] + dy2);
          r *= vf; g *= vf; b *= vf;
        }
        if (gAmp) {
          const qd = (gqx[x] + gqy) / gRad2;
          if (qd < 1) {
            const t = 1 - qd;
            const wgt = t * t * t * gAmp;   /* 三次衰减：光只落在中心，边缘几乎不动 */
            const lf = 1 - Math.min(1, Math.max(0, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
            const kk = wgt * (0.2 + 0.8 * lf) * 0.5;
            r += (gCol.r - r) * kk;
            g += (gCol.g - g) * kk;
            b += (gCol.b - b) * kk;
          }
        }

        /* Uint8ClampedArray 自己会做 clamp + 四舍五入 */
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = s[i + 3];
      }
    }

    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  function anSharpen(canvas, amount) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    const s = src.data;
    const d = out.data;
    const a = (amount / 100) * 0.85;
    const row = w * 4;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const iu = y > 0 ? i - row : i;
        const id = y < h - 1 ? i + row : i;
        const il = x > 0 ? i - 4 : i;
        const ir = x < w - 1 ? i + 4 : i;
        for (let c = 0; c < 3; c++) {
          const v = s[i + c];
          const blur = (s[iu + c] + s[id + c] + s[il + c] + s[ir + c]) / 4;
          d[i + c] = v + (v - blur) * a;
        }
        d[i + 3] = s[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  /* 亚像素重采样：0.06% 的缩放，视觉上看不出来，但像素值全变了 */
  function anResample(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    if (w < 8 || h < 8) return;
    const tmp = document.createElement('canvas');
    tmp.width = w - 1;
    tmp.height = h - 1;
    const tc = tmp.getContext('2d');
    tc.imageSmoothingEnabled = true;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(canvas, 0, 0, tmp.width, tmp.height);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, w, h);
  }

  /* 背景光已并入像素流程（只提亮暗部），这里保留一个空壳给旧调用方 */
  function anGlow() { /* deprecated */ }

  function anPsnr(a, b) {
    const w = a.width;
    const h = a.height;
    if (b.width !== w || b.height !== h) return 0;
    const da = a.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const db = b.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let sse = 0;
    let n = 0;
    const step = w > 900 ? 3 : 2;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const dv = da[i + c] - db[i + c];
          sse += dv * dv;
          n++;
        }
      }
    }
    if (!n) return 99;
    if (!sse) return 99;
    return 10 * Math.log10((255 * 255) / (sse / n));
  }

  /* 接缝检测：块边界处的行间差 与 普通行间差 的比值，1.x 就说明无缝 */
  function anStitchCheck(canvas, count) {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return 0;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor(w / 200));

    function rowDiff(y1, y2) {
      if (y1 < 0 || y2 >= h) return 0;
      let sum = 0;
      let n = 0;
      for (let x = 0; x < w; x += step) {
        const i1 = (y1 * w + x) * 4;
        const i2 = (y2 * w + x) * 4;
        sum += Math.abs(data[i1] - data[i2]) + Math.abs(data[i1 + 1] - data[i2 + 1]) + Math.abs(data[i1 + 2] - data[i2 + 2]);
        n += 3;
      }
      return n ? sum / n : 0;
    }

    /* 用「局部邻行」当基线：同一片画面里比，才不会把渐变本身当成接缝 */
    let worst = 1;
    for (let i = 1; i < count; i++) {
      const y = Math.round((h * i) / count);
      if (y < 4 || y >= h - 4) continue;
      const here = rowDiff(y - 1, y);
      const near = (rowDiff(y - 4, y - 3) + rowDiff(y + 3, y + 4)) / 2;
      const ref = Math.max(0.06, near);
      const r = here / ref;
      if (r > worst) worst = r;
    }
    return worst;
  }

  /* ---------- 渲染 ---------- */

  function anPos(e) {
    const rect = AN.canvas.getBoundingClientRect();
    const sx = AN.canvas.width / (rect.width || 1);
    const sy = AN.canvas.height / (rect.height || 1);
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function anDrawArrow(op) {
    const ctx = AN.ctx;
    const x1 = op.x1;
    const y1 = op.y1;
    const x2 = op.x2;
    const y2 = op.y2;
    const head = Math.max(10, op.w * 4.2);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = op.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  function anDrawRect(op) {
    const ctx = AN.ctx;
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.w;
    ctx.strokeRect(
      Math.min(op.x1, op.x2),
      Math.min(op.y1, op.y2),
      Math.abs(op.x2 - op.x1),
      Math.abs(op.y2 - op.y1)
    );
  }

  function anDrawText(op) {
    const ctx = AN.ctx;
    const size = Math.max(14, op.w * 6);
    ctx.font = '600 ' + size + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = op.color;
    ctx.textBaseline = 'top';
    ctx.fillText(op.text, op.x1, op.y1);
  }

  function anDrawMosaic(op) {
    const ctx = AN.ctx;
    const x = Math.round(Math.min(op.x1, op.x2));
    const y = Math.round(Math.min(op.y1, op.y2));
    const w = Math.round(Math.abs(op.x2 - op.x1));
    const h = Math.round(Math.abs(op.y2 - op.y1));
    if (w < 2 || h < 2) return;

    const block = Math.max(6, Math.round(10 + op.w * 2));
    try {
      const src = ctx.getImageData(x, y, w, h);
      const data = src.data;
      for (let by = 0; by < h; by += block) {
        for (let bx = 0; bx < w; bx += block) {
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let yy = by; yy < Math.min(by + block, h); yy++) {
            for (let xx = bx; xx < Math.min(bx + block, w); xx++) {
              const i = (yy * w + xx) * 4;
              r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
            }
          }
          if (!n) continue;
          r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
          for (let yy = by; yy < Math.min(by + block, h); yy++) {
            for (let xx = bx; xx < Math.min(bx + block, w); xx++) {
              const i = (yy * w + xx) * 4;
              data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
            }
          }
        }
      }
      ctx.putImageData(src, x, y);
    } catch (e) { /* 越界就跳过 */ }
  }

  function anDrawOp(op) {
    if (!op) return;
    if (op.type === 'arrow') anDrawArrow(op);
    else if (op.type === 'rect') anDrawRect(op);
    else if (op.type === 'text') anDrawText(op);
    else if (op.type === 'mosaic') anDrawMosaic(op);
  }

  /* ---------- 图形命中与拖动 ---------- */

  function anDistToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  function anOpBounds(op) {
    if (op.type === 'text') {
      const size = Math.max(14, op.w * 6);
      let w = size * (op.text ? op.text.length : 1) * 0.6;
      try {
        AN.ctx.save();
        AN.ctx.font = '600 ' + size + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        w = AN.ctx.measureText(op.text || '').width;
        AN.ctx.restore();
      } catch (e) { /* 保底估算 */ }
      return { x: op.x1, y: op.y1, w: w, h: size * 1.2 };
    }
    const x = Math.min(op.x1, op.x2);
    const y = Math.min(op.y1, op.y2);
    const w = Math.max(1, Math.abs(op.x2 - op.x1));
    const h = Math.max(1, Math.abs(op.y2 - op.y1));
    return { x: x, y: y, w: w, h: h };
  }

  function anHitTest(p) {
    for (let i = AN.ops.length - 1; i >= 0; i--) {
      const op = AN.ops[i];
      const tol = Math.max(9, (op.w || 3) * 2.4);
      if (op.type === 'arrow') {
        if (anDistToSeg(p.x, p.y, op.x1, op.y1, op.x2, op.y2) <= tol) return i;
        continue;
      }
      const b = anOpBounds(op);
      if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return i;
    }
    return -1;
  }

  function anDrawSelection(op) {
    if (!op) return;
    const ctx = AN.ctx;
    const b = anOpBounds(op);
    const pad = 7;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = Math.max(1.5, 2 / AN.z);
    ctx.strokeStyle = '#2563eb';
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
    ctx.fillStyle = '#2563eb';
    const s = Math.max(3, 5 / AN.z);
    [[b.x - pad, b.y - pad], [b.x + b.w + pad, b.y - pad],
      [b.x - pad, b.y + b.h + pad], [b.x + b.w + pad, b.y + b.h + pad]].forEach((pt) => {
      ctx.fillRect(pt[0] - s / 2, pt[1] - s / 2, s, s);
    });
    ctx.restore();
  }

  function anRedraw() {
    const ctx = AN.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, AN.canvas.width, AN.canvas.height);
    if (AN.base) ctx.drawImage(AN.base, 0, 0);
    else if (AN.img) ctx.drawImage(AN.img, 0, 0, AN.canvas.width, AN.canvas.height);
    AN.ops.forEach(anDrawOp);
    if (AN.cur) anDrawOp(AN.cur);
    if (AN.sel >= 0 && AN.ops[AN.sel]) anDrawSelection(AN.ops[AN.sel]);
  }

  /* ---------- 缩放 ---------- */

  function anUpdateSize() {
    const c = AN.canvas;
    if (!c) return;
    c.style.width = Math.round(c.width * AN.z) + 'px';
    c.style.height = Math.round(c.height * AN.z) + 'px';
    const el = $('#btn-an-zoom-reset');
    if (el) el.textContent = Math.round(AN.z * 100) + '%';
  }

  function anFit() {
    if (!AN.canvas || !AN.stage || !AN.canvas.width) return;
    const pad = 40;
    const availW = Math.max(80, AN.stage.clientWidth - pad);
    const availH = Math.max(80, AN.stage.clientHeight - pad);
    const z = Math.min(availW / AN.canvas.width, availH / AN.canvas.height, 1);
    AN.fitZ = Math.max(AN_ZOOM_MIN, z);
    AN.z = AN.fitZ;
    anUpdateSize();
    AN.stage.scrollLeft = 0;
    AN.stage.scrollTop = 0;
  }

  function anSetZoom(z, ev) {
    if (!AN.canvas || !AN.img) return;
    const next = Math.max(AN_ZOOM_MIN, Math.min(AN_ZOOM_MAX, z));
    if (Math.abs(next - AN.z) < 0.0008) return;

    const stage = AN.stage;
    const rect = AN.canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();

    let px = 0.5;
    let py = 0.5;
    let ox = stage.clientWidth / 2;
    let oy = stage.clientHeight / 2;
    if (ev && ev.clientX != null) {
      px = Math.min(1, Math.max(0, (ev.clientX - rect.left) / (rect.width || 1)));
      py = Math.min(1, Math.max(0, (ev.clientY - rect.top) / (rect.height || 1)));
      ox = ev.clientX - stageRect.left;
      oy = ev.clientY - stageRect.top;
    }

    AN.z = next;
    anUpdateSize();

    const nx = AN.canvas.offsetLeft + px * AN.canvas.offsetWidth;
    const ny = AN.canvas.offsetTop + py * AN.canvas.offsetHeight;
    stage.scrollLeft = Math.max(0, nx - ox);
    stage.scrollTop = Math.max(0, ny - oy);
  }

  /* ---------- HUD ---------- */

  function anHud(e) {
    if (!AN.hud || !AN.img || !e) return;
    if (AN.hudTimer) return;
    AN.hudTimer = setTimeout(() => {
      AN.hudTimer = 0;
      const p = anPos(e);
      let color = '';
      try {
        const x = Math.max(0, Math.min(AN.canvas.width - 1, Math.round(p.x)));
        const y = Math.max(0, Math.min(AN.canvas.height - 1, Math.round(p.y)));
        const d = AN.ctx.getImageData(x, y, 1, 1).data;
        color = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      } catch (err) { /* ignore */ }
      AN.hud.textContent = Math.round(AN.z * 100) + '%  ·  ' +
        Math.round(p.x) + ', ' + Math.round(p.y) + (color ? '  ·  ' + color : '');
      AN.hud.classList.add('is-on');
    }, 45);
  }

  /* ---------- 画布内联文字输入 ---------- */

  function anInlineText(cx, cy, onDone) {
    const canvas = AN.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + cx * (rect.width / canvas.width);
    const sy = rect.top + cy * (rect.height / canvas.height);

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = '输入文字，回车确认';
    inp.style.cssText = [
      'position:fixed',
      'left:' + sx + 'px',
      'top:' + sy + 'px',
      'transform:translate(0,-50%)',
      'z-index:2147483000',
      'padding:6px 10px',
      'border:2px solid #1f6feb',
      'border-radius:6px',
      'background:#fff',
      'color:#1f2328',
      'font:14px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
      'box-shadow:0 6px 20px rgba(0,0,0,.22)',
      'min-width:190px',
      'outline:none',
    ].join(';');

    document.body.appendChild(inp);
    inp.focus();

    let closed = false;
    const done = (commit) => {
      if (closed) return;
      closed = true;
      const v = inp.value.trim();
      inp.remove();
      if (commit && v) onDone(v);
    };

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    inp.addEventListener('blur', () => done(true));
  }

  /* ---------- 加载 / 处理 ---------- */

  function anLoadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('这张图读不出来')); };
      img.src = url;
    });
  }

  async function anLoadFile(file) {
    try {
      const buf = await file.arrayBuffer();
      AN.srcSha = await anSha256(buf);
    } catch (e) {
      AN.srcSha = '';
    }

    const img = await anLoadImage(file);
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    const scale = Math.min(1, AN_WORK_MAX / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));

    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, w, h);

    AN.img = img;
    AN.src = src;
    AN.ops = [];
    AN.cur = null;
    AN.rounds = 1;
    AN.seed = (Math.random() * 4294967295) >>> 0;
    AN.z = 1;

    AN.canvas.width = w;
    AN.canvas.height = h;
    AN.ctx = AN.canvas.getContext('2d', { willReadFrequently: true });
    AN.canvas.classList.remove('is-hide');
    const emptyEl = $('#an-empty');
    if (emptyEl) emptyEl.style.display = 'none';

    anApply(true);
    anFit();
    anUpdateReport(0);

    WG.toast('已载入 ' + w + '×' + h +
      (scale < 1 ? '（长边压到 ' + AN_WORK_MAX + ' 内，够公众号用）' : ''));
  }

  /* 需要「调色」那一遍吗（不含指纹扰动） */
  function anNeedLook() {
    const L = AN.P.look;
    return L.bri !== 100 || L.con !== 100 || L.sat !== 100 ||
      L.temp !== 0 || L.grain > 0 || L.vig > 0 || (L.glowOn && L.glow > 0);
  }

  function anApply(silent) {
    if (!AN.src || !AN.canvas) return;
    if (AN.busy) { AN.pending = true; return; }
    AN.busy = true;
    const t0 = anNow();

    try {
      const L = AN.P.look;
      let work = anCloneCanvas(AN.src);

      /* 锐化只做一次，重复做会把边缘的振铃放大成噪点 */
      if (L.sharp > 0) anSharpen(work, L.sharp);

      const needLook = anNeedLook();
      const needFp = AN.P.fp.on || AN.P.slice.on;

      if (!needLook && !needFp) {
        AN.rounds = 1;
      } else {
        const rounds = Math.max(1, Math.min(8, AN.rounds | 0));
        AN.rounds = rounds;

        /* 关键：每一轮的扰动幅度 ÷ √rounds
         * 单轮误差 e，叠 n 轮后总误差 ≈ √n · e/√n = e。
         * 所以叠加只换指纹、不降画质；调色也只在第一轮做一次，
         * 不会出现「对比度叠 3 次把高光压死、颗粒叠 3 层糊成一片」。 */
        const k2 = 1 / Math.sqrt(rounds);

        /* 第 1 轮：调色 + 扰动一次到位 */
        anProcess(work, AN.seed | 0, true, { look: needLook, fpScale: k2 });

        /* 第 2..n 轮：只补一层新的种子，不再碰调色 */
        if (needFp) {
          for (let r = 1; r < rounds; r++) {
            anProcess(work, (AN.seed + r * 7919) | 0, false, { look: false, fpScale: k2 });
          }
        }
      }

      if (AN.P.fp.on && AN.P.fp.resample) anResample(work);

      AN.base = work;
      AN.stats.w = work.width;
      AN.stats.h = work.height;
      AN.stats.psnr = anPsnr(AN.src, work);
      AN.stats.stitch = AN.P.slice.on ? anStitchCheck(work, Math.max(2, AN.P.slice.count | 0)) : 0;

      anRedraw();
      anUpdateReport(anNow() - t0);

      if (!silent) {
        const p = AN.stats.psnr;
        WG.toast('处理完成 · 画面差异 ' + (p >= 99 ? '0' : p.toFixed(1)) + ' dB');
      }
    } catch (e) {
      console.error('[WG] 图片处理失败', e);
      WG.toast('处理失败：' + ((e && e.message) || e));
    } finally {
      AN.busy = false;
      if (AN.pending) {
        AN.pending = false;
        setTimeout(() => anApply(true), 40);
      }
    }
  }

  function anSetText(id, txt, cls) {
    const el = $(id);
    if (!el) return;
    el.textContent = txt;
    el.className = cls || '';
  }

  function anUpdateReport(ms) {
    const S = AN.stats;
    anSetText('#fp-size', S.w && S.h ? S.w + ' × ' + S.h : '—');

    if (S.psnr) {
      const p = S.psnr;
      const txt = p >= 99 ? '完全一致' : p.toFixed(1) + ' dB';
      anSetText('#fp-psnr', txt, p >= 40 || p >= 99 ? 'is-good' : (p >= 34 ? '' : 'is-warn'));
    }

    anSetText('#fp-sha-before', AN.srcSha ? AN.srcSha.slice(0, 14) + '…' : '—');
    anSetText('#fp-rounds', AN.rounds + ' 次' + (ms ? ' · ' + Math.round(ms) + ' ms' : ''));
    anSetText('#fp-seed', 'seed ' + (AN.seed >>> 0).toString(36).toUpperCase());

    if (AN.P.slice.on) {
      const st = S.stitch;
      anSetText('#sl-stitch', st ? '×' + st.toFixed(2) + (st <= 1.4 ? ' 无可见缝' : ' 过渡偏硬') : '—',
        st && st <= 1.4 ? 'is-good' : 'is-warn');
      const blocks = AN.P.slice.mode === 'grid' ? 2 * (AN.P.slice.count | 0) : (AN.P.slice.count | 0);
      anSetText('#sl-blocks', blocks + ' 块 · 过渡 ' + AN.P.slice.feather + '%');
    }

    const rl = $('#sl-rounds');
    if (rl) rl.textContent = '已处理 ' + AN.rounds + ' 次';
    const undo = $('#btn-sl-undo');
    if (undo) {
      const canUndo = !!AN.img && AN.rounds > 1;
      undo.disabled = !canUndo;
      undo.classList.toggle('is-off', !canUndo);
    }
  }

  /* ---------- 导出 ---------- */

  function anDateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  async function anExport(fmt) {
    if (!AN.img || !AN.base) { WG.toast('先选一张图'); return; }

    let source = AN.canvas;
    if (fmt === 'jpg') {
      /* JPEG 没有透明通道，先压一层白底，避免透明区变黑 */
      const flat = document.createElement('canvas');
      flat.width = AN.canvas.width;
      flat.height = AN.canvas.height;
      const fc = flat.getContext('2d');
      fc.fillStyle = '#ffffff';
      fc.fillRect(0, 0, flat.width, flat.height);
      fc.drawImage(AN.canvas, 0, 0);
      source = flat;
    }

    const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((res) => source.toBlob(res, type, 0.94));
    if (!blob) { WG.toast('导出失败，再点一次'); return; }

    let buf = await blob.arrayBuffer();

    if (fmt !== 'jpg' && AN.P.fp.on && AN.P.fp.recode) {
      buf = anInjectPngText(buf, [
        ['Software', 'Writer Guard · 截图标注'],
        ['Creation Time', new Date().toISOString()],
        ['Seed', String(AN.seed >>> 0)],
        ['Passes', String(AN.rounds)],
        ['Writer', 'own screenshot, annotated by author'],
      ]);
    }

    const sha = await anSha256(buf);
    if (sha) anSetText('#fp-sha-after', sha.slice(0, 14) + '…', 'is-good');

    const out = new Blob([buf], { type });
    const name = 'shot-' + anDateStamp() + '-s' + (AN.seed >>> 0).toString(36) +
      (fmt === 'jpg' ? '.jpg' : '.png');

    const url = URL.createObjectURL(out);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    WG.toast('已导出 ' + name + ' · ' + Math.round(buf.byteLength / 1024) + ' KB');
  }

  /* ---------- UI 同步 ---------- */

  function anNum(id, dft) {
    const el = $(id);
    if (!el) return dft;
    const v = Number(el.value);
    return Number.isFinite(v) ? v : dft;
  }

  function anChk(id, dft) {
    const el = $(id);
    return el ? !!el.checked : dft;
  }

  function anReadUI() {
    const P = AN.P;
    P.fp.on = anChk('#fp-on', P.fp.on);
    P.fp.recode = anChk('#fp-m-recode', P.fp.recode);
    P.fp.noise = anChk('#fp-m-noise', P.fp.noise);
    P.fp.block = anChk('#fp-m-block', P.fp.block);
    P.fp.resample = anChk('#fp-m-resample', P.fp.resample);

    const L = P.look;
    L.bri = anNum('#lk-bri', 100);
    L.con = anNum('#lk-con', 100);
    L.sat = anNum('#lk-sat', 100);
    L.temp = anNum('#lk-temp', 0);
    L.sharp = anNum('#lk-sharp', 0);
    L.grain = anNum('#lk-grain', 0);
    L.vig = anNum('#lk-vig', 0);
    L.glowOn = anChk('#lk-glow-on', false);
    L.glow = anNum('#lk-glow', 35);
    L.glowSize = anNum('#lk-glow-size', 80);
    L.glowX = anNum('#lk-glow-x', 50);
    L.glowY = anNum('#lk-glow-y', 35);
    const gc = $('#lk-glow-color');
    if (gc) L.glowColor = gc.value;

    P.slice.on = anChk('#sl-on', false);
    P.slice.count = anNum('#sl-count', 4);
    P.slice.feather = anNum('#sl-feather', 60);

    anSyncValues();
  }

  function anSyncValues() {
    const L = AN.P.look;
    const pairs = [
      ['#lk-bri-v', L.bri], ['#lk-con-v', L.con], ['#lk-sat-v', L.sat], ['#lk-temp-v', L.temp],
      ['#lk-sharp-v', L.sharp], ['#lk-grain-v', L.grain], ['#lk-vig-v', L.vig],
      ['#lk-glow-v', L.glow], ['#lk-glow-size-v', L.glowSize],
      ['#sl-count-v', AN.P.slice.count], ['#sl-feather-v', AN.P.slice.feather],
    ];
    pairs.forEach((p) => {
      const el = $(p[0]);
      if (el) el.textContent = p[1];
    });
  }

  function anWriteUI() {
    const L = AN.P.look;
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    set('#lk-bri', L.bri); set('#lk-con', L.con); set('#lk-sat', L.sat);
    set('#lk-temp', L.temp); set('#lk-sharp', L.sharp); set('#lk-grain', L.grain);
    set('#lk-vig', L.vig); set('#lk-glow', L.glow); set('#lk-glow-size', L.glowSize);
    set('#lk-glow-x', L.glowX); set('#lk-glow-y', L.glowY);
    set('#lk-glow-color', L.glowColor);
    chk('#lk-glow-on', L.glowOn);
    anSyncValues();
  }

  function anChanged(delay) {
    clearTimeout(AN.timer);
    AN.timer = setTimeout(() => {
      anReadUI();
      anApply(true);
    }, delay == null ? 220 : delay);
  }

  /* ---------- 初始化 ---------- */

  function initAnnotate() {
    AN.canvas = $('#an-canvas');
    if (!AN.canvas) return;
    AN.stage = $('#an-stage');
    AN.hud = $('#an-hud');

    const file = $('#an-file');
    const btnOpen = $('#btn-an-open');
    if (btnOpen && file) {
      btnOpen.addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        if (file.files && file.files[0]) {
          anLoadFile(file.files[0]).catch((e) => WG.toast(String((e && e.message) || e)));
        }
        file.value = '';
      });
    }

    /* 拖一张图进来也能用 */
    if (AN.stage) {
      AN.stage.addEventListener('dragover', (e) => { e.preventDefault(); });
      AN.stage.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        e.preventDefault();
        anLoadFile(f).catch((err) => WG.toast(String((err && err.message) || err)));
      });
    }

    /* 工具切换 */
    $$('.tool-btn').forEach((b) => {
      b.addEventListener('click', () => {
        $$('.tool-btn').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        AN.tool = b.dataset.tool;
        AN.sel = -1;
        AN.canvas.style.cursor = AN.tool === 'select' ? 'move' : 'crosshair';
        anRedraw();
      });
    });

    const colorEl = $('#an-color');
    if (colorEl) colorEl.addEventListener('input', (e) => { AN.color = e.target.value; });
    const widthEl = $('#an-width');
    if (widthEl) widthEl.addEventListener('input', (e) => { AN.width = Number(e.target.value) || 3; });

    const c = AN.canvas;

    /* 滚轮：以指针为锚点放大，看细节不跑位 */
    c.addEventListener('wheel', (e) => {
      if (!AN.img) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.18 : 1.18;
      anSetZoom(AN.z * factor, e);
      anHud(e);
    }, { passive: false });

    /* 中键 / 右键 / 空格 = 平移 */
    function startPan(e) {
      if (!AN.stage) return;
      AN.pan = { x: e.clientX, y: e.clientY, l: AN.stage.scrollLeft, t: AN.stage.scrollTop };
      AN.stage.classList.add('is-panning');
    }

    c.addEventListener('mousedown', (e) => {
      if (!AN.img) return;
      if (e.button === 1 || e.button === 2 || AN.space) {
        e.preventDefault();
        startPan(e);
        return;
      }
      if (e.button !== 0) return;

      const p = anPos(e);

      /* 移动工具（或 Alt+拖动）：抓着已画的图形挪位置 */
      if (AN.tool === 'select' || e.altKey) {
        const idx = anHitTest(p);
        if (idx >= 0) {
          const op = AN.ops[idx];
          AN.sel = idx;
          AN.move = { idx: idx, ox: p.x, oy: p.y, x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 };
          AN.dragMoved = false;
          anRedraw();
          return;
        }
        if (AN.tool === 'select') {
          AN.sel = -1;
          anRedraw();
          return;
        }
      }

      if (AN.tool === 'text') {
        anInlineText(p.x, p.y, (txt) => {
          AN.ops.push({ type: 'text', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: AN.color, w: AN.width, text: txt });
          anRedraw();
        });
        return;
      }

      AN.drawing = true;
      AN.cur = {
        type: AN.tool === 'mosaic' ? 'mosaic' : AN.tool,
        x1: p.x, y1: p.y, x2: p.x, y2: p.y,
        color: AN.color, w: AN.width,
      };
    });

    c.addEventListener('contextmenu', (e) => { if (AN.img) e.preventDefault(); });

    c.addEventListener('mousemove', (e) => {
      if (!AN.img) return;
      anHud(e);

      if (AN.move) {
        const op = AN.ops[AN.move.idx];
        if (!op) return;
        const p = anPos(e);
        const dx = p.x - AN.move.ox;
        const dy = p.y - AN.move.oy;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) AN.dragMoved = true;
        op.x1 = AN.move.x1 + dx;
        op.y1 = AN.move.y1 + dy;
        op.x2 = AN.move.x2 + dx;
        op.y2 = AN.move.y2 + dy;
        anRedraw();
        return;
      }

      if (!AN.drawing || !AN.cur) return;
      const p2 = anPos(e);
      AN.cur.x2 = p2.x;
      AN.cur.y2 = p2.y;
      anRedraw();
    });

    c.addEventListener('mouseleave', () => {
      if (AN.hud) AN.hud.classList.remove('is-on');
      if (!AN.drawing || !AN.cur) return;
      AN.drawing = false;
      const op = AN.cur;
      AN.cur = null;
      if (Math.abs(op.x2 - op.x1) > 3 || Math.abs(op.y2 - op.y1) > 3) AN.ops.push(op);
      anRedraw();
    });

    function finishStroke() {
      if (AN.move) { AN.move = null; return; }
      if (!AN.drawing || !AN.cur) return;
      AN.drawing = false;
      const op = AN.cur;
      AN.cur = null;
      if (Math.abs(op.x2 - op.x1) > 3 || Math.abs(op.y2 - op.y1) > 3) AN.ops.push(op);
      AN.sel = -1;
      anRedraw();
    }
    c.addEventListener('mouseup', finishStroke);

    /* 平移与结束：挂在 document 上，拖出画布也不断 */
    document.addEventListener('mousemove', (e) => {
      if (!AN.pan) return;
      if (AN.stage) {
        AN.stage.scrollLeft = AN.pan.l - (e.clientX - AN.pan.x);
        AN.stage.scrollTop = AN.pan.t - (e.clientY - AN.pan.y);
      }
    });
    document.addEventListener('mouseup', () => {
      if (AN.move) { AN.move = null; AN.dragMoved = false; }
      if (!AN.pan) return;
      AN.pan = null;
      if (AN.stage) AN.stage.classList.remove('is-panning');
    });

    /* 双击：100% ↔ 适配 */
    c.addEventListener('dblclick', (e) => {
      if (!AN.img) return;
      const near = Math.abs(AN.z - 1) < 0.02;
      anSetZoom(near ? AN.fitZ : 1, e);
      if (near) { AN.stage.scrollLeft = 0; AN.stage.scrollTop = 0; }
    });

    /* 空格临时变抓手 */
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (!AN.stage || !AN.stage.offsetParent) return;
      AN.space = true;
      AN.stage.classList.add('is-pan');
      e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      AN.space = false;
      if (AN.stage) AN.stage.classList.remove('is-pan');
    });

    /* 选中图形后：Delete 删除，方向键微调（Shift 一次 10px） */
    document.addEventListener('keydown', (e) => {
      if (!AN.img || AN.sel < 0 || !AN.ops[AN.sel]) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (!AN.stage || !AN.stage.offsetParent) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        AN.ops.splice(AN.sel, 1);
        AN.sel = -1;
        anRedraw();
        WG.toast('已删除选中的标注');
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const dm = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
        ArrowUp: [0, -step], ArrowDown: [0, step],
      }[e.key];
      if (!dm) return;
      e.preventDefault();
      const op = AN.ops[AN.sel];
      op.x1 += dm[0]; op.y1 += dm[1];
      op.x2 += dm[0]; op.y2 += dm[1];
      anRedraw();
    });

    /* 缩放按钮 */
    const zOut = $('#btn-an-zoom-out');
    if (zOut) zOut.addEventListener('click', () => anSetZoom(AN.z / 1.25));
    const zIn = $('#btn-an-zoom-in');
    if (zIn) zIn.addEventListener('click', () => anSetZoom(AN.z * 1.25));
    const zReset = $('#btn-an-zoom-reset');
    if (zReset) zReset.addEventListener('click', () => { anSetZoom(1); AN.stage.scrollLeft = 0; AN.stage.scrollTop = 0; });
    const zFit = $('#btn-an-fit');
    if (zFit) zFit.addEventListener('click', () => anFit());

    /* 标注撤销 / 清空 */
    const undoBtn = $('#btn-an-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => { AN.ops.pop(); anRedraw(); });
    const clearBtn = $('#btn-an-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => { AN.ops = []; AN.cur = null; anRedraw(); });

    /* 导出 */
    const savePng = $('#btn-an-save');
    if (savePng) savePng.addEventListener('click', () => anExport('png'));
    const saveJpg = $('#btn-an-save-jpg');
    if (saveJpg) saveJpg.addEventListener('click', () => anExport('jpg'));

    /* 侧栏 tabs */
    $$('.an-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.an-tab').forEach((t) => t.classList.remove('is-on'));
        tab.classList.add('is-on');
        $$('.an-pane').forEach((p) => p.classList.toggle('is-hide', p.dataset.pane !== tab.dataset.tab));
      });
    });

    /* 指纹 */
    $$('#fp-strength button').forEach((b) => {
      b.addEventListener('click', () => {
        $$('#fp-strength button').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        AN.P.fp.strength = b.dataset.v;
        anChanged(0);
      });
    });

    const fpOn = $('#fp-on');
    if (fpOn) fpOn.addEventListener('change', () => anChanged(0));
    ['#fp-m-recode', '#fp-m-noise', '#fp-m-block', '#fp-m-resample'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('change', () => anChanged(0));
    });

    const fpApply = $('#btn-fp-apply');
    if (fpApply) fpApply.addEventListener('click', () => {
      if (!AN.src) { WG.toast('先选一张图'); return; }
      anReadUI();
      anApply(false);
    });

    const fpSeed = $('#btn-fp-seed');
    if (fpSeed) fpSeed.addEventListener('click', () => {
      AN.seed = (Math.random() * 4294967295) >>> 0;
      AN.rounds = 1;
      anApply(true);
      WG.toast('换了一组新指纹');
    });

    /* 光效滑条 */
    const lookIds = ['#lk-bri', '#lk-con', '#lk-sat', '#lk-temp', '#lk-sharp', '#lk-grain',
      '#lk-vig', '#lk-glow', '#lk-glow-size', '#lk-glow-x', '#lk-glow-y'];
    lookIds.forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('input', () => { anSyncValues(); anChanged(240); });
    });
    const glowOn = $('#lk-glow-on');
    if (glowOn) glowOn.addEventListener('change', () => anChanged(0));
    const glowColor = $('#lk-glow-color');
    if (glowColor) glowColor.addEventListener('input', () => anChanged(120));

    $$('[data-look-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = AN_LOOK_PRESET[b.dataset.lookPreset];
        if (!preset) return;
        Object.keys(preset).forEach((k) => { AN.P.look[k] = preset[k]; });
        anWriteUI();
        anApply(true);
      });
    });

    /* 分块 */
    const slOn = $('#sl-on');
    if (slOn) slOn.addEventListener('change', () => {
      anReadUI();
      if (AN.P.slice.on && !AN.P.fp.on) {
        const el = $('#fp-on');
        if (el) { el.checked = true; AN.P.fp.on = true; }
      }
      anApply(true);
    });

    $$('#sl-mode button').forEach((b) => {
      b.addEventListener('click', () => {
        $$('#sl-mode button').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        AN.P.slice.mode = b.dataset.v;
        anChanged(0);
      });
    });

    ['#sl-count', '#sl-feather'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('input', () => { anSyncValues(); anChanged(260); });
    });

    const slAdd = $('#btn-sl-add');
    if (slAdd) slAdd.addEventListener('click', () => {
      if (!AN.src) { WG.toast('先选一张图'); return; }
      if (AN.rounds >= 8) { WG.toast('已经叠了 8 次，再多收益也不大了'); return; }
      AN.rounds += 1;
      if (!AN.P.slice.on) {
        AN.P.slice.on = true;
        const el = $('#sl-on');
        if (el) el.checked = true;
      }
      const fpEl = $('#fp-on');
      if (fpEl) { fpEl.checked = true; AN.P.fp.on = true; }
      anApply(true);
      WG.toast('已叠加到 ' + AN.rounds + ' 次 · 画质不衰减，只是换了一套指纹');
    });

    /* 返回上一次：撤掉最近一轮叠加 */
    const slUndo = $('#btn-sl-undo');
    if (slUndo) slUndo.addEventListener('click', () => {
      if (!AN.src) { WG.toast('先选一张图'); return; }
      if (AN.rounds <= 1) { WG.toast('已经是第一遍了，没有更早的可退'); return; }
      AN.rounds -= 1;
      anApply(true);
      WG.toast('已退回上一次 · 现在是 ' + AN.rounds + ' 次处理');
    });

    /* 切回本页时重算一次尺寸（视图从隐藏变可见时宽度是 0） */
    const nav = document.querySelector('.nav-item[data-view="annotate"]');
    if (nav) {
      nav.addEventListener('click', () => {
        setTimeout(() => { if (AN.img) anFit(); }, 90);
      });
    }
    root.addEventListener('resize', () => {
      if (AN.img && AN.stage && AN.stage.offsetParent) anFit();
    });

    anReadUI();
    anUpdateReport(0);
  }

  /* ============================================================
   * 三、多平台改写
   * ============================================================ */

  const EMOJI_POOL = ['📌', '🔧', '⚡', '💡', '✅', '⚠️', '🔍', '📝'];

  function extractKeywords(text, n) {
    const stop = new Set([
      '这个', '那个', '我们', '你们', '他们', '可以', '一个', '什么', '怎么',
      '就是', '但是', '因为', '所以', '如果', '而且', '或者', '还是', '已经',
      '没有', '不是', '这样', '那样', '自己', '现在', '时候', '问题', '东西',
      '使用', '进行', '通过', '非常', '比较', '一些', '这些', '那些', '这里',
      '那里', '因为', '不过', '然后', '其实', '真的', '感觉', '觉得', '需要',
    ]);
    const clean = String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
    const freq = {};
    for (const seg of clean.split(/\s+/)) {
      if (!seg) continue;
      for (let len = 2; len <= 4; len++) {
        for (let i = 0; i + len <= seg.length; i++) {
          const w = seg.slice(i, i + len);
          if (stop.has(w)) continue;
          if (/^\d+$/.test(w)) continue;
          freq[w] = (freq[w] || 0) + 1;
        }
      }
    }
    return Object.entries(freq)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map((x) => x[0]);
  }

  function splitParas(text) {
    return String(text || '')
      .split(/\n+/)
      .map((s) => s.replace(/^[#>*\-\s]+/, '').trim())
      .filter((s) => s.length > 0);
  }

  function toXiaohongshu(text) {
    const paras = splitParas(text).slice(0, 12);
    const kws = extractKeywords(text, 5);
    const lines = [];
    paras.forEach((p, i) => {
      const short = p.length > 62 ? p.slice(0, 60) + '…' : p;
      lines.push(`${EMOJI_POOL[i % EMOJI_POOL.length]} ${short}`);
    });
    const tags = kws.map((k) => '#' + k).join(' ');
    return lines.join('\n\n') + '\n\n' + tags;
  }

  function toZhihu(text) {
    const paras = splitParas(text);
    const out = [];
    out.push('**结论先说：** ' + (paras[0] || '').slice(0, 60));
    out.push('');
    paras.slice(0, 14).forEach((p, i) => {
      if (i === 0) { out.push(p); return; }
      out.push(p.length > 120 ? '**' + p.slice(0, 18) + '**' + p.slice(18) : p);
      out.push('');
    });
    out.push('---');
    out.push('以上为个人实测记录，测试环境与版本见文中说明。');
    return out.join('\n');
  }

  function toBili(text) {
    const paras = splitParas(text).slice(0, 8);
    const shots = [];
    shots.push('【分镜 1｜0-5s｜钩子】');
    shots.push('画面：软件界面首页特写');
    shots.push('口播：' + (paras[0] || '先说结论').slice(0, 52));
    shots.push('');

    paras.slice(1).forEach((p, i) => {
      const start = 5 + i * 18;
      shots.push(`【分镜 ${i + 2}｜${start}-${start + 18}s｜演示】`);
      shots.push('画面：实际操作录屏，重点区域加箭头标注');
      shots.push('口播：' + p.slice(0, 60));
      shots.push('');
    });

    shots.push('【分镜｜结尾】');
    shots.push('画面：对比表特写');
    shots.push('口播：一句总结 + 一句下期预告');
    return shots.join('\n');
  }

  function toDouyin(text) {
    const paras = splitParas(text);
    const head = (paras[0] || '').slice(0, 44);
    const mid = (paras[1] || paras[0] || '').slice(0, 48);
    const tail = (paras[paras.length - 1] || '').slice(0, 40);
    return [
      '【前 3 秒｜结果前置】',
      head,
      '',
      '【中段｜一个核心动作】',
      mid,
      '',
      '【结尾｜行动指令】',
      tail || '想要清单的评论区说一声。',
      '',
      '（约 ' + (head + mid + tail).length + ' 字，正常语速 30 秒内）',
    ].join('\n');
  }

  function renderPlatformRules() {
    const box = $('#mp-rules');
    if (!box) return;
    const DICT = root.WG_DICT || {};
    const styles = DICT.platformStyle || {};
    box.innerHTML = Object.entries(styles).map(([key, s]) => `
      <div class="tpl" style="margin-bottom:10px">
        <div class="tpl-head"><b>${esc(s.name)}</b></div>
        <div class="para" style="font-size:12px">
          ${s.rules.map((r, i) => `<p style="margin:0 0 5px">${i + 1}. ${esc(r)}</p>`).join('')}
        </div>
      </div>
    `).join('');
  }

  function initMultiplatform() {
    renderPlatformRules();

    const btn = $('#btn-mp-gen');
    if (!btn) return;

    let result = null;

    btn.addEventListener('click', () => {
      const text = $('#mp-input').value || '';
      if (text.trim().length < 60) {
        WG.toast('正文太短，先在检测台把稿件贴全');
        return;
      }

      result = {
        xhs: toXiaohongshu(text),
        zhihu: toZhihu(text),
        bili: toBili(text),
        douyin: toDouyin(text),
      };

      const names = { xhs: '小红书', zhihu: '知乎', bili: 'B站', douyin: '抖音' };
      $('#mp-result').innerHTML = Object.entries(result).map(([k, v]) => `
        <div class="tpl" style="margin-bottom:12px">
          <div class="tpl-head">
            <b>${names[k]}</b>
            <div class="card-actions">
              <span class="pill">${v.replace(/\s/g, '').length} 字</span>
              <button class="btn btn-sm" data-mp-copy="${k}">复制</button>
            </div>
          </div>
          <pre class="tpl-body">${esc(v)}</pre>
        </div>
      `).join('');

      WG.toast('四平台版本已生成');
    });

    document.addEventListener('click', (e) => {
      const btnCopy = e.target.closest('[data-mp-copy]');
      if (!btnCopy || !result) return;
      const k = btnCopy.dataset.mpCopy;
      if (result[k]) WG.copy(result[k]);
    });
  }

  /* ---------- 对外 ---------- */

  WG.initTemplates = initTemplates;
  WG.initAnnotate = initAnnotate;
  WG.initMultiplatform = initMultiplatform;

  /* 给测试与外部脚本用（也方便在控制台复查参数） */
  WG.annotate = {
    state: AN,
    loadFile: anLoadFile,
    apply: anApply,
    export: anExport,
    setZoom: anSetZoom,
    fit: anFit,
    injectPngText: anInjectPngText,
    psnr: anPsnr,
    stitchCheck: anStitchCheck,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
