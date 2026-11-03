# 问题定义：SkillStudio（智能教育 Skill 全生命周期平台）

> 课程作业文档：Practice — Repository Setup & Problem Definition  
> 文档位置：`docs/requirements/problem_definition.md`  
> 版本：v1.0（第一周检查点）

## 一、5W1H 报告

### What（是什么）

SkillStudio 是一个**面向教育场景的 Skill 创建、使用、评测、优化与版本治理平台**（产品名暂定为 SkillStudio，后续可能演进为 skill+agent 智能体平台）。

它将教师和教研人员在备课、教学设计、学习支持、评价与研究中的工作方法，从一次性提示词或临时对话，沉淀为**可运行、可测试、可优化、可追溯、可复用的 Skill 数字资产**。平台的核心对象是 Skill，而不是通用 Agent 或知识库。

### Why（为什么做 / 解决什么问题）

教育工作中使用生成式 AI，常见问题不是"模型不会回答"，而是：

1. 同类任务每次都要重新说明目标、对象、步骤和格式，重复劳动严重；
2. 教师经验停留在个人对话中，难以复用和协作；
3. 输出缺少稳定标准，无法判断改动是否真的更好；
4. 修改过程不可追溯，好的版本难以保留和恢复；
5. 单次回答出现问题，很难反推应修改哪个 Skill、哪一段规则。

结论：教育场景需要的不是更多临时提示词，而是一套 **Skill 资产生产与迭代机制**，把教师经验转化为可持续进化的数字资产。

### When（何时 / 项目时间节奏）

| 阶段 | 时间 | 交付物 |
| --- | --- | --- |
| 问题定义与仓库搭建 | 第 1 周 | 仓库链接、README、5W1H 报告、GitHub 协作（Projects / Issues） |
| 需求细化与架构设计 | 第 2-3 周 | `docs/requirements`、`docs/algorithm`、`docs/software` 文档 |
| 开发与联调 | 第 4-6 周 | `code/backend`、`code/frontend`、`code/core_engine` 代码与测试 |
| 测试与验收 | 第 7 周 | `tests/unit`、`tests/integration`、质量门禁 |
| 复盘与汇报 | 第 8 周 | `docs/retrospection` 复盘文档与最终汇报 |

### Where（在哪里使用 / 部署环境）

- **使用场景**：教师的备课与教学设计、学习支持与辅导、教学评价与研究分析等日常工作；
- **部署形态**：Web 应用（前端工作台 + 后端 API + 数据库），部署于校园 / 云服务器，通过浏览器访问；
- **协作位置**：GitHub（本仓库 https://github.com/Cloudlove93/SkillStudio）承载代码、Issues 反馈与项目看板。

### Who（目标用户与团队）

| 角色 | 说明 |
| --- | --- |
| 教师 / 教研人员 | 核心用户：将教学经验沉淀为 Skill，并日常使用、测试、优化 |
| Skill 建设者 | 维护 Skill 规则与版本，负责质量门禁 |
| 学生 / 学习者 | 通过 Skill 获取教学辅导与学习支持（受益方） |
| 团队（开发者） | 负责平台开发、测试与运维，本课程小组 |

### How（怎么做 / 核心机制）

平台通过一个连续闭环把"经验"转化为"可治理资产"：

```text
创建 Skill（对话共创 / 文档生成 / 完整填写 / ZIP 导入）
→ 运行真实任务（固定版本）
→ 测试与 Arena 双版本对比
→ 回答级诊断与交互式优化
→ 多样本试运行与质量门禁
→ 保存新版本（可回退、可追溯、可复用）
```

技术要点：Skill 以标准 `SKILL.md` 保存（含 YAML frontmatter）；版本快照存入 PostgreSQL；回答保留 provenance（溯源）信息；前后端通过 SSE 流式交互。

## 二、产品描述（Product Description）

### 2.1 一句话定位

**SkillStudio 是一个面向教育场景的 Skill 创建、使用、评测、优化与版本治理平台**，把教师和教研人员的工作方法沉淀为可运行、可测试、可优化、可追溯、可复用的 Skill 数字资产。

### 2.2 产品愿景

让每一份优秀的教学经验，都能被结构化为可迭代、可复用、可协作的 Skill，最终演进为一个 **skill+agent 平台**：Skill 负责"会做什么"，Agent 负责"怎么做"，共同服务一线教学。

### 2.3 核心功能（当前）

1. **Skill 创建**：对话共创（教育版五步引导）、文档批量生成、完整填写、ZIP 导入；
2. **Skill 仓库与工作区**：统一展示、搜索、管理 Skill 与多任务对话；
3. **Skill 使用与固定版本测试**：真实任务运行 + 固定输入版本验证；
4. **Arena 双版本对比**：同问题对比不同 Skill 版本输出（可对比"无 Skill"基线）；
5. **回答级交互式优化**：从真实回答出发，诊断 → 修改 → Diff 审阅 → 多样本试运行 → 质量门禁 → 保存新版本；
6. **版本治理**：版本预览、比较、回退、废弃与恢复，全程可追溯。

### 2.4 目录结构映射（课程作业规范）

| 课程规范目录 | 仓库内现有实现 |
| --- | --- |
| `docs/` | 需求 / 算法 / 软件 / 管理 / 复盘文档 |
| `code/backend` | `educlaw-server`（Express API 与业务编排） |
| `code/frontend` | `educlaw-web`（Skill-first React 工作台） |
| `code/core_engine` | `openagent`（智能体运行时核心，未来 skill+agent 引擎） |
| `tests/unit`、`tests/integration` | 测试入口（现有模块内测试保留在各自模块） |
| `.github/workflows` | CI/CD 工作流（待接入） |

### 2.5 验收标准（第一周检查点）

- [x] 建立 GitHub 仓库并提交规范 README（本仓库 SkillStudio）
- [x] 建立 main（生产）/ develop（开发）分支规范
- [x] 搭建课程规范目录结构（docs / code / tests / .github）
- [x] 完成本文档（5W1H 报告 + 产品描述）
- [ ] 建立 GitHub Projects（Kanban / Team Planning / Bug tracker）
- [ ] 通过 GitHub Issues 获得第一轮反馈
