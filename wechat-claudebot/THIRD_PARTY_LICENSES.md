# 第三方开源组件引用

## 声明

本项目（WeChat ClaudeBot）所有源代码为自主开发，未包含任何第三方开源仓库的代码文件。

## 架构依赖的外部工具（非代码引用，需用户自行安装）

以下工具为本项目运行时依赖的外部独立软件，**本项目不包含其任何源代码**：

| 工具 | 仓库 | 协议 | 关系说明 |
|------|------|------|----------|
| CC-Switch | [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | MIT | Claude CLI 的模型路由配置层，本项目通过 `claude` 命令行间接调用 |
| Claude Code CLI | Anthropic 官方 | 商业许可 | 终端 AI 执行引擎，通过 `child_process.spawn` 调用 |
| DeepSeek API | DeepSeek 官方 | 服务条款 | 大语言模型后端，通过 CC-Switch 路由转发 |
| 微信 iLink Bot API | Tencent 官方 | 服务协议 | 微信消息收发通道，本项目为独立的 HTTP 协议客户端实现 |

## 与 cc-connect 的关系说明

[cc-connect](https://github.com/chenhg5/cc-connect)（MIT 协议）是一个功能类似的微信消息桥接工具（Go 语言，支持多平台多 Agent）。本项目与其存在以下差异：

| 对比维度 | cc-connect | 本项目 |
|----------|-----------|--------|
| 编程语言 | Go | JavaScript (Node.js) |
| 支持平台 | 飞书/钉钉/Slack/Telegram/Discord/LINE/企业微信/QQ 等 | 仅个人微信 (iLink) |
| 支持 Agent | Claude Code/Codex/Cursor/Gemini CLI/OpenCode 等 7 种 | 仅 Claude Code CLI |
| 功能定位 | 全功能桥接框架 | 纯双向消息管道 |

**本项目未使用 cc-connect 的任何源代码。** 两者为独立实现，均以微信 iLink HTTP 协议为基础进行开发。

## 外部协议依赖

| 依赖 | 类型 | 协议 |
|------|------|------|
| 微信 iLink Bot API | 通信协议（HTTP API 调用） | Tencent 服务协议 |
| DeepSeek API | AI 服务（通过 CC-Switch 转发） | DeepSeek 服务条款 |
| Claude Code CLI | 本地工具（child_process.spawn） | Anthropic 服务条款 |

## 修改说明

无。本项目未修改任何第三方代码。

## 协议冲突检查

- 主项目协议：MIT
- CC-Switch：MIT — 不包含其代码，无冲突
- cc-connect：MIT — 不包含其代码，无冲突
- 所有外部依赖均为运行时协议调用或独立安装工具，不涉及代码引用
