import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ConfigError, DEFAULTS, deepMerge, isPlaceholderKey, loadConfig, resolveApiKey, resolvePath, validateConfig } from '../src/config.mjs';
import { loadPersonaContent, pickSeeds, buildSystemPrompt, buildProactiveInstruction } from '../src/persona.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-ai-chat-cfg-'));
  fs.copyFileSync(new URL('../config.example.json', import.meta.url), path.join(dir, 'config.example.json'));
  return dir;
}

test('config.json 不存在时自动从示例生成', () => {
  const root = tmpRoot();
  const res = loadConfig({ root });
  assert.equal(res.created, true);
  assert.ok(fs.existsSync(path.join(root, 'config.json')));
  assert.equal(res.cfg.onebot.mode, 'http');
  assert.equal(res.cfg.ai.model, 'deepseek-flash');
});

test('深层合并保留默认值', () => {
  const merged = deepMerge(DEFAULTS, { proactive: { idleSeconds: 60 } });
  assert.equal(merged.proactive.idleSeconds, 60);
  assert.equal(merged.proactive.maxConsecutive, DEFAULTS.proactive.maxConsecutive);
  assert.equal(merged.onebot.http.listenPort, 8787);
});

test('非法配置给出中文报错', () => {
  assert.throws(() => validateConfig(deepMerge(DEFAULTS, { onebot: { mode: 'carrier-pigeon' } })), ConfigError);
  assert.throws(() => validateConfig(deepMerge(DEFAULTS, { proactive: { quietHours: ['25:00', '07:00'] } })), ConfigError);
  assert.throws(() => validateConfig(deepMerge(DEFAULTS, { ai: { baseUrl: 'ftp://x' } })), ConfigError);
  assert.throws(() => validateConfig(deepMerge(DEFAULTS, { proactive: { idleSeconds: 0 } })), ConfigError);
  assert.throws(() => validateConfig(deepMerge(DEFAULTS, { proactive: { maxIdleSeconds: 10, idleSeconds: 300 } })), ConfigError);
});

test('target.qq 支持数字与 null', () => {
  const cfg = validateConfig(deepMerge(DEFAULTS, { target: { qq: '123456' } }));
  assert.equal(cfg.target.qq, '123456');
  const res = loadConfig({ root: tmpRoot() });
  assert.equal(res.cfg.target.qq, null);
  assert.equal(res.cfg.target.name, null);
});

test('target.name 可以指定她怎么称呼你', () => {
  const cfg = validateConfig(deepMerge(DEFAULTS, { target: { name: '阿澈' } }));
  assert.equal(cfg.target.name, '阿澈');
});

test('resolvePath 支持绝对路径', () => {
  assert.equal(resolvePath('C:\\x', 'data'), path.join('C:\\x', 'data'));
  assert.equal(resolvePath('C:\\x', 'D:\\abs'), 'D:\\abs');
});

test('API key 优先级：config > 环境变量 > secrets.json', () => {
  const root = tmpRoot();
  const cfg = deepMerge(DEFAULTS, {});
  const ENV_KEY = 'sk-env-1234567890abcdef';
  const FILE_KEY = 'sk-file-1234567890abcdef';
  const CFG_KEY = 'sk-cfg-1234567890abcdef';

  assert.equal(resolveApiKey(cfg, root, { DEEPSEEK_API_KEY: ENV_KEY }).key, ENV_KEY);
  fs.writeFileSync(path.join(root, 'secrets.json'), JSON.stringify({ deepseekApiKey: FILE_KEY }), 'utf8');
  assert.equal(resolveApiKey(cfg, root, {}).key, FILE_KEY);
  assert.equal(resolveApiKey(cfg, root, { DEEPSEEK_API_KEY: ENV_KEY }).key, ENV_KEY);
  assert.equal(resolveApiKey({ ...cfg, ai: { ...cfg.ai, apiKey: CFG_KEY } }, root, { DEEPSEEK_API_KEY: ENV_KEY }).key, CFG_KEY);
});

test('secrets.json 里还是示例占位符时算“没填”，不要拿去请求接口', () => {
  const root = tmpRoot();
  const cfg = deepMerge(DEFAULTS, {});
  fs.writeFileSync(path.join(root, 'secrets.json'), JSON.stringify({ deepseekApiKey: 'sk-在这里填你的DeepSeek密钥' }), 'utf8');
  const res = resolveApiKey(cfg, root, {});
  assert.equal(res.key, '');
  assert.match(res.source, /占位符/);
});

test('isPlaceholderKey 的判定', () => {
  assert.equal(isPlaceholderKey(''), true);
  assert.equal(isPlaceholderKey('change-me-please'), true);
  assert.equal(isPlaceholderKey('sk-在这里填你的DeepSeek密钥'), true);
  assert.equal(isPlaceholderKey('sk-短key'), true, '太短的不像真 key');
  assert.equal(isPlaceholderKey('sk-testonlynotarealkey0123456789'), false, '看起来像真 key 的要放行');
});

test('人设与话题种子能被读取', () => {
  const { persona, topics } = loadPersonaContent({ root: PROJECT_ROOT });
  assert.match(persona, /时崎狂三/);
  assert.ok(topics.length >= 5);
});

test('系统提示词包含角色与硬性规则', () => {
  const prompt = buildSystemPrompt({ persona: '时崎狂三的角色卡内容', speakerName: '小明', now: new Date('2026-10-10T23:10:00') });
  assert.match(prompt, /小明/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /时崎狂三的角色卡内容/);
  assert.match(prompt, /深夜/);
});

test('主动开口指令含条数限制与灵感，但不含"沉默"以外的穿帮词', () => {
  const text = buildProactiveInstruction({
    speakerName: '小明',
    seeds: ['问问他在干嘛'],
    now: new Date('2026-10-10T09:00:00'),
    idleMinutes: 12,
    recap: '他：在忙\n你：好吧',
  });
  assert.match(text, /只发 1 条/);
  assert.match(text, /问问他在干嘛/);
  assert.match(text, /小明/);
  assert.match(text, /上午/);
});

test('pickSeeds 不重复且不超过池子大小', () => {
  const seeds = ['a', 'b', 'c'];
  const picked = pickSeeds(seeds, 2, () => 0.99);
  assert.equal(picked.length, 2);
  assert.equal(new Set(picked).size, 2);
  assert.equal(pickSeeds([], 2).length, 0);
});
