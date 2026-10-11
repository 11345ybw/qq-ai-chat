# 换模型：一条命令，谁便宜/快就用谁

本项目对模型只有三个要求：**OpenAI 兼容接口**、**能聊中文**、**够便宜够快**。
程序已经内置了常见服务商的预设，切换只需要一条命令（或者直接双击 `switch-model.bat` 按提示选）：

```bat
switch-model.bat                :: 列出预设，输个 id 就切好（最省事）
start.bat --provider glm        :: 智谱 GLM
start.bat --provider qwen       :: 阿里云百炼 通义千问
start.bat --provider siliconflow:: 硅基流动
start.bat --providers           :: 看全部预设
```

命令会把 `config.json` 里的 `ai.baseUrl` / `ai.model` / `ai.jsonMode` 改成该家的正确值，
然后你只要去对应网站申请一个 key 填进 `secrets.json`，跑一次 `check.bat` 即可。

---

## 该选哪个？

| 预设 id | 适合谁 | 上手难度 | 速度 | 备注 |
| --- | --- | --- | --- | --- |
| **`glm`** 智谱 GLM | 想要**免费 + 国内直连 + 中文自然** | ★ 手机号注册 | 快 | flash 系列长期是免费档；中文语气最像人 |
| **`qwen`** 阿里云百炼 | 想要**大免费额度**、延迟低 | ★ 支付宝/阿里云账号 | 很快 | 兼容模式接口，注意路径里带 `/compatible-mode/v1` |
| **`siliconflow`** 硅基流动 | 想**一个 key 调多家开源模型**（Qwen/GLM/DeepSeek…） | ★ 手机号注册 | 快 | 有免费小模型（带限流），聊天够用；模型 ID 带斜杠 |
| **`ark`** 火山方舟 豆包 | 想要**极致便宜 + 很快** | ★★ 要开通模型/建接入点 | 很快 | 新用户有免费额度，之后按量计费极低 |
| **`hunyuan`** 腾讯混元 | 已经在用腾讯云 | ★★ 控制台开通 | 中 | lite 系列免费 |
| **`moonshot`** Kimi | 想要**中文自然 + 长上下文** | ★ 手机号注册 | 中 | 有体验额度，之后按量计费 |
| **`deepseek`** | 项目默认，性价比高 | ★ 手机号注册 | 中 | 就是本项目的出厂默认 |
| **`ollama`** 本地 | **完全不花钱、不用 key** | ★★★ 要装 Ollama | 取决于显卡 | 7B 模型在没显卡的服务器上会明显卡；有显卡才推荐 |
| `groq` / `gemini` | 服务器在境外、想**最快** | ★★ 需要能上外网 | 极快 | 国内网络通常连不上，别在国内服务器上用 |

> 免费额度与服务商政策会变，**具体以官网为准**。程序的 `check.bat` 会实时调用该家的 `/models`
> 接口，把真正可用的模型名列出来——如果预设里的模型名过期了，照着列表改 `config.json` 的 `ai.model` 就行。

## 三个最快的上手路径

### A. 智谱 GLM（推荐）
1. 打开 https://open.bigmodel.cn ，手机号注册
2. 控制台 → API Keys → 新建，复制 `xxxx.xxxx` 形式的 key
3. 项目里执行 `start.bat --provider glm`
4. 把 key 填进 `secrets.json`：`{ "deepseekApiKey": "你的key" }`
5. 双击 `check.bat`，看到 `✓ 接口可用，可用模型：...` 就成了

### B. 阿里云百炼（通义千问）
1. 打开 https://bailian.console.aliyun.com ，登录阿里云账号
2. 右上角 API-KEY → 创建，复制 `sk-xxxx`
3. `start.bat --provider qwen` → 填 `secrets.json` → `check.bat`

### C. 硅基流动（想要多个模型随便换）
1. 打开 https://cloud.siliconflow.cn 注册
2. 左侧「API 密钥」新建
3. `start.bat --provider siliconflow` → 填 `secrets.json` → `check.bat`
4. 之后想换模型：改 `config.json` 里的 `ai.model`（例如 `Qwen/Qwen3-8B`、`deepseek-ai/DeepSeek-V3`）

## 常见坑（程序都替你兜住了）

| 现象 | 原因 | 程序的处理 |
| --- | --- | --- |
| `400 response_format is not supported` | 该家不支持 json 模式 | **自动降级**成普通文本模式并重试，回复照样能拆成多条 |
| `401 Authentication Fails` | key 错了 / 没填 / 复制少了字符 | 日志直接点出来；`check.bat` 会显示 key 来源（config / 环境变量 / secrets.json） |
| `429 Too Many Requests` | 免费档限流 | 自动重试（退避），聊天不受影响 |
| `404 model not found` | 模型名过期了 | `check.bat` 会打印该家真实可用的模型列表 |
| 回复太慢 | 大模型在长思考 | 换 flash/lite 档的模型；或把 `config.json` 的 `ai.maxTokens` 调小（比如 300） |
| 回复太长太文绉绉 | 模型太大 | 换小模型；或把 `reply.maxBubbleChars` 调到 30~40，人设会在 `persona.md` 里约束语气 |

## 想让"她"回得更快，改这三处

```jsonc
"ai":      { "maxTokens": 300, "timeoutSeconds": 30 },
"reply":   { "typingMsPerChar": 30, "maxTypingDelayMs": 900 }
```

`typingMsPerChar` 是**故意**加的打字延迟（模拟真人）。想几乎立刻收到，把它设成 `0`。
