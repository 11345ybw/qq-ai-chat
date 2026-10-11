import { toBubbles } from './text.mjs';
import { sleep } from './util.mjs';

export class AiError extends Error {
  constructor(message, { status = 0, body = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.body = body;
  }
}

/** 把各家常见的 HTTP 错误翻译成"人话 + 下一步怎么办" */
export function describeAiError(status, body = '') {
  const text = String(body).toLowerCase();
  if (status === 0) return '网络不通或超时（检查服务器能不能上外网 / 是否需要代理）';
  if (status === 401 || /authentication fails|invalid api key|unauthorized/.test(text)) {
    return 'API Key 无效或没填：去服务商后台重新生成一把，填进 secrets.json';
  }
  if (status === 402 || /insufficient balance|quota exceeded|欠费/.test(text)) {
    return '账户余额不足/未充值：DeepSeek 需要先充值；不想充就双击 switch-model.bat 换个有免费额度的服务商（例如智谱 GLM）';
  }
  if (status === 403) return '没有权限：可能该账号未开通这个模型';
  if (status === 404 || /model.*not.*(exist|found)/.test(text)) {
    return '模型名不存在：跑一次 check.bat，它会列出这家真实可用的模型，照着改 config.json 的 ai.model';
  }
  if (status === 429) return '请求太频繁（免费档限流）：程序会自动退避重试，也可以换模型或调慢 proactive 频率';
  if (status >= 500) return '服务商临时故障：程序会自动重试';
  return '请求被拒绝：多为参数不对或该家不支持某些参数（json 模式不支持时程序会自动降级重试）';
}

/**
 * DeepSeek（OpenAI 兼容）聊天客户端，只用 fetch，无第三方依赖。
 */
export function createAi({ cfg, apiKey, log, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 没有 fetch，请升级到 Node 18+');

  const base = cfg.ai.baseUrl.replace(/\/+$/, '');
  let jsonModeActive = cfg.ai.jsonMode !== false;
  let downgraded = false;

  async function request(messages, { timeoutMs = cfg.ai.timeoutSeconds * 1000, jsonMode = jsonModeActive } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = {
        model: cfg.ai.model,
        messages,
        temperature: cfg.ai.temperature,
        max_tokens: cfg.ai.maxTokens,
        stream: false,
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new AiError(`模型接口返回 ${res.status}：${describeAiError(res.status, text)}`, { status: res.status, body: text.slice(0, 500) });
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiError('模型接口返回的不是 JSON', { status: res.status, body: text.slice(0, 500) });
      }
      const content = json?.choices?.[0]?.message?.content ?? '';
      return { content, usage: json?.usage ?? null, model: json?.model ?? cfg.ai.model };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 有些服务商不支持 response_format=json_object，遇到就自动降级成普通文本模式 */
  function looksLikeJsonModeUnsupported(err) {
    if (!jsonModeActive || downgraded) return false;
    const body = String(err?.body ?? '').toLowerCase();
    return (err?.status === 400 || err?.status === 422) && /response_format|json_object|json mode/.test(body);
  }

  async function chat(messages, opts = {}) {
    const attempts = Math.max(1, (cfg.ai.retries ?? 0) + 1);
    let lastErr = null;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        return await request(messages, opts);
      } catch (err) {
        lastErr = err;
        if (looksLikeJsonModeUnsupported(err)) {
          jsonModeActive = false;
          downgraded = true;
          log?.warn('这个服务商不支持 json_object 模式，已自动改用普通文本（回复会被自动拆分，不影响使用）');
          i -= 1;
          if (i < 0) i = 0;
          continue;
        }
        const status = err?.status ?? 0;
        const retriable = err?.name === 'AbortError' || status === 0 || status === 429 || status >= 500;
        log?.warn(`模型请求失败（第 ${i}/${attempts} 次）：${err.message}`);
        if (err.body) log?.debug(`  接口原话：${String(err.body).slice(0, 160)}`);
        if (!retriable || i === attempts) break;
        await sleep(600 * i);
      }
    }
    throw lastErr ?? new AiError('模型请求失败');
  }

  /**
   * 生成回复，返回要连发的气泡数组。
   * @param {{messages: Array<{role:string,content:string}>}} params
   */
  async function reply({ messages }) {
    const res = await chat(messages);
    const bubbles = toBubbles(res.content, {
      maxBubbles: cfg.reply.maxBubbles,
      maxBubbleChars: cfg.reply.maxBubbleChars,
    });
    if (!bubbles.length) throw new AiError('模型返回了空内容', { body: String(res.content).slice(0, 200) });
    return { bubbles, raw: res.content, usage: res.usage };
  }

  async function listModels() {
    const res = await fetchImpl(`${base}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    if (!res.ok) throw new AiError(`/models 返回 ${res.status}：${describeAiError(res.status, text)}`, { status: res.status, body: text.slice(0, 300) });
    try {
      const json = JSON.parse(text);
      return (json?.data ?? []).map((m) => m.id).filter(Boolean);
    } catch {
      throw new AiError('/models 返回的不是 JSON', { body: text.slice(0, 300) });
    }
  }

  /** DeepSeek 专属：查余额，提前发现"没充值"这个坑 */
  async function getBalance() {
    const res = await fetchImpl(`${base}/user/balance`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    try {
      const json = await res.json();
      const info = json?.balance_infos?.[0] ?? null;
      return {
        available: json?.is_available === true,
        total: info?.total_balance ?? null,
        granted: info?.granted_balance ?? null,
        toppedUp: info?.topped_up_balance ?? null,
        currency: info?.currency ?? '',
      };
    } catch {
      return null;
    }
  }

  return { chat, reply, listModels, getBalance, base, model: cfg.ai.model };
}
