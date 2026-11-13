/* ============================================================
 * Writer Guard · 检测引擎（工作台侧）
 * 与注入脚本共享同一套词库，逻辑保持一致。
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG || (root.WG = {});
  const DICT = root.WG_DICT || {};

  function makeGlobalRe(re) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    return new RegExp(re.source, flags);
  }

  function contextAround(text, index, len) {
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + len + 20);
    return (start > 0 ? '…' : '') +
      text.slice(start, end).replace(/\s+/g, ' ') +
      (end < text.length ? '…' : '');
  }

  /* ---------- 红线扫描 ---------- */

  function scanRedline(text, categories) {
    const hits = [];
    if (!text) return hits;
    const rules = (typeof DICT.getRules === 'function')
      ? DICT.getRules(categories)
      : (DICT.redline || []);
    for (const group of rules) {
      for (const raw of group.patterns) {
        // 兼容两种写法：裸正则，或 { re, to } 带替换词
        const pat = (raw instanceof RegExp) ? { re: raw, to: '' } : raw;
        const re = makeGlobalRe(pat.re);
        let m;
        let guard = 0;
        while ((m = re.exec(text)) !== null) {
          hits.push({
            groupId: group.id,
            groupName: group.name,
            category: group.category || 'common',
            level: group.level,
            why: group.why,
            suggest: group.suggest,
            word: m[0],
            swap: pat.to || '',
            index: m.index,
            context: contextAround(text, m.index, m[0].length),
          });
          if (++guard > 300) break;
          if (m[0].length === 0) re.lastIndex++;
        }
      }
    }
    hits.sort((a, b) => a.index - b.index);
    return hits;
  }

  /* ---------- AI 痕迹扫描 ---------- */

  function splitSentences(text) {
    return (text || '').split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  function stddev(nums) {
    if (nums.length < 2) return 0;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const v = nums.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / nums.length;
    return Math.sqrt(v);
  }

  function scanAITrace(text) {
    const groups = [];
    let totalHits = 0;

    for (const group of DICT.aiTrace || []) {
      const words = [];
      for (const raw of group.patterns) {
        const re = makeGlobalRe(raw);
        let m;
        let guard = 0;
        while ((m = re.exec(text)) !== null) {
          words.push(m[0]);
          if (++guard > 200) break;
          if (m[0].length === 0) re.lastIndex++;
        }
      }
      if (words.length) {
        totalHits += words.length;
        groups.push({
          id: group.id,
          name: group.name,
          why: group.why,
          fix: group.fix,
          count: words.length,
          words: Array.from(new Set(words)).slice(0, 14),
        });
      }
    }

    const sentences = splitSentences(text);
    const lens = sentences.map((s) => s.length).filter((n) => n > 0);
    const sStd = stddev(lens);
    const sAvg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;

    const paras = (text || '').split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
    const pLens = paras.map((p) => p.length);
    const pStd = stddev(pLens);
    const pAvg = pLens.length ? pLens.reduce((a, b) => a + b, 0) / pLens.length : 0;

    const charCount = (text || '').replace(/\s/g, '').length || 1;
    const density = (totalHits / charCount) * 1000;

    let score = 0;

    // ① 词密度。短文本用绝对命中数，避免小样本被密度放大。
    if (charCount < 220) {
      score += Math.min(45, totalHits * 5);
    } else {
      score += Math.min(45, density * 5);
    }

    // ② 句长均匀度。只有「中长句且长度趋同」才是 AI 信号；
    //    真人写短句流时 σ 也小，那是风格，不是机器味。
    if (sAvg >= 18 && sStd > 0 && sStd < 12) score += 20;
    else if (sAvg >= 18 && sStd < 18) score += 10;

    // ③ 段落均匀度。同样要段落本身够长才算数。
    if (pAvg >= 40 && pStd > 0 && pStd < 30) score += 15;
    else if (pAvg >= 40 && pStd < 50) score += 6;

    score = Math.round(Math.min(100, Math.max(0, score)));

    return {
      groups: groups.sort((a, b) => b.count - a.count),
      totalHits,
      density: Number(density.toFixed(2)),
      sentenceStd: Number(sStd.toFixed(1)),
      sentenceAvg: Number(sAvg.toFixed(1)),
      paragraphStd: Number(pStd.toFixed(1)),
      paragraphAvg: Number(pAvg.toFixed(1)),
      sentenceCount: lens.length,
      charCount,
      score,
      verdict: score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low',
    };
  }

  /* ---------- 发布评分 ---------- */

  function buildScore(title, body, redline, ai) {
    const full = (title || '') + '\n' + (body || '');
    const blocked = redline.filter((h) => h.level === 'block');
    const titleClickbait = redline.some(
      (h) => h.groupId === 'clickbait' && h.index < (title || '').length + 1
    );
    const tail = (body || '').trim().slice(-220);

    const checks = [
      {
        id: 'title',
        name: '标题无夸张词',
        pass: !titleClickbait,
        score: 12,
        block: true,
        fix: '删掉震惊/必看/永久免费这类词，换成场景 + 具体结果',
      },
      {
        id: 'redline',
        name: '正文无必删级红线词',
        pass: blocked.length === 0,
        score: 20,
        block: true,
        fix: '破解/网盘/诱导这类必须清掉，一条就够删文',
      },
      {
        id: 'ai',
        name: 'AI 痕迹低于阈值',
        pass: ai.score < 40,
        score: 15,
        block: true,
        fix: '删连接词、换掉黑话、打乱句长，把 AI 度压到 40 以下',
      },
      {
        id: 'netdisk',
        name: '无网盘 / 外链导流',
        pass: !redline.some((h) => h.groupId === 'netdisk' || h.groupId === 'external'),
        score: 10,
        block: true,
        fix: '下载引导指向官网或应用商店',
      },
      {
        id: 'env',
        name: '含测试环境说明段',
        pass: /测试环境|设备[:：]|版本[:：]|实测/.test(full),
        score: 10,
        block: false,
        fix: '模板库里有现成的测试环境段，粘一段进去',
      },
      {
        id: 'license',
        name: '配图有授权记录',
        pass: true,
        score: 10,
        block: false,
        computed: true,
        fix: '去素材台账核对本文配图是否都登记过',
      },
      {
        id: 'negative',
        name: '含「不适合谁」反向结论',
        pass: /不适合|不推荐|劝退|慎用|别装|别买/.test(full),
        score: 8,
        block: false,
        fix: '加一段反向结论，可信度和完读率都会涨',
      },
      {
        id: 'ask',
        name: '文末有具体提问',
        pass: /[？?]\s*$/.test(tail) || /留言|说说你|你的场景/.test(tail),
        score: 7,
        block: false,
        fix: '文末抛一个具体问题，不要写点赞在看转发',
      },
    ];

    const total = checks.reduce((s, c) => s + (c.pass ? c.score : 0), 0);
    const max = checks.reduce((s, c) => s + c.score, 0);

    return {
      checks,
      total,
      max,
      percent: Math.round((total / max) * 100),
      blockedNow: checks.some((c) => c.block && !c.pass),
    };
  }

  /* ---------- 标题改写 ---------- */

  /* 兼容两种写法：裸正则，或 { re, to } 带替换词 */
  function patternOf(raw) {
    return (raw instanceof RegExp) ? { re: raw, to: '' } : raw;
  }

  /* 从替换词里剥掉「（删除）」这类指令，只留真正要换成的文字 */
  function swapWord(to) {
    return String(to || '').replace(/（[^）]*）/g, '').trim();
  }

  /* 标题要清理的组：夸张词 + 广告法绝对化用语 */
  const TITLE_GROUPS = ['clickbait', 'adlaw'];

  function stripClickbait(title) {
    let t = title || '';
    TITLE_GROUPS.forEach((gid) => {
      const g = (DICT.redline || []).find((x) => x.id === gid);
      if (!g) return;
      for (const raw of g.patterns) {
        const pat = patternOf(raw);
        // 有具体替换词就换词，只是「删除」指令就清掉
        t = t.replace(makeGlobalRe(pat.re), swapWord(pat.to));
      }
    });
    t = t.replace(/[！!？?。，,、~～…\s]+/g, ' ').trim();
    return t;
  }

  function detectTitleIssues(title) {
    const issues = [];
    const t = title || '';
    TITLE_GROUPS.forEach((gid) => {
      const g = (DICT.redline || []).find((x) => x.id === gid);
      if (!g) return;
      for (const raw of g.patterns) {
        const pat = patternOf(raw);
        const re = makeGlobalRe(pat.re);
        const sw = swapWord(pat.to);
        const fix = pat.to ? (sw ? '换成「' + sw + '」' : '直接删掉') : '删掉或换成限定表述';
        let m;
        while ((m = re.exec(t)) !== null) {
          issues.push({
            word: m[0],
            kind: gid === 'adlaw' ? '绝对化用语' : '夸张词',
            level: 'warn',
            fix,
          });
          if (m[0].length === 0) re.lastIndex++;
        }
      }
    });
    if (/[！!]/.test(t)) issues.push({ word: '感叹号', kind: '情绪符号', level: 'tip', fix: '标题一个感叹号都不要用' });
    if (t.length > 30) issues.push({ word: t.length + ' 字', kind: '过长', level: 'warn', fix: '压到 16–26 字' });
    if (t.length > 0 && t.length < 8) issues.push({ word: t.length + ' 字', kind: '过短', level: 'tip', fix: '信息量不够，点击率低' });
    if (!/\d/.test(t)) issues.push({ word: '无数字', kind: '缺具体度', level: 'tip', fix: '加一个具体数字，可信度立刻上升' });
    return issues;
  }

  function rewriteTitle(title) {
    const core = stripClickbait(title);
    const words = core.split(/\s+/).filter(Boolean);
    const subject = words[0] || core || '这个工具';
    const rest = words.slice(1).join(' ') || '';
    const short = subject.length > 12 ? subject.slice(0, 12) : subject;

    const candidates = [];

    candidates.push({
      text: '实测：' + short + (rest ? rest.slice(0, 14) : '') + '，免费版能覆盖多少日常需求',
      note: '把绝对化结论换成限定结论，信息型标题',
    });

    candidates.push({
      text: '在' + (rest || '文档整理') + '这件事上，我把' + short + '换成了主力',
      note: '场景 + 第一人称，点击率和完读率都更稳',
    });

    candidates.push({
      text: short + '能不能' + (rest || '解决这个问题') + '？我测了 3 天',
      note: '问句 + 时间成本，天然带悬念',
    });

    candidates.push({
      text: '别看' + short + '宣传页，先看这三个限制',
      note: '反向立论，避开标题党同时抓住好奇心',
    });

    candidates.push({
      text: (rest || '效率工具') + '换了 6 个，只有' + short + '让我留下来了',
      note: '失败前置，真人感最强的一种写法',
    });

    candidates.push({
      text: short + '用了两周，说三个它做不到的事',
      note: '时间 + 反向结论，可信度最高',
    });

    return candidates.filter((c) => c.text.length >= 10 && c.text.length <= 34);
  }

  /* ---------- 字体检测 ---------- */

  function checkFonts(input) {
    const names = String(input || '')
      .split(/[\n,，;；、]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const allow = (DICT.fonts && DICT.fonts.allow) || [];
    const deny = (DICT.fonts && DICT.fonts.deny) || [];

    return names.map((name) => {
      const lower = name.toLowerCase();
      // 先查白名单：否则「思源黑体」会被黑名单里的「黑体」子串误伤
      const hitAllow = allow.find((a) => lower.includes(a.toLowerCase()));
      const hitDeny = deny.find((d) => lower.includes(d.toLowerCase()));
      let status = 'unknown';
      if (hitAllow) status = 'allow';
      else if (hitDeny) status = 'deny';
      return { name, status, matched: hitAllow || hitDeny || '' };
    });
  }

  /* ---------- 对外 ---------- */

  WG.Engine = {
    scanRedline,
    scanAITrace,
    buildScore,
    rewriteTitle,
    detectTitleIssues,
    stripClickbait,
    checkFonts,
    splitSentences,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
