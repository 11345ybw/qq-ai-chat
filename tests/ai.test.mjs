import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createAi, describeAiError } from '../src/ai.mjs';
import { DEFAULTS, deepMerge, validateConfig } from '../src/config.mjs';
import { PROVIDERS, applyProviderPreset, findProvider, providerTable } from '../src/providers.mjs';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function getFreePort() {
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

function makeCfg(port, extra = {}) {
  return validateConfig(
    deepMerge(DEFAULTS, {
      ai: { baseUrl: `http://127.0.0.1:${port}`, model: 'test-model', apiKey: 'sk-test', retries: 0, timeoutSeconds: 5, ...extra },
    }),
  );
}

test('服务商预设都填了必要的字段', () => {
  assert.ok(PROVIDERS.length >= 5);
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.label, `${p.id} 缺少 id/label`);
    assert.match(p.baseUrl, /^https?:\/\//, `${p.id} 的 baseUrl 不合法`);
    assert.ok(p.model, `${p.id} 缺少 model`);
    assert.ok(p.keyUrl, `${p.id} 缺少 keyUrl`);
  }
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length, 'id 不能重复');
});

test('applyProviderPreset 会写对 baseUrl / model / jsonMode', () => {
  const res = applyProviderPreset({ ai: { temperature: 1.2 } }, 'glm');
  assert.equal(res.preset.id, 'glm');
  assert.equal(res.config.ai.baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(res.config.ai.model, 'glm-4-flash');
  assert.equal(res.config.ai.jsonMode, false);
  assert.equal(res.config.ai.temperature, 1.2, '不该动其它字段');
  assert.equal(applyProviderPreset({}, '不存在的服务商'), null);
  assert.equal(findProvider('GLM').id, 'glm', 'id 大小写不敏感');
  assert.ok(providerTable().every((p) => p.id && p.label && p.baseUrl && p.model));
});

test('常见错误被翻译成人话与下一步', () => {
  assert.match(describeAiError(401), /API Key 无效/);
  assert.match(describeAiError(402), /余额不足/);
  assert.match(describeAiError(402, '{"error":{"message":"Insufficient Balance"}}'), /充值|switch-model/);
  assert.match(describeAiError(200, '{"error":{"message":"Authentication Fails"}}'), /API Key 无效/);
  assert.match(describeAiError(404), /模型名不存在/);
  assert.match(describeAiError(404, '{"error":{"message":"The model does not exist"}}'), /check\.bat/);
  assert.match(describeAiError(429), /限流|频繁/);
  assert.match(describeAiError(503), /自动重试/);
  assert.match(describeAiError(0), /网络不通/);
});

test('模型接口原样支持 json_object 时只请求一次', async () => {
  const port = await getFreePort();
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    seen.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"messages":["好"]}' } }] }));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  try {
    const ai = createAi({ cfg: makeCfg(port), apiKey: 'sk-test' });
    const res = await ai.reply({ messages: [{ role: 'user', content: '在吗' }] });
    assert.deepEqual(res.bubbles, ['好']);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].response_format, { type: 'json_object' });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('服务商不支持 json_object 时自动降级重试，聊天照样能用', async () => {
  const port = await getFreePort();
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    seen.push(body);
    if (body.response_format) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'response_format is not supported by this model', type: 'invalid_request_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '啊啦~啊啦~。今天过得怎么样呢？' } }] }));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  try {
    const warnings = [];
    const log = { warn: (m) => warnings.push(m), info: () => {}, debug: () => {}, error: () => {} };
    const ai = createAi({ cfg: makeCfg(port), apiKey: 'sk-test', log });
    const res = await ai.reply({ messages: [{ role: 'user', content: '在吗' }] });
    assert.equal(seen.length, 2, '应该重试一次');
    assert.deepEqual(seen[0].response_format, { type: 'json_object' });
    assert.equal(seen[1].response_format, undefined);
    assert.ok(res.bubbles.length >= 1);
    assert.match(res.bubbles.join(''), /啊啦/);
    assert.ok(warnings.some((w) => w.includes('json_object')), '应该提示已降级');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('鉴权失败（401）不会重试、直接报错', async () => {
  const port = await getFreePort();
  let hits = 0;
  const server = http.createServer(async (req, res) => {
    hits += 1;
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  try {
    const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
    const ai = createAi({ cfg: makeCfg(port, { retries: 2 }), apiKey: 'sk-bad', log });
    await assert.rejects(() => ai.reply({ messages: [{ role: 'user', content: 'hi' }] }), /401/);
    assert.equal(hits, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
