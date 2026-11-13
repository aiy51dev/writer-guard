/* ============================================================
 * Writer Guard · AI 平台接入
 *
 * 支持多家 OpenAI 兼容接口。Key 存在 chrome.storage.local，
 * 验证通过后 UI 自动收起，只留一个绿点。
 * 后台每 24 小时静默复验一次，失败也不打扰。
 * ============================================================ */
(function (root) {
  'use strict';

  const WG = root.WG || (root.WG = {});

  /* ---------- 平台定义 ---------- */

  const PROVIDERS = [
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
      keyHint: 'sk-...',
      docs: 'https://platform.openai.com/api-keys',
      host: 'api.openai.com',
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      keyHint: 'sk-...',
      docs: 'https://platform.deepseek.com/api_keys',
      host: 'api.deepseek.com',
    },
    {
      id: 'zhipu',
      name: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
      keyHint: 'xxxxx.xxxxx',
      docs: 'https://bigmodel.cn/usercenter/apikeys',
      host: 'open.bigmodel.cn',
    },
    {
      id: 'moonshot',
      name: '月之暗面 Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
      keyHint: 'sk-...',
      docs: 'https://platform.moonshot.cn/console/api-keys',
      host: 'api.moonshot.cn',
    },
    {
      id: 'dashscope',
      name: '阿里通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
      keyHint: 'sk-...',
      docs: 'https://bailian.console.aliyun.com/',
      host: 'dashscope.aliyuncs.com',
    },
    {
      id: 'doubao',
      name: '豆包（火山方舟）',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      // 方舟支持模型名或 ep-xxx 接入点 ID，都能填
      models: ['doubao-seed-1-6-250615', 'doubao-1.5-pro-32k', 'doubao-1.5-lite-32k'],
      keyHint: '火山方舟 API Key（或填 ep-xxx 接入点为模型名）',
      docs: 'https://console.volcengine.com/ark',
      host: 'ark.cn-beijing.volces.com',
    },
    {
      id: 'custom',
      name: '自定义（OpenAI 兼容）',
      baseUrl: '',
      models: [],
      keyHint: '任意',
      docs: '',
      host: '',
    },
  ];

  const CONFIG_KEY = 'aiConfig';

  /* ---------- 配置读写 ---------- */

  function loadConfig() {
    const c = WG.Store.get(CONFIG_KEY, null);
    if (!c || typeof c !== 'object') return null;
    return c;
  }

  function saveConfig(cfg) {
    WG.Store.set(CONFIG_KEY, cfg);
    /* 内置应用（情绪导演等）没填 Key 时复用这份配置，存完立刻推过去 */
    try { if (WG.studioAIChanged) WG.studioAIChanged(cfg); } catch (e) { /* ignore */ }
    return cfg;
  }

  function clearConfig() {
    WG.Store.set(CONFIG_KEY, null);
    try { if (WG.studioAIChanged) WG.studioAIChanged(null); } catch (e) { /* ignore */ }
  }

  /** 验证通过且没过期，才算可用 */
  function isReady() {
    const c = loadConfig();
    return !!(c && c.verified && c.key && c.baseUrl && c.model);
  }

  function providerOf(id) {
    return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  }

  /* ---------- 验证 ---------- */

  /**
   * 验证 Key 是否可用。
   * 优先打 /models（免费、快）；不支持就退回一次极小的 chat 请求。
   */
  async function verify(cfg) {
    if (!cfg || !cfg.key || !cfg.baseUrl) {
      return { ok: false, msg: '缺少 Key 或接口地址' };
    }

    const base = String(cfg.baseUrl).replace(/\/+$/, '');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.key,
    };

    // ① 试 /models
    try {
      const res = await fetch(base + '/models', { method: 'GET', headers });
      if (res.ok) return { ok: true, msg: '连接正常', via: 'models' };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, msg: 'Key 无效或没有权限（' + res.status + '）' };
      }
      // 404 之类说明不支持 /models，继续往下试
    } catch (e) {
      // 网络错误继续试 chat
    }

    // ② 退回 chat：用最小请求探活
    try {
      const res2 = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      });

      if (res2.ok) return { ok: true, msg: '连接正常', via: 'chat' };

      if (res2.status === 401 || res2.status === 403) {
        return { ok: false, msg: 'Key 无效或没有权限（' + res2.status + '）' };
      }

      let detail = '';
      try {
        const j = await res2.json();
        detail = (j && j.error && (j.error.message || j.error.code)) || '';
      } catch (e) { /* ignore */ }

      if (res2.status === 404 && /model/i.test(detail)) {
        return { ok: false, msg: '模型名不对：' + cfg.model };
      }
      return { ok: false, msg: '验证失败（' + res2.status + '）' + (detail ? ' ' + detail.slice(0, 60) : '') };
    } catch (e2) {
      return { ok: false, msg: '连不上：' + (e2.message || '网络错误') };
    }
  }

  /** 验证并写回配置 */
  async function verifyAndSave(cfg) {
    const r = await verify(cfg);
    const next = Object.assign({}, cfg, {
      verified: !!r.ok,
      lastCheck: Date.now(),
      lastMsg: r.msg,
    });
    saveConfig(next);
    return { ok: r.ok, msg: r.msg, config: next };
  }

  /* ---------- 调用 ---------- */

  /**
   * 发一次对话请求
   * @param {Array<{role:string,content:string}>} messages
   * @param {{temperature?:number, maxTokens?:number, timeout?:number}} opts
   */
  async function chat(messages, opts) {
    const cfg = loadConfig();
    if (!cfg || !cfg.key || !cfg.baseUrl) {
      throw new Error('还没配置 AI 接口');
    }

    const o = opts || {};
    const base = String(cfg.baseUrl).replace(/\/+$/, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 30000);

    try {
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.key,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: o.temperature == null ? 0.7 : o.temperature,
          max_tokens: o.maxTokens || 900,
          stream: false,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('接口返回 ' + res.status + (txt ? '：' + txt.slice(0, 120) : ''));
      }

      const data = await res.json();
      const content = data
        && data.choices
        && data.choices[0]
        && data.choices[0].message
        && data.choices[0].message.content;

      if (!content) throw new Error('返回内容为空');
      return String(content).trim();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- 后台复验 ---------- */

  const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

  /** 距离上次验证是否超过 24 小时 */
  function isStale() {
    const c = loadConfig();
    if (!c || !c.lastCheck) return true;
    return Date.now() - c.lastCheck > CHECK_INTERVAL;
  }

  /** 静默复验：失败只改标记，不弹任何东西 */
  async function silentRecheck() {
    const c = loadConfig();
    if (!c || !c.key) return { ok: false, skipped: true };
    if (!isStale()) return { ok: c.verified, skipped: true };

    const r = await verify(c);
    saveConfig(Object.assign({}, c, {
      verified: !!r.ok,
      lastCheck: Date.now(),
      lastMsg: r.msg,
    }));
    return { ok: r.ok, msg: r.msg };
  }

  WG.AI = {
    PROVIDERS,
    CONFIG_KEY,
    CHECK_INTERVAL,
    loadConfig,
    saveConfig,
    clearConfig,
    isReady,
    isStale,
    providerOf,
    verify,
    verifyAndSave,
    chat,
    silentRecheck,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
