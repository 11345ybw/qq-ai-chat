import { sleep } from '../util.mjs';

/**
 * OneBot 11 · 正向 WebSocket 接入（可选方式）
 * 我们是客户端，连到 NapCat 的「WebSocket 服务」上；
 * 需要 Node 22+ 才有内置 WebSocket，Node 18/20 用户请用 http 模式。
 */
export function createWsTransport({ cfg, log, onEvent }) {
  const { url, accessToken, reconnectSeconds } = cfg.onebot.ws;
  const timeoutMs = cfg.onebot.api.timeoutSeconds * 1000;

  let ws = null;
  let stopped = false;
  let echoSeq = 0;
  let reconnectTimer = null;
  let backoffMs = reconnectSeconds * 1000;
  const pending = new Map();
  let connected = false;

  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('当前 Node 没有内置 WebSocket（需要 Node 22+）。请把 onebot.mode 改成 "http"，或升级 Node。');
  }

  function buildUrl() {
    if (!accessToken) return url;
    const u = new URL(url);
    u.searchParams.set('access_token', accessToken);
    return u.toString();
  }

  function scheduleReconnect(reason) {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    log?.warn(`${reason}，${Math.round(backoffMs / 1000)} 秒后重连…`);
    reconnectTimer = setTimeout(() => {
      backoffMs = Math.min(backoffMs * 1.6, 60000);
      connect();
    }, backoffMs);
  }

  function connect() {
    if (stopped) return;
    let socket;
    try {
      socket = new WebSocket(buildUrl());
    } catch (err) {
      scheduleReconnect(`建立连接失败：${err.message}`);
      return;
    }
    ws = socket;

    socket.addEventListener('open', () => {
      connected = true;
      backoffMs = reconnectSeconds * 1000;
      log?.info(`已连接到 OneBot：${url}`);
    });

    socket.addEventListener('message', (event) => {
      let data = null;
      try {
        data = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        log?.debug('收到非 JSON 的 WS 消息，已忽略');
        return;
      }
      if (data && data.echo && pending.has(data.echo)) {
        const { resolve, reject, timer } = pending.get(data.echo);
        clearTimeout(timer);
        pending.delete(data.echo);
        if (data.status && data.status !== 'ok' && data.retcode !== 0) {
          reject(new Error(`OneBot 返回失败：${data.status}/${data.retcode} ${data.message ?? data.wording ?? ''}`));
        } else {
          resolve(data);
        }
        return;
      }
      try {
        onEvent?.(data);
      } catch (err) {
        log?.error('处理事件时出错：', err);
      }
    });

    socket.addEventListener('close', () => {
      connected = false;
      for (const [key, item] of pending) {
        clearTimeout(item.timer);
        item.reject(new Error('连接已断开'));
        pending.delete(key);
      }
      scheduleReconnect('与 OneBot 的连接断开');
    });

    socket.addEventListener('error', () => {
      log?.debug('WebSocket 出错');
    });
  }

  async function start() {
    stopped = false;
    connect();
    await sleep(300);
  }

  async function stop() {
    stopped = true;
    clearTimeout(reconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    }
    ws = null;
  }

  function call(action, params = {}) {
    if (!ws || !connected) return Promise.reject(new Error('OneBot 连接尚未就绪'));
    const echo = `e${++echoSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(echo);
        reject(new Error(`调用 ${action} 超时（${timeoutMs} ms）`));
      }, timeoutMs);
      pending.set(echo, { resolve, reject, timer });
      ws.send(JSON.stringify({ action, params, echo }));
    });
  }

  return {
    kind: 'ws',
    start,
    stop,
    call,
    describe: () => `WebSocket 客户端 → ${url}`,
    isConnected: () => connected,
  };
}
