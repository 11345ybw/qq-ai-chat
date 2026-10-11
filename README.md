# qq-ai-chat · 在 QQ 里和 AI 角色聊天，她还会在你沉默时主动找你

一个**零依赖**（只用 Node 内置模块，不需要 `npm install`）的小程序：

- 你在 QQ 里**私聊**一个机器人 QQ 号 → 它用大模型（默认 DeepSeek）扮演你写的角色回你；
- 你**不说话** → 过了设定时间它会自己发消息找你，会撒娇、会腹黑地抱怨你冷落她，连续几条没被理就安静下来等你；
- 它记得你们的聊天记录，回复会像真人一样**拆成 1~3 条短消息**、带打字延迟；
- 默认人设：**时崎狂三**（在 `persona.md` 里，随时可换）。

> **第一次配置？直接看 [`配置流程.md`](配置流程.md)** —— 从装 Node 到它主动找你，一条龙照着做，每步都写了"看到什么算过"和出错怎么办。
>
> 谁在跑？QQ + NapCat 需要跑在一台能登录 QQ 的机器上（Windows 服务器即可）。
> 全新服务器部署的细节见 **[`deploy/README-SERVER.md`](deploy/README-SERVER.md)**。

---

## 从 GitHub 克隆后，只需要做三件事

```bat
git clone <本仓库地址> qq-ai-chat
cd qq-ai-chat

:: 1. 装便携 Node（免管理员，不动系统 PATH）
install-node.bat

:: 2. 填模型 key：复制 secrets.example.json 为 secrets.json，填进去
::    （想用免费档就先运行 switch-model.bat 选 glm）
copy secrets.example.json secrets.json

:: 3. 自检 → 启动（config.json 会在第一次运行时自动生成）
check.bat
start.bat
```

QQ / NapCat 那半边的安装与配置（装 QQ、装 NapCat、扫码登录、开 OneBot 通道）全部写在
[`配置流程.md`](配置流程.md) 的 §1–§5，**每一步都给了「一键脚本」和「手动操作」两条路**。

> 仓库里**不含** `config.json` / `secrets.json`（密钥永不入库），也不含聊天记录与日志。


---

## 30 秒了解结构

```
qq-ai-chat/
├─ persona.md            角色设定卡（改这里就能换人设，不用动代码）
├─ topics.md             她"主动开口"时的话题灵感
├─ config.example.json   所有可调参数的默认值（会被复制成 config.json）
├─ secrets.example.json  放 API key 的模板（复制成 secrets.json）
├─ start.bat             启动
├─ switch-model.bat      换模型（列出预设，输个 id 就行）
├─ check.bat             自检（模型 + QQ 连接一起测）
├─ once.bat              立刻让她主动发一条（测试主动发言）
├─ start-dryrun.bat      演练模式：全部照跑但不真的发消息
├─ stop.bat              停止
├─ install-node.bat      装便携版 Node（不用管理员）
├─ install-autostart.bat 开机自启（计划任务）
├─ run-bot.ps1           守护运行（崩溃自动重启）
├─ src/                  程序本体（约 1300 行，全部带中文注释）
├─ tests/                48 个测试，其中一个是"假 QQ + 假模型"的端到端测试
├─ tools/                假 NapCat / 假模型，用来在没 QQ 的机器上验证
└─ deploy/               服务器部署：文档 + NapCat 自动化脚本
    ├─ README-SERVER.md   ★ 新服务器从零到跑通（先看这个）
    ├─ install-napcat.bat 自动下载安装 NapCat
    ├─ setup-napcat.bat   自动配好 OneBot 通道（不用手点 WebUI）
    └─ providers.md       换模型、免费额度、常见报错对照
```

## 数据流

```
你的 QQ ──发消息──▶ 机器人 QQ（NapCat 注入 QQ NT）
                        │  OneBot 11
            ┌───────────┴────────────┐
            │  HTTP 上报  → 8787     │  收到你的消息
            │  HTTP 接口  ← 3000     │  发送她的回复
            └───────────┬────────────┘
                        ▼
                  qq-ai-chat ──HTTP──▶ 大模型接口（DeepSeek 等）
                        │
                        ├─ data/history/<QQ号>.jsonl   聊天记录
                        ├─ data/state.json             沉默计时/主动计数
                        └─ logs/bot-YYYYMMDD.log       运行日志
```

## 本地跑通（不用真 QQ）

只要三个终端，就能在**任何一台装了 Node 18+ 的电脑**上验证全部逻辑：

```bash
# 终端 1：假模型（假装是 DeepSeek，返回固定台词）
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify({choices:[{message:{content:'{\"messages\":[\"啊啦~啊啦~\"]}'}}]}))})}).listen(19999)"

# 终端 2：假 QQ（假装是 NapCat，会模拟"你"发一条消息，并打印她发出的每条消息）
node tools/mock-onebot-http.mjs --port 3000 --bot http://127.0.0.1:8787/onebot --token change-me-please

# 终端 3：把它当成真的在跑
node src/index.mjs --dry-run     # 演练模式：只打印"本该发送"的内容
```

想跑真实模型：填好 `secrets.json` 后执行 `node src/index.mjs --ai-test "在吗"`。

## 换模型只要一条命令

```bat
start.bat --providers        :: 看内置的服务商预设（智谱 GLM / 通义千问 / 硅基流动 / 豆包 / 混元 / Kimi / 本地 Ollama …）
start.bat --provider glm     :: 一键切过去，然后填 secrets.json，再跑 check.bat
start.bat --provider glm --model glm-4-flash   :: 顺便指定模型名
```

选哪家、怎么注册、遇到 401/429/模型名过期怎么办，都写在 **[`deploy/providers.md`](deploy/providers.md)**。
程序会自动处理两件烦人的事：服务商不支持 `json_object` 时**自动降级**重试；限流时**自动退避重试**。


## 测试

```bash
node --test          # 38 个用例，约 4 秒
```

包含调度逻辑（免打扰跨零点、退避、连发上限）、文本清洗与拆分、上下文裁剪、
配置校验，以及一个**端到端**用例：起假 QQ API + 假模型 + 真 HTTP 接入，
投递一条私聊事件 → 断言收到两条回复 → 断言沉默到点后主动发了一条 → 断言重复消息/群消息被忽略。

## 主要可调项（`config.json`）

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `proactive.enabled` | `true` | 主动发言总开关 |
| `proactive.idleSeconds` | `300` | 你沉默多久她开口（回话后复位；连续没回应会按 `backoffMultiplier` 逐渐拉长到 `maxIdleSeconds`） |
| `proactive.maxConsecutive` | `3` | 最多连续主动几条，之后安静等你 |
| `proactive.quietHours` | `["23:30","07:30"]` | 免打扰时段（跨零点也行，`null` = 全天可发） |
| `proactive.jitterPercent` | `15` | 时间抖动，避免"每次都精确 5 分钟"的机械感 |
| `reply.maxBubbles` | `3` | 一次最多拆成几条消息 |
| `reply.maxBubbleChars` | `60` | 单条消息最长字数 |
| `reply.typingMsPerChar` | `45` | 模拟打字速度（毫秒/字） |
| `reply.maxContextMessages` | `30` | 带多少条历史给模型 |
| `ai.model` | `deepseek-flash` | 换模型只改这一行，或用 `--provider` 一键切换 |
| `target.qq` | `null` | 聊天对象；`null` = 自动记住第一个私聊它的人 |
| `target.name` | `null` | 她在台词里怎么称呼你（填了就固定用这个，否则用你 QQ 昵称） |

## 合规与风险提示

- 第三方协议登录 QQ 属于灰色地带，**存在被腾讯限制登录的极小概率**，请用**小号**当机器人，别用主号。
- 默认节奏已经很克制（5 分钟才主动一次、最多连发 3 条、夜间免打扰），不建议把 `idleSeconds` 调到几十秒。
- 角色扮演内容请自行把握；程序默认在系统提示里禁止露骨内容。

## 维护约定（改代码前先看这条）

Windows 中文环境下有两条硬规矩，踩了就会"在仓库里好好的，解压后就报错"：

1. **`.bat` 里不许出现中文**（必须纯 ASCII）。
   cmd.exe 按系统 ANSI 代码页（中文系统是 GBK/936）读 `.bat`，UTF-8 的中文会被读成乱码，
   而 `chcp 65001` 中途切换还会让 cmd 的读取位置错位，把一行拆成几条不存在的命令去执行
   （典型症状：`'t]' is not recognized as an internal or external command`）。
   → 所以 `.bat` 只负责"找 Node、传参数、pause"，中文提示交给 Node / PowerShell 输出（它们不受代码页影响）。
2. **`.ps1` 必须存成 UTF-8 带 BOM**。
   Windows PowerShell 5.1 会把没有 BOM 的 `.ps1` 当 ANSI 读，中文报警告、甚至把引号读坏导致语法错误。
3. **`.json` 可以带 BOM**：程序读取时会自动剥掉（`stripBom`），用记事本改配置也不会崩。

发版前跑一次：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-release.ps1
```

它会：检查 `.bat` 是否纯 ASCII → 给 `.ps1` 补 BOM → **密钥扫描** → 跑全部测试
→ 打包 zip（排除 `config.json`/`secrets.json`/`data`/`logs`/`.runtime`）
→ **解压到临时目录、装上便携 Node、真实执行一次 `start.bat --status`**，确认"解压后也能跑"。

### 密钥永远不会进仓库

三道闸：

1. `.gitignore` 屏蔽 `config.json`、`secrets.json`、`data/`、`logs/`、`.runtime/`
2. `scripts/check-secrets.ps1` 扫描项目里所有文本文件，发现 `sk-<24+ 位>` 这种"像真 key"的字符串就**拒绝打包并退出 1**
   （测试用的假 key 带 `testonly` / `fake` 之类字样即可放行；`prepare-release.ps1` 已内置这一步）
3. CI（`.github/workflows/test.yml`）每次 push 都跑全部测试

真 key 只放在 `secrets.json`（本地文件，不入库），或者用环境变量 `DEEPSEEK_API_KEY`。

### 改了代码之后怎么发版

```bash
# 1. 本地：跑门禁（编码检查 + 密钥扫描 + 测试 + 打包含冒烟测试）
powershell -ExecutionPolicy Bypass -File scripts\prepare-release.ps1

# 2. 提交并推送
git add -A
git commit -m "说明这次改了什么"
git push

# 3. 想发一个版本快照（可选）
git tag v1.4.0 && git push --tags
```


