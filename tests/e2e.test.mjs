import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createAi } from '../src/ai.mjs';
import { createChat } from '../src/chat.mjs';
import { DEFAULTS, deepMerge, validateConfig } from '../src/config.mjs';
import { createLogger } from '../src/logger.mjs';
import { createTransport } from '../src/onebot/index.mjs';
import { loadPersonaContent } from '../src/persona.mjs';
import { Store } from '../src/store.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

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

async function waitFor(fn, { timeoutMs = 8000, stepMs = 150 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** 假的 DeepSeek：收到带"主动"的指令就返回主动语气的内容 */
function startFakeAi() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let json = {};
    try {
      json = JSON.parse(raw);
    } catch {
      /* 忽略 */
    }
    requests.push(json);
    const last = json?.messages?.at(-1)?.content ?? '';
    const content = last.includes('主动发一句')
      ? '{"messages":["突然有点想你了呢。"]}'
      : '{"messages":["啊啦~啊啦~","你终于想起来我了？"]}';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', model: 'test', choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  return { server, requests };
}

/** 假的 NapCat OneBot HTTP 服务 */
function startFakeNapCat() {
  const sent = [];
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    const action = (req.url ?? '/').replace(/^\//, '');
    let json = {};
    try {
      json = JSON.parse(raw);
    } catch {
      /* 忽略 */
    }
    if (action === 'send_private_msg') {
      const text = (json.params?.message ?? []).map((s) => s?.data?.text ?? '').join('');
      sent.push({ to: json.params?.user_id, text, auth: req.headers.authorization ?? '' });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 999999, nickname: '假机器人' } }));
  });
  return { server, sent };
}

test('端到端：收到私聊会回复，沉默够久会主动开口（HTTP 接入）', async (t) => {
  const ai = startFakeAi();
  const napcat = startFakeNapCat();
  const aiPort = await getFreePort();
  const napcatPort = await getFreePort();
  const botPort = await getFreePort();

  await new Promise((r) => ai.server.listen(aiPort, '127.0.0.1', r));
  await new Promise((r) => napcat.server.listen(napcatPort, '127.0.0.1', r));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-ai-chat-e2e-'));
  const cfg = validateConfig(
    deepMerge(DEFAULTS, {
      onebot: {
        mode: 'http',
        http: { listenHost: '127.0.0.1', listenPort: botPort, path: '/onebot', accessToken: 'tok-report' },
        api: { baseUrl: `http://127.0.0.1:${napcatPort}`, accessToken: 'tok-api', timeoutSeconds: 5 },
      },
      ai: { baseUrl: `http://127.0.0.1:${aiPort}`, model: 'test-model', apiKey: 'sk-test', retries: 0, timeoutSeconds: 5 },
      reply: { typingMsPerChar: 0, maxTypingDelayMs: 60, minBubbleGapMs: 10, cooldownSeconds: 0, maxContextMessages: 10 },
      proactive: {
        enabled: true,
        idleSeconds: 2,
        jitterPercent: 0,
        quietHours: null,
        checkIntervalSeconds: 1,
        minSecondsBetweenAnyMessage: 1,
        backoffMultiplier: 2,
        maxIdleSeconds: 30,
      },
      logging: { level: 'error', console: false },
    }),
  );

  const log = createLogger({ level: 'error', dir: null, console: false });
  const store = new Store({ root: tmp, dataDir: 'data' });
  store.load();
  const persona = loadPersonaContent({ root: PROJECT_ROOT });
  const aiClient = createAi({ cfg, apiKey: 'sk-test', log });

  let chatRef = null;
  const transport = createTransport({ cfg, log, onEvent: (e) => chatRef?.onEvent(e) });
  const chat = createChat({ cfg, log, ai: aiClient, transport, store, persona });
  chatRef = chat;

  await transport.start();
  chat.start();

  t.after(async () => {
    chat.stop();
    await transport.stop();
    await new Promise((r) => ai.server.close(r));
    await new Promise((r) => napcat.server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // 1) token 不对要拒绝
  const bad = await fetch(`http://127.0.0.1:${botPort}/onebot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
    body: JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat' }),
  });
  assert.equal(bad.status, 401);

  // 2) 模拟对方发一条私聊
  const event = {
    time: Math.floor(Date.now() / 1000),
    self_id: 999999,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: 1001,
    user_id: 10001,
    raw_message: '在吗',
    sender: { user_id: 10001, nickname: '小明', sex: 'unknown', age: 18 },
    message: [{ type: 'text', data: { text: '在吗' } }],
  };
  const okRes = await fetch(`http://127.0.0.1:${botPort}/onebot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok-report' },
    body: JSON.stringify(event),
  });
  assert.equal(okRes.status, 200);

  // 3) 应该收到两条回复气泡，且带上了 API token
  const replied = await waitFor(async () => (napcat.sent.length >= 2 ? napcat.sent : null));
  assert.ok(replied, '没有收到回复');
  assert.deepEqual(replied.slice(0, 2).map((s) => s.text), ['啊啦~啊啦~', '你终于想起来我了？']);
  assert.equal(replied[0].to, 10001);
  assert.equal(replied[0].auth, 'Bearer tok-api');
  assert.equal(store.state.targetQQ, 10001);
  assert.equal(store.state.targetName, '小明');

  // 4) 重复 message_id 不重复回复
  const before = napcat.sent.length;
  await fetch(`http://127.0.0.1:${botPort}/onebot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok-report' },
    body: JSON.stringify(event),
  });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(napcat.sent.length, before, '重复消息不应再回复');

  // 5) 沉默 2 秒后应主动发一条
  const proactive = await waitFor(async () => napcat.sent.find((s) => s.text === '突然有点想你了呢。'), { timeoutMs: 9000 });
  assert.ok(proactive, `没有等到主动消息，已发送：${JSON.stringify(napcat.sent)}`);
  assert.equal(store.state.consecutiveProactive >= 1, true);

  // 6) 主动消息的提示词里确实带上了"主动发一句"的指令
  const proactiveRequest = ai.requests.find((r) => (r.messages?.at(-1)?.content ?? '').includes('主动发一句'));
  assert.ok(proactiveRequest, '没有找到主动发言的模型请求');
  assert.match(proactiveRequest.messages[0].content, /时崎狂三/);
  assert.equal(proactiveRequest.response_format.type, 'json_object');

  // 7) 对方回话后计数清零
  await fetch(`http://127.0.0.1:${botPort}/onebot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok-report' },
    body: JSON.stringify({ ...event, message_id: 1002, raw_message: '刚在忙啦', message: [{ type: 'text', data: { text: '刚在忙啦' } }] }),
  });
  const replied2 = await waitFor(async () => (napcat.sent.length > before + 2 ? napcat.sent : null));
  assert.ok(replied2, '第二次没有回复');
  assert.equal(store.state.consecutiveProactive, 0);

  // 8) 群消息会被忽略
  const groupBefore = napcat.sent.length;
  await fetch(`http://127.0.0.1:${botPort}/onebot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok-report' },
    body: JSON.stringify({ ...event, message_type: 'group', group_id: 555, message_id: 1003, raw_message: '群里说话' }),
  });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(napcat.sent.length, groupBefore, '群消息不该被回复');

  // 9) 控制接口：让正在运行的实例立刻发一条（once.bat 走的就是这里）
  const beforeControl = napcat.sent.length;
  const control = await fetch(`http://127.0.0.1:${botPort}/control/proactive`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok-report' },
  });
  assert.equal(control.status, 200);
  const controlSent = await waitFor(async () => (napcat.sent.length > beforeControl ? napcat.sent : null));
  assert.ok(controlSent, '控制接口没能触发主动消息');

  // 10) 控制接口同样受 token 保护
  const controlDenied = await fetch(`http://127.0.0.1:${botPort}/control/proactive`, { method: 'POST' });
  assert.equal(controlDenied.status, 401);
});
