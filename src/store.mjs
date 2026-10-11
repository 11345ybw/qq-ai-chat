import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, readJsonSafe, writeJsonAtomic } from './util.mjs';

export const EMPTY_STATE = {
  targetQQ: null,
  targetName: null,
  selfQQ: null,
  lastUserAt: 0,
  lastBotAt: 0,
  lastProactiveAt: 0,
  lastProactiveAttemptAt: 0,
  consecutiveProactive: 0,
  proactiveFailures: 0,
  currentIdleMs: null,
  everUserMessage: false,
  totalUserMessages: 0,
  totalBotMessages: 0,
  lastMessageId: null,
  startedAt: 0,
};

/**
 * 状态与聊天记录。
 *  - data/state.json          运行状态（主动发言计数、目标 QQ、时间戳）
 *  - data/history/<qq>.jsonl  与某个人的聊天记录（每行一条）
 *  - data/bot.lock            单实例锁，避免手滑开两个导致双倍回复
 */
export class Store {
  constructor({ root, dataDir = 'data' }) {
    this.root = root;
    this.dataDir = path.isAbsolute(dataDir) ? dataDir : path.join(root, dataDir);
    this.historyDir = path.join(this.dataDir, 'history');
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.lockFile = path.join(this.dataDir, 'bot.lock');
    this.state = { ...EMPTY_STATE };
  }

  ensure() {
    ensureDir(this.dataDir);
    ensureDir(this.historyDir);
  }

  load() {
    this.ensure();
    const loaded = readJsonSafe(this.stateFile, null);
    this.state = { ...EMPTY_STATE, ...(loaded || {}) };
    return this.state;
  }

  save(patch = null) {
    if (patch) Object.assign(this.state, patch);
    this.ensure();
    writeJsonAtomic(this.stateFile, this.state);
    return this.state;
  }

  historyFile(qq) {
    return path.join(this.historyDir, `${qq}.jsonl`);
  }

  appendHistory(qq, entry) {
    this.ensure();
    const line = JSON.stringify({ t: Date.now(), ...entry });
    fs.appendFileSync(this.historyFile(qq), `${line}\n`, 'utf8');
  }

  /** 读取最近 limit 条（按时间正序返回） */
  readHistory(qq, limit = 100) {
    const file = this.historyFile(qq);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const picked = limit > 0 ? lines.slice(-limit) : lines;
    const out = [];
    for (const line of picked) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* 跳过坏行 */
      }
    }
    return out;
  }

  /** 只回看最近 maxSeconds 秒内的记录，太久远的对话不再作为上下文 */
  readRecentHistory(qq, limit, maxAgeSeconds) {
    const items = this.readHistory(qq, limit);
    if (!maxAgeSeconds) return items;
    const cutoff = Date.now() - maxAgeSeconds * 1000;
    const fresh = items.filter((it) => (it.t ?? 0) >= cutoff);
    return fresh.length ? fresh : [];
  }

  clearHistory(qq) {
    const file = this.historyFile(qq);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }

  /** 单实例锁；进程活着就拒绝启动 */
  acquireLock() {
    this.ensure();
    if (fs.existsSync(this.lockFile)) {
      const info = readJsonSafe(this.lockFile, null);
      const pid = info?.pid;
      if (pid && pid !== process.pid && isProcessAlive(pid)) {
        return { ok: false, pid, startedAt: info?.startedAt ?? null };
      }
    }
    writeJsonAtomic(this.lockFile, { pid: process.pid, startedAt: Date.now() });
    return { ok: true };
  }

  releaseLock() {
    try {
      const info = readJsonSafe(this.lockFile, null);
      if (!info || info.pid === process.pid) fs.rmSync(this.lockFile, { force: true });
    } catch {
      /* 忽略 */
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}
