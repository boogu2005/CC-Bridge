# WeChat ClaudeBot

微信 Claude AI 机器人 — 纯双向消息管道。微信 ↔ 终端 Claude/DeepSeek 透明转发。

> **合规声明：** 本项目核心代码为自主开发，微信消息中转架构、终端联动 Claude CLI 对接 DeepSeek 流程为原创实现。未引用或复制第三方开源仓库代码。所有外部通信（微信 iLink API、DeepSeek API、Claude CLI）均为运行时协议调用，详见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。侵权联系立即删除。

## 架构

```
微信用户消息 → 微信 iLink 协议 → 本地轮询 → spawn claude CLI → CC-Switch → DeepSeek
                                                                        ↓
微信用户收到回复 ← 微信 iLink 协议 ← 本地推送 ← 终端输出（原样回传）
```

Bot 本身**不包含任何本地 AI 推理、消息分类、联网搜索、兜底话术**。职责仅限于：
- 从微信接收消息，原样展示在终端
- 将消息转发至本地 Claude CLI（通过 CC-Switch 接入 DeepSeek）
- 将终端 Claude 的输出原样推送回微信

## 前置依赖

以下工具需**用户自行安装**，本项目不包含其代码：

| 工具 | 用途 | 协议 | 安装 |
|------|------|------|------|
| **Node.js** 18+ | 运行 bot 主程序 | MIT | [nodejs.org](https://nodejs.org) |
| **Claude Code CLI** | 终端 AI 执行引擎 | Anthropic 商业许可 | `npm install -g @anthropic-ai/claude-code` |
| **CC-Switch** | Claude CLI → DeepSeek 路由层 | MIT | [github.com/farion1231/cc-switch](https://github.com/farion1231/cc-switch) |
| **微信 iLink Bot** | 微信消息通道 | Tencent 服务协议 | 扫码自动获取 |

## 快速部署

### 1. 克隆仓库

```bash
git clone https://github.com/your-username/wechat-claudebot.git
cd wechat-claudebot
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 DeepSeek API Key
```

### 3. 首次登录（扫码）

```bash
node wechat_bot.mjs login
```

扫码成功后凭据会自动保存到 `~/.claude-wechat-bot/token.json`。

### 4. 启动

```bash
# 方式一：单次运行
node wechat_bot.mjs start

# 方式二：使用启动脚本（崩溃自动重启）
start_wechat_bot.bat
```

### 5. 启用开机自启（Windows）

```bash
node wechat_bot.mjs autostart-enable
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `node wechat_bot.mjs start` | 启动 bot |
| `node wechat_bot.mjs stop` | 停止运行中的实例 |
| `node wechat_bot.mjs status` | 查看运行状态 |
| `node wechat_bot.mjs login` | 仅扫码登录 |
| `node wechat_bot.mjs autostart-enable` | 启用开机自启 |
| `node wechat_bot.mjs autostart-disable` | 禁用开机自启 |
| `node wechat_bot.mjs cleanup` | 清理残留进程 |
| `node wechat_bot.mjs version` | 查看版本信息 |

## 项目结构

```
wechat-claudebot/
├── wechat_bot.mjs                # 主程序：消息轮询、中转、微信 API
├── bot_modules/
│   ├── claude-code-bridge.mjs    # spawn claude CLI，对接终端
│   ├── autostart.mjs             # Windows 开机自启管理
│   ├── config.mjs                # 配置管理
│   ├── logger.mjs                # 日志
│   ├── alert.mjs                 # 告警
│   ├── health-server.mjs         # 健康检查
│   ├── message-queue.mjs         # 消息队列
│   ├── network-guardian.mjs      # 网络守护
│   ├── process-guardian.mjs      # 进程守护
│   └── session-cache.mjs         # 会话缓存
├── start_wechat_bot.bat          # 启动脚本（崩溃自动重启）
├── run_bot.bat                   # 单次启动脚本
├── create_startup_shortcut.ps1   # 创建开机自启快捷方式
├── check_shortcut.ps1            # 检查开机自启状态
├── .env.example                  # 环境配置模板
├── .gitignore
├── LICENSE                       # MIT
└── README.md                     # 本文档
```

## 消息流转规则

1. 微信收到用户消息 → 完整展示在终端界面
2. 消息原样转发至 `claude` CLI → CC-Switch → DeepSeek
3. DeepSeek 返回结果 → 终端显示 → 原样推送回微信
4. Bot 不修改、不截断、不自行应答任何消息
5. 终端无响应时固定回复：*"已同步指令至电脑终端，等待终端执行输出。"*

## 常见问题

**Q: 为什么 bot 不调用本地 AI？**
A: Bot 定位是纯消息管道，所有 AI 运算由终端 Claude CLI 完成。这样确保终端拥有完整的上下文和控制权。

**Q: 如何更换模型？**
A: 修改 `.env` 中的 `DEEPSEEK_MODEL`，或在启动时设置 `CLAUDE_MODEL` 环境变量。

**Q: 消息发不出去？**
A: 检查 token 是否过期 — 重新运行 `node wechat_bot.mjs login` 扫码登录。

## 第三方开源组件引用

本项目所有代码为自主开发。外部依赖均为运行时协议调用，不包含第三方源代码。详见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

| 组件 | 类型 | 协议 |
|------|------|------|
| 微信 iLink Bot API | 通信协议（HTTP API 调用） | Tencent 服务协议 |
| DeepSeek API | AI 服务（通过 CC-Switch 转发） | DeepSeek 服务条款 |
| Claude Code CLI | 本地工具（child_process.spawn） | Anthropic 服务条款 |

## License

MIT
