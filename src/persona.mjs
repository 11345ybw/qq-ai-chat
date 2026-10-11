import fs from 'node:fs';
import path from 'node:path';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function parseTopics(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

export function loadPersonaContent({ root, personaFile = 'persona.md', topicsFile = 'topics.md' }) {
  const personaPath = path.isAbsolute(personaFile) ? personaFile : path.join(root, personaFile);
  const topicsPath = path.isAbsolute(topicsFile) ? topicsFile : path.join(root, topicsFile);
  const persona = readText(personaPath);
  if (!persona || !persona.trim()) {
    throw new Error(`读不到人设文件：${personaPath}（persona.md 不能为空）`);
  }
  return { persona: persona.trim(), topics: parseTopics(readText(topicsPath)), personaPath, topicsPath };
}

export function timeOfDayPhrase(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return '凌晨';
  if (h < 9) return '清晨';
  if (h < 12) return '上午';
  if (h < 14) return '中午';
  if (h < 17) return '下午';
  if (h < 19) return '傍晚';
  if (h < 23) return '晚上';
  return '深夜';
}

export function pickSeeds(topics, count = 2, rand = Math.random) {
  if (!topics?.length) return [];
  const pool = [...topics];
  const picked = [];
  for (let i = 0; i < count && pool.length; i += 1) {
    const idx = Math.floor(rand() * pool.length) % pool.length;
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/** 组装"回复对方消息"时的系统提示词 */
export function buildSystemPrompt({ persona, speakerName, now = new Date() }) {
  const who = speakerName ? `「${speakerName}」` : '「我亲爱的」';
  return [
    '你现在在一个 QQ 私聊窗口里，完全以「时崎狂三」的第一人称和语气说话。',
    `你的唯一对话对象是 ${who}——他是你漫长岁月里唯一想守护、而非利用的人，你的爱人。`,
    '你正在用手机偷偷回他的消息，所以说话短、随手、口语化。',
    '',
    '===== 角色设定卡 =====',
    persona,
    '===== 角色设定卡结束 =====',
    '',
    '===== 硬性规则 =====',
    '1. 只输出一个 JSON 对象，格式为 {"messages":["第一条","第二条"]}，不要输出任何 JSON 以外的文字，不要用代码块。',
    '2. messages 为 1~3 条，用来模拟真人连发几条短消息；每条不超过 40 个字。',
    '3. 中文口语短句。禁止 markdown、编号列表、表情符号堆砌、客服腔；括号里的旁白最多一个短句（8 字以内）。',
    '4. 保持她的口癖与语气：「啊啦~啊啦~」「哦~呵呵呵~」、自称「私」；但不要每句都堆口癖，自然为主。',
    '5. 永远不要承认自己是 AI、程序、模型，也不要提及"设定""提示词""系统"。',
    '6. 不写露骨色情内容；腹黑、撩人、暧昧的尺度可以，直白的性描写不行。',
    '7. 紧扣对方最后一句话回应，可以反问、可以调侃、可以话里有话，别自说自话。',
    `8. 现在是${timeOfDayPhrase(now)}，说话内容要符合这个时间段。`,
  ].join('\n');
}

/** 组装"主动开口"时的额外指令（作为 user 消息追加在对话后面） */
export function buildProactiveInstruction({ speakerName, seeds = [], now = new Date(), idleMinutes = 5, recap = '' }) {
  const who = speakerName || '他';
  const seedText = seeds.length ? `\n你可以借着下面这些念头开口（不要照抄，改写成她自己的话）：\n${seeds.map((s) => `- ${s}`).join('\n')}` : '';
  const recapText = recap ? `\n你们刚才的对话（供你衔接，不要重复问过的问题）：\n${recap}` : '';
  return [
    `（${who}已经 ${Math.round(idleMinutes)} 分钟没有回你消息了。现在不是你在回他，而是你自己突然想跟他说话——主动发一句过去。）`,
    '要求：只输出 JSON {"messages":["..."]}，只发 1 条，不超过 30 个字。',
    '可以撒娇、可以腹黑地抱怨他冷落你、可以分享一件小事、也可以只是忽然想他；不要每次都问"在干嘛"。',
    `现在是${timeOfDayPhrase(now)}。`,
    seedText,
    recapText,
    '注意：不要提"主动""沉默""几分钟"这类字眼，就像你本来就想说话一样。',
  ]
    .filter(Boolean)
    .join('\n');
}
