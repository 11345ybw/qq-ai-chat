import http from 'node:http';

/**
 * OneBot 11 · HTTP 反向接入（推荐方式，无需 WebSocket，Node 18 就能跑）
 *   ➜ 收事件：NapCat 的「HTTP 上报(httpClients)」POST 到我们监听的地址
 *   ➜ 发消息：我们 POST 到 NapCat 的「HTTP 服务(httpServers)」
 */
export function createHttpTransport({ cfg, log, onEvent, onControl, fetchImpl = globalThis.fetch }) {
  const { listenHost, listenPort, path: httpPath, accessToken } = cfg.onebot.http;
  const apiBase = cfg.onebot.api.baseUrl.replace(/\/+$/, '');
  const apiToken = cfg.onebot.api.accessToken;
  const timeoutMs = cfg.onebot.api.timeoutSeconds * 1000;

  let server = null;
  let received = 0;

  function tokenOk(req) {
    if (!accessToken) return true;
    const header = String(req.headers.authorization ?? '');
    if (header === `Bearer ${accessToken}`) return true;
    if (header === accessToken) return true;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.searchParams.get('access_token') === accessToken) return true;
    if (String(req.headers['x-access-token'] ?? '') === accessToken) return true;
    return false;
  }

  function readBody(req, limitBytes = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limitBytes) {
          reject(new Error('请求体过大'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === `${httpPath}/health`)) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, received, time: new Date().toISOString() }));
      return;
    }

    // 控制接口：让正在运行的实例立刻主动发一条（once.bat 用）
    if (req.method === 'POST' && (url.pathname === '/control/proactive' || url.pathname === `${httpPath}/control/proactive`)) {
      if (!tokenOk(req)) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, action: 'proactive' }));
      try {
        onControl?.('proactive');
      } catch (err) {
        log?.error('执行控制指令失败：', err);
      }
      return;
    }

    if (url.pathname !== httpPath) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'not found', hint: `上报地址应为 ${httpPath}` }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    if (!tokenOk(req)) {
      log?.warn('收到上报但 token 不匹配，已拒绝（检查 onebot.http.accessToken 与 NapCat 里的 secret 是否一致）');
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }

    let payload = null;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw);
    } catch (err) {
      log?.warn(`上报内容解析失败：${err.message}`);
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'bad json' }));
      return;
    }

    received += 1;
    // 先回 200，避免 NapCat 侧超时重发
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: null }));

    try {
      if (Array.isArray(payload)) payload.forEach((p) => onEvent?.(p));
      else onEvent?.(payload);
    } catch (err) {
      log?.error('处理事件时出错：', err);
    }
  }

  async function start() {
    if (server) return;
    server = http.createServer((req, res) => {
      handler(req, res).catch((err) => {
        log?.error('HTTP 上报处理异常：', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, listenHost, () => {
        server.off('error', reject);
        resolve();
      });
    });
    log?.info(`已监听 QQ 事件上报：http://${listenHost}:${listenPort}${httpPath}`);
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }

  async function call(action, params = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'content-type': 'application/json' };
      if (apiToken) headers.authorization = `Bearer ${apiToken}`;
      const res = await fetchImpl(`${apiBase}/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, params, echo: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 下面统一报错 */
      }
      if (!res.ok) throw new Error(`调用 ${action} 失败：HTTP ${res.status} ${text.slice(0, 200)}`);
      if (json && json.status && json.status !== 'ok' && json.retcode !== 0) {
        throw new Error(`调用 ${action} 失败：${json.status}/${json.retcode} ${json.message ?? ''} ${json.wording ?? ''}`);
      }
      return json ?? { raw: text };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'http',
    start,
    stop,
    call,
    describe: () => `HTTP 上报 http://${listenHost}:${listenPort}${httpPath} → API ${apiBase}`,
  };
}
