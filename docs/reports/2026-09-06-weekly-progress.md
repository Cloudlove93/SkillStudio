# 本周工作进展（9月1日—9月6日）

## 一、本周重点

本周重点推进 EduSkill 与 Inno Agent Harness 的适配设计，目标是将当前基于 Prompt 注入的 Skill 运行方式，升级为可在真实 Inno Runtime 中完成运行、测试和安装验证的工程链路。

## 二、技术进展

- 完成 Inno Agent 0.5.4 核心运行机制调研，确认采用原生 Headless Server，通过 REST/SSE 驱动 AgentSession，不在 EduSkill 内重复实现 Agent 循环。
- 完成 Skill 工程模型设计，建立 `SkillVersion → HarnessBuild → Release` 版本链路，并明确 Package、Workspace Fixture、Runtime Config 和 Evaluator 的职责边界。
- 完成统一 Harness 执行架构设计，Run、Test、Arena 和 Optimization 共用运行协议；Test/Arena 按 Attempt 隔离，交互式 Run 按 Conversation 保留 Session 与 Workspace。
- 补充 Runner 安全与可靠性方案，包括 Sandbox、权限控制、Artifact 收集、事件追踪、取消清理和多用户隔离。
- 完成多模态模型配置更新，相关模型统一调整为 Kimi K2.6。

## 三、当前状态

Harness 接入设计稿已完成首轮评审和边界补充，目前处于最终定稿阶段，尚未进入正式开发。

## 四、下周计划

- 完成 Harness 接入方案定稿及实施任务拆分。
- 优先执行最小 Runner Spike，验证 Inno 启动、Skill 安装、Tool Call、SSE、Artifact、Cancel 和 Cleanup 的完整链路。
- 基于 Spike 结果确定正式 Runner 的并发、资源和性能基线。
