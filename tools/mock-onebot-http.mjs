#!/usr/bin/env node
/**
 * 假 NapCat：用来在没有 QQ 的机器上端到端验证程序。
 *
 *   node tools/mock-onebot-http.mjs [--port 3000] [--bot http://127.0.0.1:8787/onebot] [--token change-me-please]
 *                                   [--from 10001] [--say "在吗"] [--auto] [--interval 8000]
 *
 * 行为：
 *   1. 起一个假的 OneBot HTTP 服务（默认 3000），实现 get_login_info / send_private_msg，并把收到的消息打印出来；
 *   2. 默认启动 2 秒后模拟「对方」发一条私聊消息，把事件 POST 到程序的上报地址；
 *   3. --auto 会每 --interval 毫秒自动发一条，方便观察主动发言是否生效。
 */
import http from 'node:http';
import process from 'node:process';

function parseArgs(argv) {
  const args = {
    port: 3000,
    bot: 'http://127.0.0.1:8787/onebot',
    token: 'change-me-please',
    from: 10001,
    say: '在吗',
    auto: false,
    interval: 8000,
    nickname: '测试用户',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--bot') args.bot = argv[++i];
    else if (a === '--token') args.token = argv[++i];
    else if (a === '--from') args.from = Number(argv[++i]);
    else if (a === '--say') args.say = argv[++i];
    else if (a === '--auto') args.auto = true;
    else if (a === '--interval') args.interval = Number(argv[++i]);
    else if (a === '--nickname') args.nickname = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const stamp = () => new Date().toLocaleTimeString('zh-CN');

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* 忽略 */
  }
  const action = (req.url ?? '/').replace(/^\//, '');

  if (action === 'send_private_msg' || action === 'send_msg') {
    const segs = json?.params?.message;
    const text = Array.isArray(segs) ? segs.map((s) => s?.data?.text ?? `[${s?.type}]`).join('') : String(segs ?? '');
    console.log(`[${stamp()}] 💬 机器人 → ${json?.params?.user_id}：${text}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: Math.floor(Math.random() * 1e6) }, echo: json?.echo }));
    return;
  }

  if (action === 'get_login_info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 999999, nickname: '假机器人' }, echo: json?.echo }));
    return;
  }

  if (action === 'set_friend_add_request') {
    console.log(`[${stamp()}] 🤝 好友申请处理：${JSON.stringify(json?.params)}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: null, echo: json?.echo }));
    return;
  }

  console.log(`[${stamp()}] ❓ 收到未知动作 ${action}：${body.slice(0, 200)}`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', retcode: 0, data: null, echo: json?.echo }));
});

let seq = 1;

async function postEvent(payload, { attempts = 15, gapMs = 1000 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(args.bot, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${args.token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
      console.log(`[${stamp()}] ⚠️ 上报失败：HTTP ${res.status}（第 ${i}/${attempts} 次）`);
    } catch (err) {
      console.log(`[${stamp()}] ⚠️ 上报失败：${err.cause?.code ?? err.message}（第 ${i}/${attempts} 次，等程序起来）`);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, gapMs));
  }
  console.log(`[${stamp()}] ❌ 上报始终失败，请确认程序已启动：${args.bot}`);
  return false;
}

function makeEvent(text) {
  return {
    time: Math.floor(Date.now() / 1000),
    self_id: 999999,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: 100000 + seq++,
    user_id: args.from,
    raw_message: text,
    font: 14,
    sender: { user_id: args.from, nickname: args.nickname, sex: 'unknown', age: 0 },
    message: [{ type: 'text', data: { text } }],
  };
}

server.listen(args.port, '127.0.0.1', async () => {
  console.log(`假 NapCat 已启动：http://127.0.0.1:${args.port}`);
  console.log(`上报目标：${args.bot}（token: ${args.token}）`);
  console.log(`模拟用户：${args.nickname}（${args.from}）`);
  console.log('按 Ctrl+C 退出。\n');

  setTimeout(async () => {
    console.log(`[${stamp()}] 👤 对方 → 机器人：${args.say}`);
    await postEvent(makeEvent(args.say));
  }, 2000);

  if (args.auto) {
    setInterval(async () => {
      const text = `自动测试消息 ${seq}`;
      console.log(`[${stamp()}] 👤 对方 → 机器人：${text}`);
      await postEvent(makeEvent(text));
    }, args.interval);
  }
});

process.on('SIGINT', () => {
  console.log('\n假 NapCat 退出');
  server.close();
  process.exit(0);
});
