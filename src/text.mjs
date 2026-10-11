import { clamp } from './util.mjs';

/** 去掉 markdown 痕迹与客服腔 */
export function sanitizeBubble(input) {
  let s = String(input ?? '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/^\s*[-*•]\s+/gm, '');
  s = s.replace(/^\s*\d+[.、)]\s+/gm, '');
  s = s.replace(/[*_`>#]/g, '');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/[\u200b-\u200d\ufeff]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^["“”'']+|["“”'']+$/g, '').trim();
  return s;
}

/** 把超长文本按中文标点切成若干段，尽量每段不超过 maxLen */
export function splitLongText(text, maxLen) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  if (s.length <= maxLen) return [s];

  const rough = s.split(/(?<=[。！？!?…；;，,、\n])/u).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = '';
  for (const piece of rough) {
    if (!buf) {
      buf = piece;
    } else if (buf.length + piece.length <= maxLen) {
      buf += piece;
    } else {
      out.push(buf);
      buf = piece;
    }
    while (buf.length > maxLen) {
      out.push(buf.slice(0, maxLen));
      buf = buf.slice(maxLen);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 把模型输出规整成要连发的气泡数组。
 * 接受：字符串、字符串数组、{messages:[...]}、JSON 字符串。
 */
export function toBubbles(raw, { maxBubbles = 3, maxBubbleChars = 60 } = {}) {
  let items = [];

  const push = (v) => {
    if (typeof v === 'string') items.push(v);
    else if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === 'object') {
      for (const key of ['messages', 'message', 'text', 'content', 'reply']) {
        if (key in v) {
          push(v[key]);
          return;
        }
      }
    }
  };

  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed = null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }
    if (parsed !== null) push(parsed);
    else push(trimmed);
  } else {
    push(raw);
  }

  const cleaned = [];
  for (const item of items) {
    const s = sanitizeBubble(item);
    if (!s) continue;
    for (const piece of splitLongText(s, maxBubbleChars)) {
      if (piece) cleaned.push(piece);
    }
  }

  if (cleaned.length <= maxBubbles) return cleaned;

  // 条数超了：前面的保留，剩下的并进最后一条，避免丢内容
  const head = cleaned.slice(0, Math.max(1, maxBubbles - 1));
  const tail = cleaned.slice(Math.max(1, maxBubbles - 1)).join(' ');
  const hardCap = Math.max(maxBubbleChars, maxBubbleChars * 3);
  head.push(tail.length > hardCap ? `${tail.slice(0, hardCap - 1)}…` : tail);
  return head.filter(Boolean);
}

/** 模拟打字时间的毫秒数 */
export function typingDelayMs(text, { typingMsPerChar = 45, maxTypingDelayMs = 1800 } = {}, rand = Math.random) {
  const base = String(text ?? '').length * typingMsPerChar;
  const jitter = 0.75 + rand() * 0.5;
  return Math.round(clamp(base * jitter, 120, maxTypingDelayMs));
}

/** 去掉 OneBot 字符串消息里的 CQ 码，只留纯文本 */
export function stripCqCodes(text) {
  return String(text ?? '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 OneBot 的 message 字段（字符串或数组）里取纯文本 */
export function extractText(message) {
  if (message === null || message === undefined) return '';
  if (typeof message === 'string') return stripCqCodes(message);
  if (Array.isArray(message)) {
    const parts = [];
    for (const seg of message) {
      if (!seg || typeof seg !== 'object') continue;
      if (seg.type === 'text' && seg.data?.text) parts.push(String(seg.data.text));
      else if (seg.type === 'image') parts.push('[图片]');
      else if (seg.type === 'face') parts.push('[表情]');
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** 只保留有意义的文字：纯图片/表情消息返回空串（由调用方决定忽略） */
export function meaningfulText(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  if (/^(\[图片\]|\[表情\]|\s)+$/.test(s)) return '';
  return s;
}
