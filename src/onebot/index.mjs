import { createHttpTransport } from './http.mjs';
import { createWsTransport } from './ws.mjs';

export function createTransport({ cfg, log, onEvent, onControl }) {
  if (cfg.onebot.mode === 'ws') return createWsTransport({ cfg, log, onEvent });
  return createHttpTransport({ cfg, log, onEvent, onControl });
}

/** 发私聊消息：用消息段数组，避免文本里的方括号被当成 CQ 码 */
export function textSegment(text) {
  return [{ type: 'text', data: { text: String(text) } }];
}

export async function sendPrivateMessage(transport, userId, text) {
  return transport.call('send_private_msg', {
    user_id: Number(userId),
    message: textSegment(text),
    auto_escape: false,
  });
}

export async function sendGroupMessage(transport, groupId, text) {
  return transport.call('send_group_msg', {
    group_id: Number(groupId),
    message: textSegment(text),
    auto_escape: false,
  });
}

export async function getLoginInfo(transport) {
  const res = await transport.call('get_login_info', {});
  return res?.data ?? res;
}
