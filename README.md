# CC-Bridge: WeChat ↔ Claude（CCSwitch接入DeepSeek）纯消息中转桥接系统
---

## 1. 项目概述
🤖 **项目定位**：一款差异化的微信-Claude消息中转桥接系统


本项目实现的微信 Claudebot，区别于市面绝大多数同类微信机器人项目：
主流同类项目大多直接调用原生 Claude CLI 客户端完成交互与逻辑处理，而本项目**不依赖原生 Claude CLI 直连模式**。

本项目采用专属链路架构：微信端 Bot 仅作为消息转发载体，统一通过 **CCSwitch 协议转发层** 完成路由中转，最终稳定接入 DeepSeek 大模型服务对接 Claude 能力，实现跨层标准化调用，脱离原生客户端调用限制，链路更灵活、适配性更强。

---

## 2. 设计说明
🎨 **项目品牌标识**
![CC-Bridge 项目封面](https://raw.githubusercontent.com/boogu2005/CC-Bridge/main/assets/cover.png)

1.  **项目名称**：`WeChat ↔ Claude Bridge`，明确系统核心定位为微信与 Claude 程序的双向桥接工具
2.  **核心技术标识**：`iLink Protocol · Pure Relay`，标注系统自研通信协议与纯中转核心特性
3.  **技术约束声明**：`Zero Local AI · MIT License`，明确系统零本地 AI 参与的设计原则与开源合规属性

---

## 3. 系统核心架构设计
🏗️ **全链路通信架构**


### 3.1 架构链路说明
本系统采用四层解耦设计，实现端到端的消息闭环：
- 📱 微信客户端（移动端）
- 🔗 iLink HTTP 协议层
- ⚙️ ilink-claude-bridge 桥接核心
- 💻 Claude Code CLI（本地终端）
- 🛣️ CCSwitch 协议转发层
- 🧠 DeepSeek API（云端大模型）
