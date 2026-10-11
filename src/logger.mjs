import fs from 'node:fs';
import path from 'node:path';

import { dateStamp, ensureDir, nowStamp } from './util.mjs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\u001b[90m', info: '\u001b[36m', warn: '\u001b[33m', error: '\u001b[31m', reset: '\u001b[0m' };

/**
 * 极简日志：控制台带颜色，文件按天切分（logs/bot-YYYYMMDD.log）。
 */
export function createLogger({ level = 'info', dir = null, console = true, prefix = '' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  let filePath = null;

  if (dir) {
    ensureDir(dir);
    filePath = path.join(dir, `bot-${dateStamp()}.log`);
  }

  function write(lvl, args) {
    if ((LEVELS[lvl] ?? LEVELS.info) < threshold) return;
    const text = args
      .map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    const line = `${nowStamp()} [${lvl.toUpperCase().padEnd(5)}] ${prefix}${text}`;

    if (console) {
      const color = COLORS[lvl] ?? '';
      const reset = process.stdout.isTTY ? COLORS.reset : '';
      process.stdout.write(`${process.stdout.isTTY ? color : ''}${line}${reset}\n`);
    }
    if (filePath) {
      try {
        fs.appendFileSync(filePath, `${line}\n`, 'utf8');
      } catch {
        /* 日志写不进去不能影响主流程 */
      }
    }
  }

  return {
    level,
    filePath,
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    child: (childPrefix) => createLogger({ level, dir, console, prefix: `${prefix}${childPrefix}` }),
  };
}

export function createNullLogger() {
  const noop = () => {};
  return { level: 'error', filePath: null, debug: noop, info: noop, warn: noop, error: noop, child: () => createNullLogger() };
}
