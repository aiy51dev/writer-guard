/* ============================================================
 * Writer Guard · 降 AI 味改写引擎
 *
 * 纯规则改写，不依赖任何模型/API。针对平台实际识别的五类特征：
 *   连接词骨架 / 空洞开场 / 黑话 / 模板句式 / 修饰词堆砌
 *
 * 设计原则：只做「高置信度、不会改坏语义」的替换。
 * 句式重构交给模型，这里不做——规则硬拆句子只会更别扭。
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG || (root.WG = {});

  /* ---------- 直接删除（连同后面的标点） ---------- */

  const DROP_RULES = [
    { re: /首先[，,：:]\s*/g, label: '连接词「首先」' },
    { re: /其次[，,：:]\s*/g, label: '连接词「其次」' },
    { re: /再次[，,：:]\s*/g, label: '连接词「再次」' },
    { re: /最后[，,：:]\s*/g, label: '连接词「最后」' },
    { re: /值得一提的是[，,]?\s*/g, label: '套话「值得一提的是」' },
    { re: /需要注意的是[，,]?\s*/g, label: '套话「需要注意的是」' },
    { re: /不难发现[，,]?\s*/g, label: '套话「不难发现」' },
    { re: /众所周知[，,]?\s*/g, label: '空洞开场「众所周知」' },
    { re: /毫无疑问[，,]?\s*/g, label: '空洞开场「毫无疑问」' },
    { re: /不可否认[，,]?\s*/g, label: '空洞开场「不可否认」' },
    { re: /在当今社会[，,]?\s*/g, label: '空洞开场「在当今社会」' },
    { re: /在这个[^，。]{0,12}时代[，,]\s*/g, label: '空洞开场「在这个…时代」' },
    { re: /随着[^，。]{0,16}(发展|进步|普及|提升)[，,]\s*/g, label: '空洞开场「随着…」' },
    { re: /话不多说[，,]?\s*/g, label: '套话「话不多说」' },
    { re: /闲话少说[，,]?\s*/g, label: '套话「闲话少说」' },
    { re: /接下来[，,]?(我们|我)?(一起)?(看看|聊聊|了解)[，,]?\s*/g, label: '套话「接下来我们看看」' },
    { re: /(今天|这次)(给大家|为你)(带来|分享|介绍)[：:，,]?\s*/g, label: '套话「今天给大家带来」' },
    { re: /(下面|以下)(就)?(来|为)(大家)?(介绍|盘点|推荐)[：:，,]?\s*/g, label: '套话「下面来介绍」' },
    { re: /(希望|愿)(本文)?(能)?(对你|大家)(有所)?帮助[。！!]?\s*$/gm, label: '套话结尾「希望对你有帮助」' },
  ];

  /* ---------- 替换：黑话 → 白话 ----------
   * 顺序要紧：长串组合词必须排在同词根的短规则之前，
   * 否则「完整闭环」会先被「闭环」吃掉，变成「完整完整流程」。
   */

  const BUZZ_RULES = [
    /* ① 先处理组合词，避免叠加出重复字 */
    { re: /形成了?完整闭环/g, to: '形成了完整流程', label: '黑话「形成完整闭环」' },
    { re: /完整闭环/g, to: '完整流程', label: '黑话「完整闭环」' },
    { re: /实现了?降本增效/g, to: '省了不少时间和钱', label: '黑话「实现降本增效」' },
    { re: /底层逻辑(很|非常|十分)?清晰/g, to: '思路很清楚', label: '黑话「底层逻辑清晰」' },
    { re: /颗粒度(也很|很|非常|十分)?细/g, to: '做得很细', label: '黑话「颗粒度细」' },
    { re: /打通(了)?链路/g, to: '理顺了流程', label: '黑话「打通链路」' },
    { re: /形成闭环/g, to: '形成完整流程', label: '黑话「形成闭环」' },

    /* ② 再处理单个词 */
    { re: /赋能/g, to: '帮', label: '黑话「赋能」→「帮」' },
    { re: /闭环/g, to: '完整流程', label: '黑话「闭环」→「完整流程」' },
    { re: /抓手/g, to: '切入点', label: '黑话「抓手」→「切入点」' },
    { re: /颗粒度/g, to: '细致程度', label: '黑话「颗粒度」' },
    { re: /底层逻辑/g, to: '根本原因', label: '黑话「底层逻辑」' },
    { re: /对齐(认知|目标|预期)/g, to: '统一$1', label: '黑话「对齐」→「统一」' },
    { re: /拉通/g, to: '打通', label: '黑话「拉通」→「打通」' },
    { re: /沉淀(能力|经验|方法|资产)/g, to: '积累$1', label: '黑话「沉淀」→「积累」' },
    { re: /降本增效/g, to: '省钱省时间', label: '黑话「降本增效」' },
    { re: /颠覆性(的)?/g, to: '彻底的', label: '黑话「颠覆性」' },
    { re: /革命性(的)?/g, to: '全新的', label: '黑话「革命性」' },
    { re: /里程碑(式)?(的)?/g, to: '关键的一步', label: '黑话「里程碑」' },
    { re: /全方位(的)?/g, to: '全面的', label: '黑话「全方位」' },
    { re: /多维度(的)?/g, to: '多个角度的', label: '黑话「多维度」' },
    { re: /深层次(的)?/g, to: '更深的', label: '黑话「深层次」' },
    { re: /无缝(衔接|对接)/g, to: '顺畅$1', label: '黑话「无缝衔接」' },
    { re: /极致体验/g, to: '很好用', label: '黑话「极致体验」→「很好用」' },
    { re: /打通(壁垒)/g, to: '理顺$1', label: '黑话「打通壁垒」' },
    { re: /战略布局/g, to: '规划', label: '黑话「战略布局」→「规划」' },
    { re: /生态(体系|闭环)/g, to: '$1', label: '黑话「生态体系」' },
    { re: /(一体|立体)化/g, to: '统一化', label: '黑话「一体化」' },
    { re: /强强联合/g, to: '合作', label: '黑话「强强联合」' },
    { re: /顶层设计/g, to: '整体规划', label: '黑话「顶层设计」' },
    { re: /组合拳/g, to: '一套做法', label: '黑话「组合拳」' },
    { re: /护城河/g, to: '优势', label: '黑话「护城河」→「优势」' },
  ];

  /* ---------- 替换：套话 → 自然说法 ---------- */

  const PHRASE_RULES = [
    { re: /综上所述[，,：:]?\s*/g, to: '说白了，', label: '套话「综上所述」→「说白了」' },
    { re: /总而言之[，,：:]?\s*/g, to: '总之，', label: '套话「总而言之」→「总之」' },
    { re: /总的来说[，,：:]?\s*/g, to: '总体看，', label: '套话「总的来说」' },
    { re: /由此可见[，,]?\s*/g, to: '所以', label: '套话「由此可见」→「所以」' },
    { re: /换言之[，,]?\s*/g, to: '也就是说，', label: '套话「换言之」' },
    { re: /换句话说[，,]?\s*/g, to: '也就是说，', label: '套话「换句话说」' },
    { re: /简而言之[，,]?\s*/g, to: '简单说，', label: '套话「简而言之」' },
    { re: /此外[，,]?\s*/g, to: '另外，', label: '套话「此外」→「另外」' },
    { re: /与此同时[，,]?\s*/g, to: '同时，', label: '套话「与此同时」' },
    { re: /以下是(几|三|四|五|六)点/g, to: '$1条', label: '套话「以下是几点」' },
    { re: /具体(来说|而言)[，,]?\s*/g, to: '具体说，', label: '套话「具体来说」' },
    { re: /(不仅|不但)([^，。]{2,20})(而且|还)/g, to: '不光$2还', label: '句式「不仅…而且」' },
    { re: /一定程度(上|来说)[，,]?\s*/g, to: '部分来说，', label: '套话「一定程度上」' },
    { re: /在某种意义(上|来说)[，,]?\s*/g, to: '某种意义上，', label: '套话「在某种意义上」' },
  ];

  /* ---------- 修饰词收紧 ---------- */

  const MODIFIER_RULES = [
    { re: /非常(好用|强大|方便|简单|重要|明显)/g, to: '挺$1', label: '修饰词「非常」→「挺」' },
    { re: /十分(好用|强大|方便|简单|重要|明显)/g, to: '很$1', label: '修饰词「十分」→「很」' },
    { re: /极大地(提升|提高|改善|优化)/g, to: '大幅$1', label: '修饰词「极大地」→「大幅」' },
    { re: /显著地(提升|提高|改善|优化)/g, to: '明显$1', label: '修饰词「显著地」→「明显」' },
    { re: /(极其|极为)(好用|强大|方便|简单|重要)/g, to: '很$2', label: '修饰词「极其」→「很」' },
    { re: /令人(惊叹|惊艳|眼前一亮)(的)?/g, to: '让人印象深刻的', label: '修饰词「令人惊叹」' },
  ];

  /* ---------- 标点与空白清理 ---------- */

  const CLEAN_RULES = [
    { re: /[ \t]{2,}/g, to: ' ', label: '多余空格' },
    { re: /[ \t]+([，。！？；：、])/g, to: '$1', label: '标点前空格' },
    { re: /([，。！？；：、])[ \t]+/g, to: '$1', label: '标点后空格' },
    { re: /，{2,}/g, to: '，', label: '重复逗号' },
    { re: /。{2,}/g, to: '。', label: '重复句号' },
    { re: /\n{3,}/g, to: '\n\n', label: '多余空行' },
    { re: /^[ \t]+/gm, to: '', label: '行首空格' },
  ];

  function applyRules(text, rules, changes, kind) {
    let out = text;
    rules.forEach((rule) => {
      const to = rule.to == null ? '' : rule.to;
      out = out.replace(rule.re, function () {
        const args = Array.prototype.slice.call(arguments);
        const matched = args[0];
        let replaced;
        if (typeof to === 'function') {
          replaced = to.apply(null, args);
        } else if (/\$\d/.test(to)) {
          // 支持 $1..$9 反向引用
          replaced = to.replace(/\$(\d)/g, (m, i) => (args[Number(i)] == null ? '' : args[Number(i)]));
        } else {
          replaced = to;
        }
        if (matched !== replaced) {
          changes.push({ kind, label: rule.label, from: matched.slice(0, 40), to: replaced.slice(0, 40) });
        }
        return replaced;
      });
    });
    return out;
  }

  /**
   * 规则化降 AI 味
   * @param {string} text 原文
   * @param {{clean?:boolean}} opts
   * @returns {{text:string, changes:Array, count:number, saved:number}}
   */
  function rewrite(text, opts) {
    const src = String(text || '');
    const changes = [];
    let out = src;

    // 顺序有讲究：先删套话（可能含黑话），再换黑话，最后清理空白
    out = applyRules(out, DROP_RULES, changes, 'drop');
    out = applyRules(out, PHRASE_RULES, changes, 'phrase');
    out = applyRules(out, BUZZ_RULES, changes, 'buzz');
    out = applyRules(out, MODIFIER_RULES, changes, 'modifier');

    if (!opts || opts.clean !== false) {
      out = applyRules(out, CLEAN_RULES, changes, 'clean');
    }

    // 句首标点残留清理：删掉词之后可能留下孤立的逗号
    out = out.replace(/^[，,、]\s*/gm, '');
    out = out.replace(/([。！？\n])\s*[，,]/g, '$1');

    const before = src.replace(/\s/g, '').length;
    const after = out.replace(/\s/g, '').length;

    return {
      text: out,
      changes,
      count: changes.length,
      before,
      after,
      saved: before - after,
      changed: out !== src,
    };
  }

  /* ---------- 统计每类改了多少 ---------- */

  function summarize(changes) {
    const m = {};
    changes.forEach((c) => {
      const k = { drop: '删除套话', phrase: '套话改写', buzz: '黑话换白话', modifier: '修饰词收紧', clean: '空白清理' }[c.kind] || c.kind;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  WG.Rewriter = { rewrite, summarize, DROP_RULES, BUZZ_RULES, PHRASE_RULES, MODIFIER_RULES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
