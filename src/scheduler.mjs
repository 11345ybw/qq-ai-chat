/**
 * 主动发言调度。核心决策写成纯函数，方便测试。
 */

export function parseHM(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** 是否处于免打扰时段（支持跨零点，如 23:30-07:30） */
export function inQuietHours(date, quietHours) {
  if (!Array.isArray(quietHours) || quietHours.length !== 2) return false;
  const from = parseHM(quietHours[0]);
  const to = parseHM(quietHours[1]);
  if (from === null || to === null) return false;
  const now = minutesOfDay(date);
  if (from === to) return false;
  if (from < to) return now >= from && now < to;
  return now >= from || now < to;
}

/** 免打扰结束的时刻（用于算出下一次该什么时候再看） */
export function quietHoursEnd(date, quietHours) {
  if (!Array.isArray(quietHours) || quietHours.length !== 2) return null;
  const to = parseHM(quietHours[1]);
  if (to === null) return null;
  const end = new Date(date);
  end.setSeconds(0, 0);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end.getTime() <= date.getTime() || !inQuietHours(date, quietHours)) {
    if (end.getTime() <= date.getTime()) end.setDate(end.getDate() + 1);
  }
  return end;
}

/**
 * 该不该主动发消息？
 * @returns {{action:'send'|'wait', reason:string, waitMs:number}}
 */
export function decideProactive(state, cfg, now = new Date(), opts = {}) {
  const rand = opts.rand ?? Math.random;
  const checkMs = cfg.checkIntervalSeconds * 1000;

  if (!cfg.enabled) return { action: 'wait', reason: '主动发言已关闭', waitMs: checkMs };
  if (cfg.onlyAfterUserMessage && !state.everUserMessage) {
    return { action: 'wait', reason: '对方还没发过消息，不主动打扰', waitMs: checkMs };
  }
  if (inQuietHours(now, cfg.quietHours)) {
    const end = quietHoursEnd(now, cfg.quietHours);
    const waitMs = end ? Math.max(checkMs, end.getTime() - now.getTime()) : checkMs;
    return { action: 'wait', reason: `免打扰时段（${cfg.quietHours.join(' ~ ')}）`, waitMs };
  }

  const idleMs = state.currentIdleMs ?? cfg.idleSeconds * 1000;
  const jitter = 1 + (rand() * 2 - 1) * (cfg.jitterPercent / 100);
  const threshold = idleMs * jitter;
  const since = now.getTime() - (state.lastUserAt || 0);
  if (since < threshold) {
    return { action: 'wait', reason: `距上次对话 ${Math.round(since / 1000)}s / 阈值 ${Math.round(threshold / 1000)}s`, waitMs: Math.min(Math.max(threshold - since, 500), checkMs) };
  }

  if (cfg.stopAfterMax && state.consecutiveProactive >= cfg.maxConsecutive) {
    return { action: 'wait', reason: `已连发 ${state.consecutiveProactive} 条没被回复，先安静等他`, waitMs: checkMs };
  }
  const sinceAttempt = now.getTime() - (state.lastProactiveAttemptAt || 0);
  // 连续失败时把重试间隔逐步拉长（模型挂了就别每 20 秒打一次）
  const failMultiplier = 1 + Math.min(state.proactiveFailures || 0, 8);
  const attemptGapMs = cfg.minSecondsBetweenAnyMessage * 1000 * failMultiplier;
  if (sinceAttempt < attemptGapMs) {
    return {
      action: 'wait',
      reason: `刚刚尝试过主动发言（连续失败 ${state.proactiveFailures || 0} 次），${Math.round((attemptGapMs - sinceAttempt) / 1000)} 秒后再试`,
      waitMs: attemptGapMs - sinceAttempt,
    };
  }
  const sinceBot = now.getTime() - (state.lastBotAt || 0);
  if (sinceBot < cfg.minSecondsBetweenAnyMessage * 1000) {
    return { action: 'wait', reason: '刚发过消息，稍微缓一下', waitMs: cfg.minSecondsBetweenAnyMessage * 1000 - sinceBot };
  }
  return { action: 'send', reason: '他沉默够久了', waitMs: 0 };
}

/** 每次尝试主动发言（无论成败）都记一下时间，失败时不要 20 秒一次地打模型接口 */
export function applyProactiveAttempt(state, now = new Date()) {
  state.lastProactiveAttemptAt = now.getTime();
  return state;
}

/** 主动发言失败：累计失败次数，用于拉长重试间隔 */
export function applyProactiveFailure(state, now = new Date()) {
  state.lastProactiveAttemptAt = now.getTime();
  state.proactiveFailures = (state.proactiveFailures || 0) + 1;
  return state;
}

/** 成功发出主动消息后更新状态（原地修改并返回） */
export function applyProactiveSent(state, cfg, now = new Date()) {
  state.consecutiveProactive = (state.consecutiveProactive || 0) + 1;
  state.lastProactiveAttemptAt = now.getTime();
  state.proactiveFailures = 0;
  const current = state.currentIdleMs ?? cfg.idleSeconds * 1000;
  state.currentIdleMs = Math.min(Math.round(current * cfg.backoffMultiplier), cfg.maxIdleSeconds * 1000);
  state.lastBotAt = now.getTime();
  state.lastProactiveAt = now.getTime();
  state.totalBotMessages = (state.totalBotMessages || 0) + 1;
  return state;
}

/** 收到对方消息后更新状态：计数清零、阈值复位 */
export function applyUserMessage(state, cfg, now = new Date()) {
  state.lastUserAt = now.getTime();
  state.everUserMessage = true;
  state.consecutiveProactive = 0;
  state.proactiveFailures = 0;
  state.currentIdleMs = cfg.idleSeconds * 1000;
  state.totalUserMessages = (state.totalUserMessages || 0) + 1;
  return state;
}

/** 机器人自己回复完之后 */
export function applyBotReply(state, now = new Date()) {
  state.lastBotAt = now.getTime();
  state.totalBotMessages = (state.totalBotMessages || 0) + 1;
  return state;
}
