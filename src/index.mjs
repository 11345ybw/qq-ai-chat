#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createAi } from './ai.mjs';
import { createChat } from './chat.mjs';
import { ConfigError, loadConfig, resolveApiKey, resolvePath } from './config.mjs';
import { createLogger } from './logger.mjs';
import { loadPersonaContent } from './persona.mjs';
import { createTransport, getLoginInfo } from './onebot/index.mjs';
import { PROVIDERS, applyProviderPreset, providerTable } from './providers.mjs';
import { Store } from './store.mjs';
import { maskSecret, sleep, stripBom } from './util.mjs';

const HELP = `
qq-ai-chat —— 在 QQ 里和 AI 角色聊天，她还会在你沉默时主动找你

用法：
  node src/index.mjs                  正常启动
  node src/index.mjs --check          自检：配置、密钥、人设、OneBot 连接、模型可用性
  node src/index.mjs --ai-test [文本]  只测模型：用当前人设生成一次回复（不连 QQ）
  node src/index.mjs --once           立刻主动发一条（不等待沉默计时）
  node src/index.mjs --dry-run        演练模式：照常思考，但不真的发消息
  node src/index.mjs --status         打印当前状态与聊天对象
  node src/index.mjs --proactive on   打开主动发言（写回 config.json）
  node src/index.mjs --proactive off  关闭主动发言
  node src/index.mjs --providers      列出常见模型服务商预设（免费/便宜的都在里面）
  node src/index.mjs --provider glm   一键切换服务商（写入 config.json，随后填 secrets.json 即可）
  node src/index.mjs --config <路径>   指定配置文件
`;

function parseArgs(argv) {
  const args = { mode: 'run', configPath: null, text: null, proactive: null, provider: null, model: null };
  const rest = [...argv];
  while (rest.length) {
    const cur = rest.shift();
    if (cur === '--check' || cur === '--self-test') args.mode = 'check';
    else if (cur === '--dry-run') args.dryRun = true;
    else if (cur === '--ai-test') {
      args.mode = 'ai-test';
      args.text = rest.length && !rest[0].startsWith('--') ? rest.shift() : '在吗？';
    } else if (cur === '--once') args.mode = 'once';
    else if (cur === '--status') args.mode = 'status';
    else if (cur === '--providers') args.mode = 'providers';
    else if (cur === '--provider') args.provider = rest.shift();
    else if (cur === '--model') args.model = rest.shift();
    else if (cur === '--proactive') args.proactive = rest.shift();
    else if (cur === '--config') args.configPath = rest.shift();
    else if (cur === '--help' || cur === '-h') args.mode = 'help';
    else if (!cur.startsWith('--') && !args.text) args.text = cur;
  }
  return args;
}

function buildContext(args) {
  const { cfg, configPath, root, created } = loadConfig({ configPath: args.configPath });
  const logsDir = resolvePath(root, cfg.paths.logsDir);
  const log = createLogger({ level: cfg.logging.level, dir: logsDir, console: cfg.logging.console !== false });
  if (created) log.info(`已根据 config.example.json 生成配置文件：${configPath}`);
  const persona = loadPersonaContent({
    root,
    personaFile: cfg.paths.personaFile,
    topicsFile: cfg.paths.topicsFile,
  });
  const { key: apiKey, source: apiKeySource } = resolveApiKey(cfg, root);
  const store = new Store({ root, dataDir: cfg.paths.dataDir });
  store.load();
  return { cfg, configPath, root, log, persona, apiKey, apiKeySource, store };
}

/** 401 时给出"key 和接口不是一家"的猜测——这种错误最容易让人卡住 */
function keyMismatchHints(cfg, apiKey) {
  const base = cfg.ai.baseUrl;
  const looksSk = /^sk-/.test(apiKey);
  const isGlm = /bigmodel\.cn/.test(base);
  const hints = [];
  if (isGlm && looksSk) {
    hints.push('看起来是把 DeepSeek 的 key 填给了智谱 GLM 的接口 —— GLM 的 key 形如 xxxx.xxxx，不以 sk- 开头。');
    hints.push('要么去 open.bigmodel.cn 申请一把 GLM 的 key，要么执行 --provider deepseek 把接口切回 DeepSeek。');
  } else if (!isGlm && !looksSk) {
    hints.push('这把 key 不是 sk- 开头，而当前接口通常用 sk- 开头的 key —— 可能填成了别家的。');
  } else {
    hints.push(`当前接口是 ${base}，确认 secrets.json 里填的是【这家】的 key：换服务商时 key 必须跟着换。`);
  }
  hints.push('另外注意：config.json 里的 ai.apiKey 优先级高于 secrets.json，切换服务商时别留旧值。');
  return hints;
}

async function cmdCheck(ctx, args) {
  const { cfg, configPath, root, log, persona, apiKey, apiKeySource, store } = ctx;
  const line = (k, v) => console.log(`  ${k.padEnd(22, ' ')} ${v}`);
  const todo = [];   // 收集"下一步该做什么"，最后统一打印

  console.log('\n=== 环境 ===');
  line('Node 版本', process.version);
  line('项目目录', root);
  line('配置文件', configPath);
  line('数据目录', store.dataDir);
  line('日志目录', log.filePath ? path.dirname(log.filePath) : '(未写文件)');
  line('人设文件', persona.personaPath);
  line('人设长度', `${persona.persona.length} 字`);
  line('话题种子', `${persona.topics.length} 条`);

  console.log('\n=== 接入方式 ===');
  line('模式', cfg.onebot.mode);
  line('chatType', cfg.onebot.chatType);
  line('API 钥匙', maskSecret(apiKey));
  line('钥匙来源', apiKeySource);
  line('模型', cfg.ai.model);
  line('模型接口', cfg.ai.baseUrl);
  const preset = PROVIDERS.find((p) => p.baseUrl.replace(/\/+$/, '') === cfg.ai.baseUrl.replace(/\/+$/, ''));
  line('服务商', preset ? preset.label : '(自定义，不在预设列表里)');

  console.log('\n=== 主动发言 ===');
  line('开关', cfg.proactive.enabled ? '开启' : '关闭');
  line('沉默阈值', `${cfg.proactive.idleSeconds} 秒（回话后复位，连发会退避到 ${cfg.proactive.maxIdleSeconds} 秒）`);
  line('免打扰', cfg.proactive.quietHours ? cfg.proactive.quietHours.join(' ~ ') : '不设');
  line('连发上限', `${cfg.proactive.maxConsecutive} 条${cfg.proactive.stopAfterMax ? '（超过就等你回话）' : ''}`);
  line('聊天对象', cfg.target.qq ?? store.state.targetQQ ?? '(等他先发一条消息)');

  let ok = true;

  console.log('\n=== 模型连通性 ===');
  if (!apiKey) {
    console.log(`  ✗ 没有可用的 API Key（${apiKeySource}）`);
    console.log(`    解决办法：把 ${path.join(root, 'secrets.example.json')} 复制成 ${path.join(root, 'secrets.json')}`);
    console.log('    然后填上你自己的 key：{"deepseekApiKey":"sk-..."}');
    console.log('    想用免费的就先双击 switch-model.bat 选一家（例如 glm），再去那家官网申请 key。');
    todo.push({ area: 'model', text: '还没填 API Key：复制 secrets.example.json 为 secrets.json 并填上 key（或用 switch-model.bat 换一家再申请）' });
    ok = false;
  } else {
    if (/credentials\.yaml$/.test(apiKeySource)) {
      console.log(`  ! 注意：钥匙来自 ${apiKeySource}`);
      console.log('    这是本机以前留下的 key，很可能已经失效（会报 401）。建议把项目里的 secrets.json 填上自己的 key。');
      todo.push({ area: 'model', text: '钥匙来源是 ~/.dsh/.credentials.yaml（本机旧 key，多半已失效）→ 在项目里的 secrets.json 填一把自己的 key' });
      ok = false;
    }
    const ai = createAi({ cfg, apiKey, log });
    try {
      const models = await ai.listModels();
      console.log(`  ✓ 接口可用，可用模型：${models.join(', ') || '(接口没返回列表)'}`);
      if (models.length && !models.includes(cfg.ai.model)) {
        console.log(`  ! 当前配置的模型 "${cfg.ai.model}" 不在列表里`);
        console.log(`      改 config.json 的 ai.model（例如 "${models[0]}"），或执行 start.bat --provider <服务商> --model <模型名>`);
        todo.push({ area: 'model', text: `ai.model 填成 "${cfg.ai.model}" 了，这家没有这个模型 → 改成 "${models[0]}"` });
        ok = false;
      }
      let balanceOk = true;
      if (/api\.deepseek\.com/.test(cfg.ai.baseUrl) && typeof ai.getBalance === 'function') {
        const bal = await ai.getBalance();
        if (bal) {
          balanceOk = bal.available !== false && Number(bal.total ?? 0) > 0;
          console.log(`  余额：${bal.total ?? '?'} ${bal.currency}（赠送 ${bal.granted ?? 0} / 充值 ${bal.toppedUp ?? 0}）${balanceOk ? '' : '  ← 没钱了，聊天会返回 402，需要先充值'}`);
          if (!balanceOk) {
            todo.push({
              area: 'model',
              text: 'DeepSeek 余额是 0 → 去 platform.deepseek.com 充值；不想充就双击 switch-model.bat 选 glm（智谱 flash 免费档）',
            });
            ok = false;
          }
        }
      }
      const res = await ai.reply({
        messages: [
          { role: 'system', content: '只输出 JSON {"messages":["..."]}' },
          { role: 'user', content: '用五个字说一句中文' },
        ],
      });
      console.log(`  ✓ 试生成成功：${res.bubbles.join(' / ')}`);
    } catch (err) {
      console.log(`  ✗ 试生成失败：${err.message}`);
      if (err?.status === 401) {
        for (const hint of keyMismatchHints(cfg, apiKey)) console.log(`    ${hint}`);
        todo.push({ area: 'model', text: `key 无效（401）→ 确认 secrets.json 里的 key 属于 ${cfg.ai.baseUrl} 这一家（换服务商必须换 key）` });
      } else if (err?.status === 402) {
        if (!todo.some((t) => t.area === 'model' && /余额|没钱/.test(t.text))) {
          todo.push({ area: 'model', text: '账户余额不足（402）→ 充值，或 switch-model.bat 换成有免费额度的服务商' });
        }
      } else {
        todo.push({ area: 'model', text: `模型调用失败：${err.message}` });
      }
      ok = false;
    }
  }

  console.log('\n=== QQ 连接（OneBot） ===');
  const probe = createTransport({ cfg, log, onEvent: () => {} });
  try {
    if (probe.start) await probe.start();
    await sleep(cfg.onebot.mode === 'ws' ? 1500 : 300);
    const info = await getLoginInfo(probe);
    console.log(`  ✓ ${probe.describe()}`);
    console.log(`  ✓ 已登录 QQ：${info.nickname ?? '?'}（${info.user_id ?? '?'}）`);
  } catch (err) {
    const code = err?.cause?.code ?? '';
    console.log(`  ✗ 连不上：${err.message}${code ? `（${code}）` : ''}`);
    if (code === 'ECONNREFUSED') {
      console.log(`    原因：${cfg.onebot.api.baseUrl} 上没有人在监听 —— NapCat 没启动，或没登录成功。`);
      console.log('    做法：双击 deploy\\start-napcat.bat 启动 QQ+NapCat（用机器人小号扫码登录）');
      console.log('          登录成功后双击 deploy\\setup-napcat.bat 把通道配好，再重启 NapCat');
      todo.push({ area: 'qq', text: 'NapCat 没在运行 → 双击 deploy\\start-napcat.bat，用机器人小号登录；再双击 deploy\\setup-napcat.bat，重启 NapCat，最后重跑 check.bat' });
    } else if (code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      console.log(`    原因：连不上 ${cfg.onebot.api.baseUrl}，检查 config.json 里 onebot.api.baseUrl 是否写错、端口是否被防火墙挡了`);
      todo.push({ area: 'qq', text: `连不上 ${cfg.onebot.api.baseUrl} → 检查 config.json 的 onebot.api.baseUrl 和防火墙` });
    } else {
      console.log('    排查：NapCat/QQ 是否已启动？onebot.api.baseUrl 与 token 是否和 NapCat 里配的一致？');
      todo.push({ area: 'qq', text: `QQ 连接失败：${err.message} → 确认 NapCat 已登录，且 config.json 的 token 与 NapCat 里配的一致` });
    }
    ok = false;
  } finally {
    await probe.stop();
  }

  console.log('\n=== 下一步 ===');
  if (todo.length) {
    todo.forEach((t, i) => console.log(`  ${i + 1}. ${t.text}`));
    console.log('  解决后重跑 check.bat，直到上面全部是 ✓。');
  } else {
    console.log('  1. 双击 start.bat 启动机器人');
    console.log('  2. 用另一个 QQ 号加它好友，发一句「在吗」，1~3 秒内应该收到 1~3 条回复');
    console.log('  3. 双击 once.bat 立刻验证「沉默时主动开口」（不用等 5 分钟）');
    console.log('  4. 想改人设：编辑 persona.md；想改黏人程度：config.json 的 proactive.*');
    console.log('  5. 想让它开机自启：双击 install-autostart.bat');
  }
  console.log(`\n结论：${ok ? '✅ 全部通过' : `❌ 还有 ${todo.length} 件事要做（见上面的「下一步」）`}`);
  console.log('完整配置流程见 配置流程.md\n');
  return ok ? 0 : 1;
}

async function cmdAiTest(ctx, args) {
  const { cfg, log, persona, apiKey, store } = ctx;
  if (!apiKey) throw new Error('没有找到 DeepSeek API key（secrets.json / 环境变量 DEEPSEEK_API_KEY）');
  const ai = createAi({ cfg, apiKey, log });
  const otherQQ = cfg.target.qq ?? store.state.targetQQ;
  const history = otherQQ ? store.readHistory(otherQQ, 10) : [];
  const { buildChatMessages } = await import('./context.mjs');
  const { buildSystemPrompt } = await import('./persona.mjs');
  const messages = buildChatMessages({
    systemPrompt: buildSystemPrompt({ persona: persona.persona, speakerName: store.state.targetName }),
    history,
    maxMessages: cfg.reply.maxContextMessages,
    maxChars: cfg.reply.maxContextChars,
  });
  messages.push({ role: 'user', content: args.text ?? '在吗？' });
  console.log(`\n你：${args.text ?? '在吗？'}`);
  let res;
  try {
    res = await ai.reply({ messages });
  } catch (err) {
    console.log(`\n✗ 没能生成回复：${err.message}`);
    if (err.body) console.log(`  接口原话：${String(err.body).slice(0, 200)}`);
    console.log('\n提示：换一家有免费额度的服务商可以马上跑起来 —— 双击 switch-model.bat，或执行 --provider glm\n');
    return 1;
  }
  for (const b of res.bubbles) console.log(`狂三：${b}`);
  console.log('');
  return 0;
}

async function cmdStatus(ctx) {
  const { cfg, store, configPath } = ctx;
  const s = store.state;
  const ts = (v) => (v ? new Date(v).toLocaleString('zh-CN') : '(无)');
  console.log('\n=== 状态 ===');
  console.log(`  配置文件        ${configPath}`);
  console.log(`  聊天对象        ${cfg.target.qq ?? s.targetQQ ?? '(未确定)'}${s.targetName ? ` (${s.targetName})` : ''}`);
  console.log(`  机器人自己      ${s.selfQQ ?? cfg.onebot.selfQQ ?? '(未知，连上 NapCat 后自动识别)'}`);
  console.log(`  上次对方消息    ${ts(s.lastUserAt)}`);
  console.log(`  上次发消息      ${ts(s.lastBotAt)}`);
  console.log(`  连续主动条数    ${s.consecutiveProactive ?? 0} / ${cfg.proactive.maxConsecutive}`);
  console.log(`  当前沉默阈值    ${Math.round((s.currentIdleMs ?? cfg.proactive.idleSeconds * 1000) / 1000)} 秒`);
  console.log(`  累计消息        对方 ${s.totalUserMessages ?? 0} 条 / 机器人 ${s.totalBotMessages ?? 0} 条`);
  if (s.targetQQ) {
    const file = store.historyFile(s.targetQQ);
    console.log(`  聊天记录        ${file}${fs.existsSync(file) ? '' : '（还没有）'}`);
  }
  console.log('');
  return 0;
}

function cmdProviders() {
  console.log('\n可用的服务商预设（全部是 OpenAI 兼容接口）：\n');
  for (const p of providerTable()) {
    console.log(`  ${p.id.padEnd(12, ' ')} ${p.label}`);
    console.log(`  ${' '.repeat(12)} 接口 ${p.baseUrl}`);
    console.log(`  ${' '.repeat(12)} 模型 ${p.model}${p.jsonMode ? '（支持 json 模式）' : '（普通文本模式）'}`);
    console.log('');
  }
  console.log('切换方式：node src/index.mjs --provider <上面的 id>，然后填 secrets.json，再跑 --check\n');
  return 0;
}

function cmdSetProvider(ctx, id, modelOverride) {
  const { configPath } = ctx;
  const raw = JSON.parse(stripBom(fs.readFileSync(configPath, 'utf8')));
  const res = applyProviderPreset(raw, id, { model: modelOverride });
  if (!res) {
    console.log(`\n没有这个预设：${id}`);
    console.log(`可用的有：${PROVIDERS.map((p) => p.id).join(', ')}`);
    console.log('也可以用 --providers 看完整说明。\n');
    return 2;
  }
  fs.writeFileSync(configPath, `${JSON.stringify(res.config, null, 2)}\n`, 'utf8');
  const { preset } = res;
  console.log(`\n已切换服务商：${preset.label}`);
  console.log(`  接口  ${preset.baseUrl}`);
  console.log(`  模型  ${res.config.ai.model}`);
  console.log(`  json模式 ${res.config.ai.jsonMode ? '开' : '关（该家不支持，已自动关掉）'}`);
  console.log(`\n接下来：`);
  if (preset.noKey) {
    console.log(`  1) 本机装好后直接跑 check.bat（不需要 key）`);
  } else {
    console.log(`  1) 去 ${preset.keyUrl} 申请 API Key`);
    console.log(`  2) 把 key 填进 secrets.json： {"deepseekApiKey":"你的key"}`);
  }
  console.log(`  ${preset.noKey ? '2' : '3'}) 跑 check.bat —— 它会列出这家真实可用的模型名`);
  if (preset.note) console.log(`\n提示：${preset.note}`);
  console.log('');
  return 0;
}

function cmdProactive(ctx, value) {
  const { cfg, configPath } = ctx;
  if (!['on', 'off'].includes(value)) {
    console.log('用法：--proactive on  或  --proactive off');
    return 2;
  }
  const raw = JSON.parse(stripBom(fs.readFileSync(configPath, 'utf8')));
  raw.proactive = raw.proactive ?? {};
  raw.proactive.enabled = value === 'on';
  fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  console.log(`已把 ${configPath} 里的 proactive.enabled 设为 ${value === 'on' ? 'true（开启）' : 'false（关闭）'}${cfg ? '，重启程序后生效' : ''}`);
  return 0;
}

async function cmdRun(ctx, args) {
  const { cfg, root, log, persona, apiKey, store } = ctx;
  if (!apiKey) {
    throw new Error('没有找到 DeepSeek API key：请在 secrets.json 里填 {"deepseekApiKey":"sk-..."}，或设置环境变量 DEEPSEEK_API_KEY');
  }

  // --once：如果已经有一个实例在跑（http 模式），直接让它发，别去抢端口/抢锁
  if (args.mode === 'once' && cfg.onebot.mode === 'http') {
    const { listenHost, listenPort, accessToken } = cfg.onebot.http;
    const url = `http://${listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost}:${listenPort}/control/proactive`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      });
      if (res.ok) {
        log.info(`检测到已经有实例在运行，已通知它立刻发一条（${url}）。去看它的窗口/日志即可。`);
        return 0;
      }
      log.warn(`正在运行的实例拒绝了控制指令（HTTP ${res.status}），检查 config.json 的 onebot.http.accessToken 是否与它一致。`);
      return 1;
    } catch {
      log.debug('没有检测到正在运行的实例，这次自己发一条。');
    }
  }

  if (cfg.proactive.enabled && !args.dryRun && args.mode !== 'once') {
    const lock = store.acquireLock();
    if (!lock.ok) {
      log.error(`已经有一个机器人进程在跑（PID ${lock.pid}）。想重开请先关掉它，或删掉 ${store.lockFile}`);
      return 1;
    }
  }

  const ai = createAi({ cfg, apiKey, log });

  let chatRef = null;
  const transport = createTransport({
    cfg,
    log,
    onEvent: (evt) => chatRef?.onEvent(evt),
    onControl: (cmd) => chatRef?.handleControl(cmd),
  });
  const chat = createChat({ cfg, log, ai, store, persona, dryRun: !!args.dryRun, transport });
  chatRef = chat;

  try {
    await transport.start();
  } catch (err) {
    log.error(`接入 OneBot 失败：${err.message}`);
    store.releaseLock();
    return 1;
  }

  try {
    const info = await getLoginInfo(transport);
    store.save({ selfQQ: info?.user_id ?? null });
    log.info(`已连接 QQ：${info?.nickname ?? '?'}（${info?.user_id ?? '未知'}）`);
  } catch (err) {
    log.warn(`暂时拿不到登录信息（${err.message}）。若 NapCat 还没启动，启动后会自动恢复。`);
  }

  chat.start();

  const shutdown = async (signal) => {
    log.info(`收到 ${signal}，正在退出…`);
    chat.stop();
    store.releaseLock();
    try {
      await transport.stop();
    } catch {
      /* 忽略 */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.info(`机器人已启动（${args.dryRun ? '演练模式，不会真的发消息' : '正常运行'}）`);
  log.info(`聊天对象：${cfg.target.qq ?? store.state.targetQQ ?? '等他先发第一条消息'}`);
  if (cfg.onebot.mode === 'http') log.info(`健康检查：http://${cfg.onebot.http.listenHost}:${cfg.onebot.http.listenPort}/health`);

  if (args.mode === 'once') {
    log.info('立刻主动发一条（--once）…');
    if (!chat.targetQQ()) {
      log.error('还不知道要发给谁：让对方先给机器人发一条消息，或在 config.json 里填 target.qq');
      chat.stop();
      store.releaseLock();
      await transport.stop();
      return 1;
    }
    await chat.proactive({ force: true });
    await sleep(500);
    chat.stop();
    store.releaseLock();
    await transport.stop();
    return 0;
  }

  await new Promise(() => {});
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') {
    console.log(HELP);
    return 0;
  }
  let ctx;
  try {
    ctx = buildContext(args);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n配置有问题：\n  ${err.message}\n`);
      return 2;
    }
    console.error(`\n启动失败：${err.message}\n`);
    return 2;
  }

  if (args.mode === 'check') return cmdCheck(ctx, args);
  if (args.mode === 'ai-test') return cmdAiTest(ctx, args);
  if (args.mode === 'status') return cmdStatus(ctx);
  if (args.mode === 'providers') return cmdProviders();
  if (args.provider) return cmdSetProvider(ctx, args.provider, args.model);
  if (args.proactive) return cmdProactive(ctx, args.proactive);
  try {
    return await cmdRun(ctx, args);
  } catch (err) {
    ctx.log.error(err.message);
    return 2;
  }
}

main()
  .then((code) => {
    if (code && code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    if (err?.name === 'AiError' || err?.name === 'ConfigError') {
      console.error(`\n✗ ${err.message}\n`);
      process.exitCode = 2;
      return;
    }
    console.error(`\n未处理的错误：${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
