#!/usr/bin/env node
/**
 * 假模型接口：假装自己是 DeepSeek（OpenAI 兼容），返回固定台词。
 *   node tools/mock-ai.mjs [--port 19999]
 * 收到带"主动发一句"的请求时返回主动语气的台词，方便观察主动发言链路。
 */
import http from 'node:http';
import process from 'node:process';

let port = 19999;
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--port') port = Number(process.argv[i + 1]);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const stamp = () => new Date().toLocaleTimeString('zh-CN');

    if ((req.url ?? '').startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model' }] }));
      return;
    }

    let json = {};
    try {
      json = JSON.parse(body);
    } catch {
      /* 忽略 */
    }
    const last = json?.messages?.at(-1)?.content ?? '';
    const proactive = last.includes('主动发一句');
    const content = proactive
      ? JSON.stringify({ messages: ['啊啦~啊啦~，突然有点想你了呢。'] })
      : JSON.stringify({ messages: ['啊啦~啊啦~', '你终于想起来我了？我可是等了很久哦。'] });

    console.log(`[${stamp()}] 🤖 模型请求（${json.messages?.length ?? 0} 条上下文，${proactive ? '主动发言' : '回复'}）→ ${content}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock',
        model: 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    );
  });
});

server.listen(port, '127.0.0.1', () => console.log(`假模型接口已启动：http://127.0.0.1:${port}`));
