# 全新 Windows 服务器部署（QQ + NapCat + 本程序）

面向：**一台刚装好、什么都没配的 Windows 服务器**，用远程桌面（RDP）操作。
全程约 20 分钟，其中只有两处必须你亲自动手：**QQ 扫码登录**、**用你自己的 QQ 加机器人好友**。

---

## 0. 先确认三件事（不满足就卡死）

| 检查项 | 为什么 | 不满足怎么办 |
| --- | --- | --- |
| 服务器是**带桌面的** Windows Server（RDP 能看到图形界面） | QQ NT 是图形程序，NapCat 靠注入它的进程工作，**Server Core（无桌面）跑不了** | 告诉我，我给你换 Linux + NapCat Docker 的方案 |
| 有一个**机器人 QQ 小号**，且能在这台服务器上登录 | 第三方协议登录有极小概率被腾讯风控，别用主号 | 注册个小号 |
| 一把**能用的模型 API Key** | 机器人回话靠它 | 见 [`providers.md`](providers.md)：智谱 GLM 的 flash 是免费档 |

---

## 1. 把项目传上去

把 `qq-ai-chat-vX.X.X.zip` 拷到服务器，解压到 `C:\qq-ai-chat\`。

> zip 里**不含** `config.json` / `secrets.json`（密钥不进包），第一次运行会自动生成。

## 2. 装 Node（30 秒，免管理员）

在 `C:\qq-ai-chat\` 里双击 **`install-node.bat`**。
它会把便携 Node 下到项目内的 `.runtime\node`（官方源失败会自动换 npmmirror 镜像），不改系统 PATH。

## 3. 装 NapCat + QQ

1. 双击 **`deploy\install-napcat.bat`** —— 自动从 GitHub 下载 `NapCat.Shell.zip` 并解压到 `C:\NapCat`。
   - 服务器连不上 GitHub 时，它会把下载地址直接打给你：用浏览器/迅雷下载后解压到 `C:\NapCat`，一样能接着往下走。
2. 装 QQ：https://im.qq.com/pcqq
   - **先在服务器上手动启动一次 QQ，用机器人小号扫码登录**，确认能进主界面，然后退出。
     这一步是为了让 NapCat 之后能"快速登录"。
3. 双击 `C:\NapCat\launcher-user.bat` —— 它会自动找到 QQ 安装路径、注入 NapCat 并拉起 QQ。
   - 想直接快速登录也可以：命令行执行 `launcher-user.bat <机器人QQ号>`。
   - ⚠️ **如果 QQ 装在 `C:\Program Files\Tencent\QQNT\`（QQ 默认安装位置），必须用管理员身份启动 NapCat**：
     NapCat 要把 QQ 的 Electron 入口改写成它自己的 `loadNapCat.js`（写在 **QQ 的安装目录**里），Program Files 非管理员写不进去。
     症状是 QQ 弹框 `A JavaScript error occurred in the main process` / `Cannot find module 'C:\Program Files\...\resources\app\loadNapCat.js'`。
     - 做法 A（每次）：开始菜单搜 PowerShell → **右键「以管理员身份运行」** → `cd /d C:\NapCat` → `.\launcher-user.bat`
     - 做法 B（自动提权）：`deploy\start-napcat.bat -Elevated`
     - 做法 C（一劳永逸）：把 QQ 装到用户可写目录（例如 `D:\QQ`），之后不需要管理员
4. 扫码登录机器人小号（之前登录过通常免扫码）。
5. 控制台会打印 NapCat WebUI 地址，形如 `http://127.0.0.1:6099/webui?token=xxxx`（**先不用点进去**）。

## 4. 自动配好 OneBot 通道（省掉手点 WebUI）

在 `C:\qq-ai-chat\` 里双击 **`deploy\setup-napcat.bat`**。

它会自动找到 `C:\NapCat\config\onebot11_<QQ号>.json`，给这个账号配好两条通道
（原文件先备份成 `.bak-时间戳`，重复运行不会重复添加）：

| 通道 | 内容 | 作用 |
| --- | --- | --- |
| HTTP 服务器 | `127.0.0.1:3000`，token `change-me-please` | 我们用它**发**消息 |
| HTTP 上报 | `http://127.0.0.1:8787/onebot`，secret `change-me-please` | NapCat 用它把消息**推**给我们 |

> 这两个 token 正好等于 `config.json` 里的默认值，所以你**不用改配置**。
>
> 如果它提示"还没有 onebot11_*.json"，说明 QQ 还没在 NapCat 里登录成功 —— 回到 §3.4 登录后重跑一次即可。

**然后重启 NapCat**（关掉 launcher 窗口，重新双击 `launcher-user.bat`）。

> 不想用脚本也行：打开 NapCat WebUI →「网络配置」，照着上表手点两条，效果完全一样。

## 5. 填模型 Key

复制 `secrets.example.json` → 改名 `secrets.json`，填上你的 key：

```json
{ "deepseekApiKey": "sk-你的key" }
```

想用免费的就先在项目目录执行 `switch-model.bat` 选 `glm`，再去申请 key。

## 6. 自检 → 启动

1. 双击 **`check.bat`**，要看到这三行才算通：
   - `✓ 接口可用，可用模型：...`
   - `✓ 试生成成功：...`
   - `✓ 已登录 QQ：<小号昵称>（<QQ号>）`
2. 双击 **`start.bat`** 启动（窗口会打印它收到、发出的每条消息）。
3. 用你自己的 QQ 加机器人小号好友 → 发一句「在吗」→ 1~3 秒内收到 1~3 条回复。
4. 双击 `once.bat` 可以**立刻**验证主动发言（不用等 5 分钟）；或者什么都不发，等 5 分钟看它自己来找你。

## 7. 让它一直在（服务器专属注意事项）

- **别"注销"（Log off）**：注销会杀掉 QQ/NapCat。RDP 用完点**断开连接**即可。
- **开机自启（本程序）**：双击 `install-autostart.bat`，注册计划任务 `QQAIChat`，登录后自动以守护模式运行（崩溃自动重启）。
  - 取消：`uninstall-autostart.bat`；停止运行：`stop.bat`（只结束命令行里带本项目路径的 node）。
- **开机自启（QQ + NapCat）**：把 `C:\NapCat\launcher-user.bat` 的快捷方式放进 `shell:startup`
  （Win+R 输入 `shell:startup` 回车打开的那个文件夹），或自己建个"登录时触发"的计划任务。
  两个程序的启动顺序无所谓：本程序连不上 NapCat 会自动重试，NapCat 起来后自然接上。
- **防火墙**：本方案所有连接都在 `127.0.0.1` 回环上，**不需要开任何入站端口**。
- **内存**：QQ + NapCat 常驻约 1~2 GB，建议服务器内存 ≥ 4 GB。

---

## 常见问题

**Q：`check.bat` 报 `连不上：fetch failed（ECONNREFUSED）`**
NapCat 没跑或没登录。看 `C:\NapCat` 窗口是否还在、QQ 是否在线；重跑 `deploy\setup-napcat.bat` 确认通道配置在，然后重启 NapCat。

**Q：QQ 在线，但发消息机器人不理**
看 `start.bat` 窗口有没有 `← 收到 ...`：
- 没有 → HTTP 上报没生效：重跑 `setup-napcat.bat` + 重启 NapCat；确认 `config.json` 的 `onebot.http.accessToken` 是 `change-me-please`。
- 有收到但不回 → 模型那边的问题，日志会直接给出原因（key 无效 / 余额不足 / 模型名不存在）。

**Q：模型报 402 余额不足**
DeepSeek 需要先充值；不想充就 `switch-model.bat` 换智谱 GLM（flash 免费档）。

**Q：想换模型 / 换人设 / 调黏人程度**
- 换模型：`switch-model.bat`
- 换人设：编辑 `persona.md`、`topics.md`，重启程序即可
- 黏人程度：`config.json` 的 `proactive.idleSeconds`（默认 300 秒）、`maxConsecutive`（默认 3 条）、`quietHours`（默认 23:30–07:30）

**Q：会不会被腾讯封号**
第三方协议登录属于灰色地带。建议用**小号**、别把频率调得太激进（默认 5 分钟一次已经很温和）、不要 24 小时高频发言。
