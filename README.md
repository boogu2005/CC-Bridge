# wechatbot-claude-bridge: WeChat ↔ Claude（CCSwitch接入DeepSeek）纯消息中转桥接系统
---

## 1. 项目概述 
本项目所实现的微信Claudebot仅作为消息转发载体，统一通过 **CCSwitch 协议转发层** 完成路由中转，最终稳定接入 DeepSeek 大模型服务对接 Claude 能力，实现跨层标准化调用，脱离原生客户端调用限制，链路更灵活、适配性更强。
## 2. 系统核心架构设计 
![系统架构图](https://raw.githubusercontent.com/boogu2005/wechatbot-claude-bridge/main/assets/architecture.png)
本图为系统全链路通信架构，采用四层解耦设计，实现端到端的消息闭环：
移动端微信用户发出指令，经由 iLink HTTP 协议传入桥接核心程序，再推送至本地终端 Claude 程序，最后通过 CCSwitch 转发通道接入 DeepSeek 大模型完成任务处理，所有执行结果与运行日志按原路径反向回传至微信端，全程只做消息流转，不做内容修改与自主解析。
## 3. 演示
![实操演示图](https://raw.githubusercontent.com/boogu2005/wechatbot-claude-bridge/main/assets/wechatclaudebot.png)

---
