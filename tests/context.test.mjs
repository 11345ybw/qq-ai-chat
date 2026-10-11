import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChatMessages, historyRecap } from '../src/context.mjs';

const history = [
  { role: 'user', text: '你好' },
  { role: 'assistant', text: '啊啦~啊啦~' },
  { role: 'user', text: '在干嘛' },
  { role: 'assistant', text: '在想你哦' },
];

test('buildChatMessages 保留系统提示词并映射角色', () => {
  const msgs = buildChatMessages({ systemPrompt: 'SYS', history });
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
  assert.equal(msgs.at(-1).content, '在想你哦');
});

test('buildChatMessages 按条数截取最近的', () => {
  const msgs = buildChatMessages({ systemPrompt: 'SYS', history, maxMessages: 2 });
  assert.equal(msgs.length, 3);
  assert.equal(msgs[1].content, '在干嘛');
});

test('buildChatMessages 超字数时从最旧的开始丢', () => {
  const long = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(100) }));
  const msgs = buildChatMessages({ systemPrompt: 'SYS', history: long, maxMessages: 10, maxChars: 350 });
  const body = msgs.slice(1);
  assert.ok(body.reduce((n, m) => n + m.content.length, 0) <= 350);
  assert.ok(body.length >= 1);
});

test('buildChatMessages 保证首条是 user', () => {
  const msgs = buildChatMessages({ systemPrompt: 'SYS', history: [{ role: 'assistant', text: '只有我' }, { role: 'assistant', text: '还有我' }] });
  assert.equal(msgs.length, 1);
});

test('historyRecap 用你我标注角色', () => {
  const recap = historyRecap(history, { maxMessages: 2 });
  assert.match(recap, /^他：在干嘛/);
  assert.match(recap, /你：在想你哦/);
});

test('historyRecap 限制总字数', () => {
  const long = Array.from({ length: 50 }, () => ({ role: 'user', text: 'y'.repeat(50) }));
  assert.ok(historyRecap(long, { maxMessages: 50, maxChars: 200 }).length <= 200);
});
