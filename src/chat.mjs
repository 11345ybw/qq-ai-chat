import { buildChatMessages, historyRecap } from './context.mjs';
import { sendPrivateMessage } from './onebot/index.mjs';
import { buildProactiveInstruction, buildSystemPrompt, pickSeeds } from './persona.mjs';
import { applyBotReply, applyProactiveAttempt, applyProactiveFailure, applyProactiveSent, applyUserMessage, decideProactive } from './scheduler.mjs';
import { extractText, meaningfulText, typingDelayMs } from './text.mjs';
import { sleep } from './util.mjs';

/**
 * 会话编排：收到消息就回；沉默够了就主动开口。
 */
export function createChat({ cfg, log, ai, transport, store, persona, dryRun = false, now = () => new Date(), rand = Math.random }) {
  const seenMessageIds = new Set();
  let busy = false;
  let dirty = false;
  let tickTimer = null;
  let stopped = false;
  let tickCount = 0;

  function state() {
    return store.state;
  }

  function targetQQ() {
    return cfg.target.qq ?? state().targetQQ;
  }

  function speakerName() {
    // config.json 里填了 target.name 就用它，否则用对方 QQ 昵称
    return cfg.target.name || state().targetName || null;
  }

  function systemPrompt(date = now()) {
    return buildSystemPrompt({ persona: persona.persona, speakerName: speakerName(), now: date });
  }

  function history(limit) {
    const qq = targetQQ();
    if (!qq) return [];
    return store.readHistory(qq, limit);
  }

  async function sendBubbles(bubbles, { reason }) {
    const qq = targetQQ();
    if (!qq) {
      log?.warn('还没有确定聊天对象（等对方先发一条消息，或在 config.json 里填 target.qq）');
      return 0;
    }
    let sent = 0;
    for (const bubble of bubbles) {
      if (stopped) break;
      const delay = typingDelayMs(bubble, cfg.reply, rand);
      log?.debug(`思考 ${delay}ms 后发送：${bubble}`);
      await sleep(delay);
      try {
        if (dryRun) {
          log?.info(`[演练模式] 本该发送给 ${qq}：${bubble}`);
        } else {
          await sendPrivateMessage(transport, qq, bubble);
          log?.info(`→ 发送给 ${qq}：${bubble}`);
        }
        store.appendHistory(qq, { role: 'assistant', text: bubble, reason });
        sent += 1;
        applyBotReply(state(), now());
      } catch (err) {
        log?.error(`发送失败：${err.message}`);
        break;
      }
      if (bubbles.length > 1) await sleep(cfg.reply.minBubbleGapMs);
    }
    store.save();
    return sent;
  }

  async function respond() {
    if (!targetQQ()) return;
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    try {
      do {
        dirty = false;
        const recent = history(Math.max(cfg.reply.maxContextMessages * 2, 60));
        const messages = buildChatMessages({
          systemPrompt: systemPrompt(),
          history: recent.slice(-cfg.reply.maxContextMessages),
          maxMessages: cfg.reply.maxContextMessages,
          maxChars: cfg.reply.maxContextChars,
        });
        if (messages.length <= 1) {
          log?.debug('没有可回复的上下文，跳过');
          break;
        }
        log?.debug(`请求模型回复（上下文 ${messages.length - 1} 条）`);
        let bubbles;
        try {
          const res = await ai.reply({ messages });
          bubbles = res.bubbles;
          if (res.usage) log?.debug(`tokens: prompt=${res.usage.prompt_tokens ?? '?'} completion=${res.usage.completion_tokens ?? '?'}`);
        } catch (err) {
          log?.error(`生成回复失败：${err.message}${err.body ? ` | ${err.body}` : ''}`);
          break;
        }
        await sendBubbles(bubbles, { reason: 'reply' });
        if (cfg.reply.cooldownSeconds > 0) await sleep(cfg.reply.cooldownSeconds * 1000);
      } while (dirty && !stopped);
    } finally {
      busy = false;
    }
  }

  async function proactive({ force = false } = {}) {
    const qq = targetQQ();
    if (!qq) return false;
    const date = now();
    applyProactiveAttempt(state(), date);
    store.save();

    const recent = history(cfg.reply.maxContextMessages);
    if (!recent.length && cfg.proactive.onlyAfterUserMessage && !force) {
      log?.debug('还没有任何聊天记录，先不主动开口');
      return false;
    }
    const seeds = pickSeeds(persona.topics, 2, rand);
    const idleMinutes = Math.max(1, Math.round((date.getTime() - (state().lastUserAt || date.getTime())) / 60000));
    const instruction = buildProactiveInstruction({
      speakerName: speakerName(),
      seeds,
      now: date,
      idleMinutes,
      recap: historyRecap(recent, { maxMessages: 8, maxChars: 400 }),
    });

    const messages = [
      ...buildChatMessages({
        systemPrompt: systemPrompt(date),
        history: recent.slice(-12),
        maxMessages: 12,
        maxChars: Math.min(cfg.reply.maxContextChars, 3000),
      }),
      { role: 'user', content: instruction },
    ];

    log?.info(`他 ${idleMinutes} 分钟没回话了，让她主动开口…`);
    let bubbles;
    try {
      const res = await ai.reply({ messages });
      bubbles = res.bubbles.slice(0, 1);
    } catch (err) {
      log?.error(`生成主动消息失败：${err.message}${err.body ? ` | ${err.body}` : ''}`);
      applyProactiveFailure(state(), date);
      store.save();
      return false;
    }
    const sent = await sendBubbles(bubbles, { reason: 'proactive' });
    if (sent > 0) {
      applyProactiveSent(state(), cfg.proactive, date);
      store.save();
      log?.info(`已主动发送 ${sent} 条（连续第 ${state().consecutiveProactive} 条）`);
      return true;
    }
    // 发不出去（比如 NapCat 挂了）也算一次失败，拉长下次重试间隔，别死循环轰炸
    applyProactiveFailure(state(), date);
    store.save();
    return false;
  }

  function tick() {
    if (stopped) return { action: 'wait', reason: '已停止', waitMs: 0 };
    const decision = decideProactive(state(), cfg.proactive, now(), { rand });
    tickCount += 1;
    if (decision.action === 'send') {
      proactive().catch((err) => log?.error('主动发言出错：', err));
    } else if (tickCount % 15 === 1) {
      log?.debug(`暂不主动发言：${decision.reason}`);
    }
    return decision;
  }

  function handleFriendRequest(evt) {
    if (!cfg.onebot.acceptFriendRequest) return;
    const flag = evt.flag;
    if (!flag) return;
    log?.info(`收到好友申请（${evt.user_id ?? '?'}，备注：${evt.comment ?? '无'}），自动同意`);
    transport
      .call('set_friend_add_request', { flag, approve: true })
      .catch((err) => log?.warn(`自动同意好友申请失败：${err.message}`));
  }

  function onEvent(evt) {
    if (!evt || typeof evt !== 'object') return;
    const type = evt.post_type;

    if (type === 'meta_event') {
      log?.debug(`meta_event: ${evt.meta_event_type}`);
      return;
    }
    if (type === 'request') {
      if (evt.request_type === 'friend' && evt.sub_type !== 'add') log?.debug('好友申请结果事件，忽略');
      else if (evt.request_type === 'friend') handleFriendRequest(evt);
      else log?.debug(`收到 request 事件：${evt.request_type}`);
      return;
    }
    if (type !== 'message') {
      log?.debug(`忽略事件类型：${type}`);
      return;
    }

    const messageType = evt.message_type ?? (evt.group_id ? 'group' : 'private');
    if (messageType !== cfg.onebot.chatType) {
      log?.debug(`忽略 ${messageType} 消息（当前只处理 ${cfg.onebot.chatType}）`);
      return;
    }

    const selfQQ = cfg.onebot.selfQQ ?? evt.self_id ?? state().selfQQ;
    const fromQQ = Number(evt.user_id ?? evt.sender?.user_id ?? 0);
    if (!fromQQ) return;
    if (selfQQ && fromQQ === Number(selfQQ)) {
      log?.debug('这是机器人自己发的消息，忽略');
      return;
    }
    if (fromQQ === Number(state().selfQQ ?? 0)) return;

    const msgId = evt.message_id != null ? String(evt.message_id) : null;
    if (msgId) {
      if (seenMessageIds.has(msgId)) {
        log?.debug(`重复消息 ${msgId}，忽略`);
        return;
      }
      seenMessageIds.add(msgId);
      if (seenMessageIds.size > 500) {
        const first = seenMessageIds.values().next().value;
        seenMessageIds.delete(first);
      }
    }

    const text = meaningfulText(extractText(evt.message ?? evt.raw_message ?? ''));
    if (!text) {
      log?.info(`收到 ${fromQQ} 的非文字消息（图片/表情等），暂时不会处理`);
      return;
    }

    const nick = evt.sender?.card || evt.sender?.nickname || null;

    if (!state().targetQQ) {
      store.save({ targetQQ: fromQQ, targetName: nick });
      log?.info(`已记住聊天对象：${nick ? `${nick}（${fromQQ}）` : fromQQ}`);
    } else if (Number(cfg.target.qq ?? state().targetQQ) !== fromQQ) {
      log?.info(`收到 ${fromQQ} 的消息，但当前只和 ${cfg.target.qq ?? state().targetQQ} 聊天，已忽略`);
      return;
    } else if (nick && nick !== state().targetName) {
      store.save({ targetName: nick });
    }

    log?.info(`← 收到 ${fromQQ}：${text}`);
    store.appendHistory(fromQQ, { role: 'user', text, messageId: msgId ?? undefined });
    applyUserMessage(state(), cfg.proactive, now());
    store.save();
    respond().catch((err) => log?.error('回复过程中出错：', err));
  }

  /** 外部控制入口：目前只有"立刻主动发一条"（once.bat / --once 用） */
  function handleControl(command) {
    if (command === 'proactive') {
      log?.info('收到控制指令：立刻主动发一条');
      proactive({ force: true }).catch((err) => log?.error('控制指令执行失败：', err));
      return true;
    }
    log?.debug(`收到未知控制指令：${command}`);
    return false;
  }

  function start() {
    const intervalMs = Math.max(1000, cfg.proactive.checkIntervalSeconds * 1000);
    tickTimer = setInterval(() => tick(), intervalMs);
    if (tickTimer.unref) tickTimer.unref();
    log?.info(`主动发言：${cfg.proactive.enabled ? `开启，沉默 ${Math.round((state().currentIdleMs ?? cfg.proactive.idleSeconds * 1000) / 1000)} 秒后开口` : '已关闭'}`);
  }

  function stop() {
    stopped = true;
    clearInterval(tickTimer);
  }

  return { onEvent, respond, proactive, tick, start, stop, state, targetQQ, speakerName, handleControl };
}
