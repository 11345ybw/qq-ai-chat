import assert from 'node:assert/strict';
import test from 'node:test';

import { extractText, meaningfulText, sanitizeBubble, splitLongText, toBubbles, typingDelayMs } from '../src/text.mjs';

test('sanitizeBubble 去掉 markdown 与项目符号', () => {
  assert.equal(sanitizeBubble('**啊啦~**'), '啊啦~');
  assert.equal(sanitizeBubble('- 第一句'), '第一句');
  assert.equal(sanitizeBubble('1. 第二句'), '第二句');
  assert.equal(sanitizeBubble('“带引号的话”'), '带引号的话');
  assert.equal(sanitizeBubble('```json\n{"a":1}\n```'), '');
});

test('splitLongText 按标点切分且不丢内容', () => {
  const out = splitLongText('第一句话。第二句话！第三句话？', 6);
  assert.ok(out.length >= 2);
  assert.equal(out.join(''), '第一句话。第二句话！第三句话？');
});

test('toBubbles 解析 JSON 输出', () => {
  assert.deepEqual(toBubbles('{"messages":["啊啦~啊啦~","你终于回我了呢"]}'), ['啊啦~啊啦~', '你终于回我了呢']);
  assert.deepEqual(toBubbles(['一', '二']), ['一', '二']);
  assert.deepEqual(toBubbles({ messages: '单条' }), ['单条']);
});

test('toBubbles 条数超上限时合并尾巴而不是丢内容', () => {
  const out = toBubbles('{"messages":["a","b","c","d","e"]}', { maxBubbles: 3, maxBubbleChars: 200 });
  assert.equal(out.length, 3);
  assert.equal(out[2], 'c d e');
});

test('toBubbles 处理不是 JSON 的纯文本', () => {
  const out = toBubbles('啊啦~啊啦~，今天过得怎么样呢？我可是很想你呢。', { maxBubbles: 3, maxBubbleChars: 12 });
  assert.ok(out.length >= 2);
  assert.ok(out.every((b) => b.length <= 24));
});

test('typingDelayMs 在上下限之间', () => {
  const cfg = { typingMsPerChar: 45, maxTypingDelayMs: 1800 };
  for (const rand of [0, 0.5, 1]) {
    const ms = typingDelayMs('你好呀', cfg, () => rand);
    assert.ok(ms >= 120 && ms <= 1800, `ms=${ms}`);
  }
  assert.equal(typingDelayMs('很长的一段话'.repeat(100), cfg, () => 1), 1800);
});

test('extractText 处理字符串、数组与 CQ 码', () => {
  assert.equal(extractText('你好[CQ:face,id=1]呀'), '你好呀');
  assert.equal(extractText([{ type: 'text', data: { text: '在吗' } }, { type: 'image', data: {} }]), '在吗 [图片]');
  assert.equal(extractText(null), '');
});

test('meaningfulText 过滤纯图片消息', () => {
  assert.equal(meaningfulText('[图片]'), '');
  assert.equal(meaningfulText('  [表情] '), '');
  assert.equal(meaningfulText('在的'), '在的');
});
