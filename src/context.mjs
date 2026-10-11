/**
 * 上下文裁剪：把聊天记录变成发给模型的消息数组。
 * 规则：先按条数截取最近 N 条，再从最旧的开始丢，直到总字数不超过上限。
 */
export function buildChatMessages({ systemPrompt, history = [], maxMessages = 30, maxChars = 6000 }) {
  const mapped = history
    .filter((h) => h && typeof h.text === 'string' && h.text.trim())
    .map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text.trim() }));

  const trimmed = mapped.slice(-Math.max(1, maxMessages));

  let total = trimmed.reduce((n, m) => n + m.content.length, 0);
  while (trimmed.length > 1 && total > maxChars) {
    const dropped = trimmed.shift();
    total -= dropped.content.length;
  }

  // 对话必须以 user 开头（部分接口对此敏感）
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();

  return [{ role: 'system', content: systemPrompt }, ...trimmed];
}

/** 给"主动开口"用的一小段对话回顾（纯文本，短） */
export function historyRecap(history = [], { maxMessages = 8, maxChars = 400 } = {}) {
  const items = history.filter((h) => h && h.text).slice(-maxMessages);
  const lines = items.map((h) => `${h.role === 'user' ? '他' : '你'}：${h.text.replace(/\s+/g, ' ').trim()}`);
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(-maxChars);
  return text;
}
