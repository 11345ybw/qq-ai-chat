import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** 0..1 随机数，可注入用于测试 */
export function randomBetween(min, max, rand = Math.random) {
  return min + (max - min) * rand();
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 掩码显示密钥，日志里永远不要出现完整 key */
export function maskSecret(secret) {
  if (!secret) return '(未设置)';
  const s = String(secret);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)} (长度 ${s.length})`;
}

export function nowStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function dateStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

/** 原子写文件：先写临时文件再 rename，避免断电/中断写坏配置与状态 */
export function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** 去掉 UTF-8 BOM：Windows 记事本存出来的 JSON 常带 BOM，JSON.parse 会直接报错 */
export function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

export function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch {
    return fallback;
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
