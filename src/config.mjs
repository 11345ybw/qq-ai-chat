import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripBom } from './util.mjs';

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULTS = {
  onebot: {
    mode: 'http',
    http: { listenHost: '127.0.0.1', listenPort: 8787, path: '/onebot', accessToken: '' },
    api: { baseUrl: 'http://127.0.0.1:3000', accessToken: '', timeoutSeconds: 15 },
    ws: { url: 'ws://127.0.0.1:3000', accessToken: '', reconnectSeconds: 5 },
    selfQQ: null,
    chatType: 'private',
    acceptFriendRequest: true,
  },
  ai: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: '',
    temperature: 1.1,
    maxTokens: 700,
    timeoutSeconds: 60,
    jsonMode: true,
    retries: 2,
  },
  reply: {
    maxContextMessages: 30,
    maxContextChars: 6000,
    maxBubbles: 3,
    maxBubbleChars: 60,
    typingMsPerChar: 45,
    maxTypingDelayMs: 1800,
    minBubbleGapMs: 350,
    cooldownSeconds: 2,
  },
  proactive: {
    enabled: true,
    idleSeconds: 300,
    jitterPercent: 15,
    onlyAfterUserMessage: true,
    quietHours: ['23:30', '07:30'],
    maxConsecutive: 3,
    stopAfterMax: true,
    backoffMultiplier: 1.6,
    maxIdleSeconds: 1800,
    checkIntervalSeconds: 20,
    minSecondsBetweenAnyMessage: 45,
  },
  target: { qq: null, name: null },
  paths: { dataDir: 'data', logsDir: 'logs', personaFile: 'persona.md', topicsFile: 'topics.md' },
  logging: { level: 'info', console: true },
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

function needPositiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${label} 必须是正数，当前为 ${JSON.stringify(value)}`);
  }
}

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateConfig(cfg) {
  if (!['http', 'ws'].includes(cfg.onebot.mode)) {
    throw new ConfigError(`onebot.mode 只能是 "http" 或 "ws"，当前为 ${JSON.stringify(cfg.onebot.mode)}`);
  }
  if (!['private', 'group'].includes(cfg.onebot.chatType)) {
    throw new ConfigError(`onebot.chatType 只能是 "private" 或 "group"，当前为 ${JSON.stringify(cfg.onebot.chatType)}`);
  }
  if (!/^https?:\/\//.test(cfg.ai.baseUrl)) throw new ConfigError('ai.baseUrl 必须以 http:// 或 https:// 开头');
  if (!cfg.ai.model) throw new ConfigError('ai.model 不能为空');

  needPositiveNumber(cfg.ai.temperature + 1, 'ai.temperature'); // temperature 允许 0
  needPositiveNumber(cfg.ai.maxTokens, 'ai.maxTokens');
  needPositiveNumber(cfg.ai.timeoutSeconds, 'ai.timeoutSeconds');
  needPositiveNumber(cfg.reply.maxContextMessages, 'reply.maxContextMessages');
  needPositiveNumber(cfg.reply.maxContextChars, 'reply.maxContextChars');
  needPositiveNumber(cfg.reply.maxBubbles, 'reply.maxBubbles');
  needPositiveNumber(cfg.proactive.idleSeconds, 'proactive.idleSeconds');
  needPositiveNumber(cfg.proactive.checkIntervalSeconds, 'proactive.checkIntervalSeconds');
  needPositiveNumber(cfg.proactive.backoffMultiplier, 'proactive.backoffMultiplier');

  if (cfg.proactive.maxConsecutive < 0) throw new ConfigError('proactive.maxConsecutive 不能为负');
  if (cfg.proactive.jitterPercent < 0 || cfg.proactive.jitterPercent > 100) {
    throw new ConfigError('proactive.jitterPercent 需要在 0~100 之间');
  }

  const quiet = cfg.proactive.quietHours;
  if (quiet !== null && quiet !== undefined) {
    if (!Array.isArray(quiet) || quiet.length !== 2 || !quiet.every((s) => HM_RE.test(s))) {
      throw new ConfigError('proactive.quietHours 需要是 ["HH:MM","HH:MM"] 或 null（不设免打扰）');
    }
  }

  if (cfg.proactive.maxIdleSeconds < cfg.proactive.idleSeconds) {
    throw new ConfigError('proactive.maxIdleSeconds 不能小于 proactive.idleSeconds');
  }
  if (cfg.target.qq !== null && cfg.target.qq !== undefined && !Number.isInteger(Number(cfg.target.qq))) {
    throw new ConfigError('target.qq 需要是 QQ 号（整数）或 null（自动识别第一条私聊你的人）');
  }
  return cfg;
}

/**
 * 读取配置。若 config.json 不存在，用 config.example.json 自动生成一份。
 */
export function loadConfig({ root = PROJECT_ROOT, configPath = null } = {}) {
  const file = configPath ?? path.join(root, 'config.json');
  const example = path.join(root, 'config.example.json');
  let created = false;

  if (!fs.existsSync(file)) {
    if (fs.existsSync(example)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(example, file);
      created = true;
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(DEFAULTS, null, 2)}\n`, 'utf8');
      created = true;
    }
  }

  let raw;
  try {
    raw = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    throw new ConfigError(`配置文件不是合法 JSON：${file}\n  ${err.message}\n  （提示：程序已能容忍记事本存出来的 BOM，这里多为漏了逗号或引号）`);
  }

  const cfg = validateConfig(deepMerge(DEFAULTS, raw));
  cfg.target.qq = cfg.target.qq === null || cfg.target.qq === undefined ? null : Number(cfg.target.qq);
  cfg.onebot.selfQQ = cfg.onebot.selfQQ === null || cfg.onebot.selfQQ === undefined ? null : Number(cfg.onebot.selfQQ);
  return { cfg, configPath: file, root, created, mergedFromExample: created };
}

export function resolvePath(root, p) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

/**
 * API key 解析顺序：
 *   1. config.json 里的 ai.apiKey
 *   2. 环境变量 DEEPSEEK_API_KEY
 *   3. secrets.json 的 deepseekApiKey（推荐）
 *   4. 本机 ~/.dsh/.credentials.yaml 的 refs.DEEPSEEK_API_KEY（只是开发机上的便利，多半已失效）
 */
export function resolveApiKey(cfg, root = PROJECT_ROOT, env = process.env) {
  const secretsFile = path.join(root, 'secrets.json');

  const fromConfig = (cfg.ai.apiKey || '').trim();
  if (fromConfig && !isPlaceholderKey(fromConfig)) return { key: fromConfig, source: 'config.json → ai.apiKey', secretsFile };

  const fromEnv = (env.DEEPSEEK_API_KEY || env.DEEPSEEK_KEY || '').trim();
  if (fromEnv && !isPlaceholderKey(fromEnv)) return { key: fromEnv, source: `环境变量 ${env.DEEPSEEK_API_KEY ? 'DEEPSEEK_API_KEY' : 'DEEPSEEK_KEY'}`, secretsFile };

  const secrets = readJsonFileQuiet(secretsFile);
  const fromSecrets = String(secrets?.deepseekApiKey ?? '').trim();
  if (fromSecrets && !isPlaceholderKey(fromSecrets)) return { key: fromSecrets, source: 'secrets.json', secretsFile };
  if (fromSecrets) {
    return {
      key: '',
      source: `secrets.json（里面还是示例里的占位符："${fromSecrets.slice(0, 12)}…"）`,
      secretsFile,
    };
  }

  const dsh = readTextQuiet(path.join(os.homedir(), '.dsh', '.credentials.yaml'));
  if (dsh) {
    const m = dsh.match(/DEEPSEEK_API_KEY:\s*(sk-[A-Za-z0-9]+)/);
    if (m) {
      return {
        key: m[1],
        source: '~/.dsh/.credentials.yaml（本机以前留下的 key，多半已失效）',
        secretsFile,
      };
    }
  }

  return {
    key: '',
    source: fs.existsSync(secretsFile) ? 'secrets.json（里面没有 deepseekApiKey 字段）' : '未找到：项目目录里还没有 secrets.json',
    secretsFile,
  };
}

/** 示例文件里的占位符别拿去请求接口，否则只会得到一个莫名其妙的 401 */
export function isPlaceholderKey(key) {
  const k = String(key ?? '').trim();
  if (!k) return true;
  if (k.length < 12) return true;
  if (/在这里填|你的key|your[-_ ]?key|change[-_ ]?me|xxx/i.test(k)) return true;
  return false;
}

function readTextQuiet(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJsonFileQuiet(file) {
  const text = readTextQuiet(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
