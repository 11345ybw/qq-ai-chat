/**
 * 常见大模型服务商预设。全部都是 OpenAI 兼容接口，直接改 config.json 即可切换。
 * 命令：node src/index.mjs --provider glm
 *
 * 注意：模型名会随服务商更新而变化。切换后请务必跑一次 `--check`，
 *      它会调用 /models 把真实可用的模型列出来，并提示你配置的模型是否不存在。
 */
export const PROVIDERS = [
  {
    id: 'glm',
    label: '智谱 GLM（国内直连，flash 系列长期免费，推荐首选）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    jsonMode: false,
    keyUrl: 'https://open.bigmodel.cn',
    note: '手机号注册即用。若 glm-4-flash 不可用，把 model 换成 --check 里列出的任意 flash 型号。',
  },
  {
    id: 'qwen',
    label: '阿里云百炼 · 通义千问（新用户每个模型都有免费额度，延迟低）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    jsonMode: false,
    keyUrl: 'https://bailian.console.aliyun.com',
    note: '接口是"兼容模式"，必须带 /compatible-mode/v1 这一段。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow（一个 key 调多家开源模型，有免费小模型）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-8B',
    jsonMode: true,
    keyUrl: 'https://cloud.siliconflow.cn',
    note: '免费模型通常带限流，聊天够用；模型 ID 里带斜杠，要原样填。',
  },
  {
    id: 'ark',
    label: '火山方舟 · 豆包（极便宜、速度很快）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-flash',
    jsonMode: false,
    keyUrl: 'https://console.volcengine.com/ark',
    note: '需要在控制台开通模型并创建"推理接入点"，也可以直接用模型 ID（以控制台为准）。',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元（lite 系列免费）',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-lite',
    jsonMode: false,
    keyUrl: 'https://console.cloud.tencent.com/hunyuan',
    note: '需要在腾讯云控制台开通并创建 API Key。',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi（中文自然，速度快）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    jsonMode: true,
    keyUrl: 'https://platform.moonshot.cn',
    note: '新账号有体验额度，之后按量计费，价格低。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方 · flash（默认，快且便宜）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    jsonMode: true,
    keyUrl: 'https://platform.deepseek.com',
    note: '本项目出厂默认。DeepSeek 必须账户有余额，否则一律返回 402 Insufficient Balance（check.bat 会直接显示余额）。',
  },
  {
    id: 'deepseek-pro',
    label: 'DeepSeek 官方 · v4-pro（更聪明，但更慢更贵）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    jsonMode: true,
    keyUrl: 'https://platform.deepseek.com',
    note: '同一把 key，只是换成 pro 档；角色扮演更稳，延迟更高。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama（完全不花钱、不用 key，但需要显卡/大内存）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    jsonMode: false,
    keyUrl: 'https://ollama.com',
    noKey: true,
    note: '先装 Ollama 并 `ollama pull qwen2.5:7b`。7B 模型在没显卡的机器上会明显卡顿。',
  },
  {
    id: 'groq',
    label: 'Groq（目前最快，有免费额度，需要能访问外网）',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    jsonMode: true,
    keyUrl: 'https://console.groq.com',
    note: '国内网络通常连不上，服务器在境外才建议用。',
  },
  {
    id: 'gemini',
    label: 'Google Gemini（有免费额度，需要能访问外网）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    jsonMode: false,
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'OpenAI 兼容层，路径必须带 /v1beta/openai。',
  },
];

export function findProvider(id) {
  if (!id) return null;
  const key = String(id).trim().toLowerCase();
  return PROVIDERS.find((p) => p.id === key) ?? null;
}

/** 把某个预设写进 config 对象（原地修改并返回） */
export function applyProviderPreset(rawConfig, id, { model = null } = {}) {
  const preset = findProvider(id);
  if (!preset) return null;
  const next = { ...rawConfig };
  next.ai = { ...(next.ai ?? {}), baseUrl: preset.baseUrl, model: model || preset.model, jsonMode: preset.jsonMode !== false };
  return { config: next, preset };
}

export function providerTable() {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, model: p.model, jsonMode: p.jsonMode !== false }));
}
