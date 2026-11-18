# 2026-11-18 项目会议提纲

## 1. 会议目标

- 汇报第 1–3 周材料与当前实现进度。
- 请老师评审 Agent + Skill 方案与 `architecture.md`。
- 确认 17 周后续安排、截止时间、提交方式与评分标准。

## 2. 开场 3 句话

1. **实现阶段的核心是持续交付可信赖的软件变更，不是写出更多代码。**
2. **我们已完成课例资产化、6 个方法 Skill + 3 个跨场景 Agent、CI/质量门禁、浏览器 E2E 和依赖漏洞清零；当前主要缺口是前端覆盖率和安全扫描。**
3. **这次会议希望老师确认后续周次与评分要求，并评审我们的 Agent + Skill 技术路线。**

## 3. 六项信息速览

| 项目 | 当前答案 |
| --- | --- |
| 项目是什么 | SkillStudio（EduClaw）是面向教育场景的 Agent + Skill 平台，把教师备课、教学设计、评价与研究中的方法沉淀为可运行、可测试、可版本治理的 Skill 资产。 |
| 仓库 | https://github.com/Cloudlove93/SkillStudio |
| 技术栈 | React 19 + Vite + TypeScript；Express 5 + Node.js；PostgreSQL 17；SeaweedFS；Kong + ZITADEL；Python Media Worker；pnpm + Docker Compose。 |
| CI | 已接入 GitHub Actions：web、e2e（按需）、server、worker、secret-scan、dependency-audit；依赖审计与密钥扫描为阻断门禁。 |
| 技术路线 | AI Agent（Agent + Skill 版本快照 + 可视化工作流），不是 DDD。 |
| 当前进度 | `architecture.md` 已有；代码已跑通；web 440 单测、117 契约测试、server 1328、worker 268、Playwright E2E 4 条通过；lint/typecheck/build 通过；依赖审计 0 漏洞。 |
| 老师额外要求 | 仓库内只确认了第 1–3 周检查点；具体截止时间、提交方式、评分标准未在仓库中出现，需要会上确认；课程为 17 周，但第一周文档写的是 8 周计划，需要确认以哪个为准。 |

## 4. 会上要确认的 6 个问题

1. 17 周课程的后续检查点分别是什么？下一次提交在什么时候？
2. 提交方式是 GitHub 仓库、压缩包，还是现场演示？
3. 评分标准是什么？文档、代码、测试、演示、创新性各占多少？
4. “DDD 还是 AI Agent”是二选一硬性要求，还是方向建议？我们选 AI Agent 是否认可？
5. `architecture.md`、`code_quality.md`、`code_review.md` 是否作为正式交付物？是否有模板或字数要求？
6. 是否需要现场演示？演示重点是 Agent 对话、工作流编排，还是课例分析结果？

## 5. 三项交付物待办与分工

| 交付物 | 现状 | 待办 | 建议负责人 | 完成节点 |
| --- | --- | --- | --- | --- |
| `docs/software/architecture.md` | 已有六层技术栈、核心链路、AI Agent 工作流模式、演进方向 | 会上评审；补充本轮课例资产与 6+3 Agent 的架构位置；确认与最终实现一致 | 架构负责人 | 会后 24 小时 |
| `docs/software/code_quality.md` | 已有质量基线、门禁、覆盖率、技术债、依赖审计 | 每周更新指标；把 web 覆盖率从 27.34% 提升到核心模块 60%+；接入 SAST/容器扫描 | 质量负责人 | 下一次迭代 |
| `docs/software/code_review.md` | 已有 PR 模板、评审清单、意见分级、流程 | 下一个 PR 开始强制使用；补充 2 个真实评审示例；统计评审等待时间 | 评审负责人 | 下一个 PR |

## 6. 会前准备清单

- [ ] 打开仓库与 PR：https://github.com/Cloudlove93/SkillStudio/pull/new/codex/p1-asset-center
- [ ] 准备一页架构图或直接打开 `docs/software/architecture.md`
- [ ] 准备仓库页面截图：52 个 Skill、22 个 Agent、36 个课例包
- [ ] 准备一次推荐演示：输入“初二数学课例的提问链分析”
- [ ] 准备一次工作流演示：添加 Skill 节点、选择课例包、保存草稿
- [ ] 记录老师确认的截止时间、提交方式、评分标准

## 7. 会后 24 小时输出

1. 更新 `architecture.md` 的评审结论和待修改项。
2. 把老师确认的截止/提交/评分写进 `docs/mgmt/`，并拆成 GitHub Issues。
3. 用 `code_review.md` 模板发起下一个 PR。
4. 在 `code_quality.md` 记录本周基线：构建失败率、测试失败率、PR 周期、覆盖率。
5. 给老师发一份会议纪要与下一步计划。

## 8. PPT 要求对照

| 课件要求 | 当前落地 | 证据 |
| --- | --- | --- |
| 编码规范与技术原则 | ESLint、TypeScript、Prettier 脚本；原则写入开发规范 | `development-process.md` |
| Git 分支与提交 | main/develop/feature/fix；Conventional Commits | README、提交历史 |
| Code Review | 评审清单、意见分级、PR 模板 | `code_review.md`、`.github/pull_request_template.md` |
| 自动化测试 | web 440 单测、117 契约、server 1328、worker 268、E2E 4 条 | CI 与测试报告 |
| 构建与依赖 | pnpm lockfile、Docker、依赖审计 | `ci.yml`、`pnpm-lock.yaml` |
| CI | web/server/worker/secret-scan/dependency-audit | `.github/workflows/ci.yml` |
| 安全开发 | 依赖审计 0 漏洞、密钥扫描、`.preview.env` 忽略 | `secret:check`、`security:audit` |
| 重构与技术债 | 记录大文件与技术债候选 | `code_quality.md` 第 6 节 |
| AI 辅助编码 | 适用任务、工程师责任、推荐流程 | `development-process.md` 第 9 节 |
| 质量门禁 | 构建、lint、类型、测试、审计、评审 | `code_quality.md` 第 3 节 |
| 工程度量 | 覆盖率基线、构建/测试失败率、PR 周期 | `code_quality.md` 第 8 节 |

## 9. 风险与备注

- **截止/评分未知**：不要在会上承诺具体日期，先确认老师要求。
- **17 周 vs 8 周**：以课程 17 周安排为准，仓库第一周文档的 8 周计划需要注明“历史计划”。
- **范围控制**：本轮不再扩展新 Agent/Skill，优先补测试、覆盖率、E2E 和文档。
- **演示风险**：提前 10 分钟打开预览，确认服务、数据库、模型调用正常。
