# 代码质量与质量门禁

> 依据课件第三部分 126–171 页的工程质量要求，结合当前仓库实际整理。
> 关联文档：[architecture.md](./architecture.md)、[development-process.md](./development-process.md)、[code_review.md](./code_review.md)。

## 1. 目标

- 任何进入 `main` 的变更都应可构建、可测试、可评审、可回滚。
- 质量指标用于发现改进点，不用于简单评价个人绩效。
- 质量门禁优先保证「不把失败代码合入主干」，再逐步提高覆盖率和自动化程度。

## 2. 当前基线（2026-11-18）

| 项目 | 现状 |
| --- | --- |
| 前端单元测试 | 439 项通过 |
| 前端契约测试 | 117 项通过 |
| 后端测试 | 1328 项通过，21 项跳过（数据库集成测试默认关闭） |
| 静态检查 | ESLint（web/server）+ TypeScript 类型检查通过 |
| 构建 | `educlaw-web`、`educlaw-server` 生产构建通过 |
| CI | 已新增 `.github/workflows/ci.yml`，覆盖 web/server 与依赖审计 |
| 依赖审计 | 0 个已知漏洞（2026-11-18 修复） |
| 覆盖率（web） | Statements 27.34%、Branches 28.06%、Functions 22.45%、Lines 29.06% |
| 覆盖率（server） | Statements 74.66%、Branches 66.80%、Functions 81.43%、Lines 75.87% |
| 关键链路冒烟 | 已新增 `pnpm smoke:preview`，覆盖首页、健康检查、课例索引、仓库 Skill、Agent、预置包 |
| 浏览器 E2E | 尚无稳定套件 |
| Python Worker 测试 | 已有测试脚本，尚未纳入 CI |

依赖审计已清零，详见第 7.1 节；当前主要质量缺口是前端覆盖率偏低和浏览器 E2E 尚未建立，详见第 5.3、5.4 节。

## 3. 质量门禁

### 3.1 提交前（开发者自检）

```bash
pnpm lint
pnpm check:types
pnpm --filter educlaw-web run test:unit
pnpm --filter educlaw-server run test
pnpm build
```

要求：

- 不提交密钥、Token、用户隐私或本地预览配置。
- 不提交无关格式修改、生成文件和临时脚本。
- 新增行为有测试；缺陷修复有回归测试。

### 3.2 Pull Request

- 至少 1 人完成代码评审。
- PR 描述包含：变更目的、影响范围、验证方式、风险与回滚方案。
- 关联对应 Issue。
- 尽量保持小 PR；超过约 400 行 diff 时说明原因。
- CI 通过后才能合并。

### 3.3 CI 门禁

| Job | 内容 | 是否阻断 |
| --- | --- | --- |
| `web` | 类型检查、lint、单测 + 覆盖率、契约测试、生产构建 | 是 |
| `server` | lint、后端测试 + 覆盖率、生产构建 | 是 |
| `dependency-audit` | `pnpm audit --prod` | 是 |

web/server job 会上传 `web-coverage`、`server-coverage` 报告；覆盖率暂不作为阈值门禁，先积累基线。

### 3.4 合并与发布

- 合并前：CI 通过、评审完成、无冲突、变更说明完整。
- 发布前：Docker 镜像构建成功，核心链路冒烟通过。
- 发布后：保留镜像 tag 与变更记录，出现异常可回滚。

## 4. 静态分析

### 4.1 已接入

- **ESLint**：`educlaw-web` 与 `educlaw-server`。
- **TypeScript**：`tsc` / `pnpm run check:types`。
- **Prettier**：已有格式化脚本，尚未在 CI 中强制检查格式。

### 4.2 待接入

| 工具 | 用途 | 优先级 |
| --- | --- | --- |
| `pnpm audit` | 依赖漏洞 | P0（已接入并阻断） |
| Semgrep / CodeQL | SAST，发现注入、越权、敏感信息等问题 | P1 |
| Trivy | 容器镜像漏洞 | P1 |
| gitleaks | 密钥扫描 | P0 |
| Prettier `--check` | 格式门禁 | P1 |

### 4.3 静态分析原则

- 先保证「新增问题不增加」，再逐步清理历史问题。
- 阻断级规则只保留高置信度问题，避免大量误报导致团队绕过门禁。
- 所有豁免必须写明原因、责任人和到期时间。

## 5. 测试策略

### 5.1 分层

| 层次 | 目标 | 当前状态 |
| --- | --- | --- |
| 单元测试 | 独立函数/模块，快速定位 | 前端 439 项、后端覆盖主要 service/route |
| 契约测试 | API 输入输出与前端调用约定 | 117 项通过 |
| 集成测试 | 数据库、对象存储、跨模块协作 | 已有，部分需显式开启 |
| E2E | 完整业务流程 | 待补：Agent 创建→对话、工作流保存→试跑、版本回滚 |

### 5.2 必测场景

- 正常路径。
- 参数缺失、格式错误、越权访问。
- 重复请求与幂等。
- 版本冲突（409）与重新读取合并。
- 数据库/对象存储异常。
- 日志中不出现敏感信息。

### 5.3 覆盖率

当前基线（2026-11-18，`pnpm --filter <workspace> run test:coverage`）：

| 范围 | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `educlaw-web` | 27.34% | 28.06% | 22.45% | 29.06% |
| `educlaw-server` | 74.66% | 66.80% | 81.43% | 75.87% |

解读：

- server 覆盖率尚可，但仍需关注 Agent 版本、工作流、鉴权等核心分支。
- web 覆盖率偏低，主要因为页面、store 和交互组件缺少测试；这是下一阶段的主要补测方向。
- 覆盖率是辅助指标，不等于质量；不以「为覆盖率写测试」为目标，重点覆盖行为、边界和失败场景。
- 下一步目标：先把核心模块（Agent、Skill 版本、工作流、鉴权）提升到 60% 以上，再讨论全仓库阈值。

### 5.4 关键链路冒烟

已新增 `pnpm smoke:preview`（默认指向本地预览 `127.0.0.1:8081` / `127.0.0.1:18081`），检查：

- 首页可访问。
- `/livez`、`/readyz` 正常。
- `/lessons/index.json` 为 1404 节。
- 仓库 Skill 52 个、课例包 36 个、分析 Skill 14 个，课例包均为当前版本。
- 9 个学科教研 Agent + 3 个跨场景 Agent + 4 个方法 Agent 存在。
- 4 个预置包存在，课例容器版本已递增。

运行方式：

```bash
EDUCLAW_WEB_BASE=http://127.0.0.1:8081 \
EDUCLAW_API_BASE=http://127.0.0.1:18081 \
pnpm smoke:preview
```

2026-11-18 预览环境实测：23 项检查全部 PASS。

浏览器级 E2E 仍未建立；当前冒烟覆盖数据与 API 关键路径，UI 交互由单测、契约测试和人工验收覆盖。

## 6. 技术债务

| 文件 | 行数 | 主要问题 | 优先级 |
| --- | --- | --- | --- |
| `educlaw-server/src/services/package-service.ts` | 约 3590 | 包生成、rubric 抽取、导入导出、版本对比混在一起 | P1 |
| `educlaw-server/src/services/skill-version-service.ts` | 约 2057 | 仓库查询、版本分配、导出逻辑可继续分层 | P1 |
| `educlaw-web/src/pages/SkillFirstWorkspace.tsx` | 约 2417 | 页面编排与业务状态较多 | P2 |
| `educlaw-web/src/pages/WorkflowDemo.tsx` | 约 934 | 画布、节点库、配置面板可拆组件 | P2 |
| `educlaw-web/src/lib/studio-presets.ts` | 约 900 | 预置资产数据与推荐匹配可拆模块 | P2 |

重构原则：

1. 先补测试保护。
2. 小步修改，每次运行测试。
3. 重构不与大规模功能变更混在同一个 PR。
4. 在本文档记录债务、影响和计划。

## 7. 已知风险

### 7.1 依赖漏洞（已修复）

2026-11-18 修复前：`pnpm audit --prod` 报告 27 个漏洞（1 critical、15 high、9 moderate、2 low）。

修复后结果：

```text
No known vulnerabilities found
```

处理方式：

- **直接升级**：`adm-zip` 0.6.0 → 0.6.1、`compression` 1.8.0 → 1.8.2、`katex` 0.16.45 → 0.18.2。
- **传递依赖**：在 `pnpm-workspace.yaml` 的 `overrides` 中锁定 `qs` 6.16.1、`@xmldom/xmldom` 0.8.15、`@ai-sdk/provider-utils` 4.0.33、`proxy-addr` 2.0.8、`body-parser` 2.4.0、`postcss-selector-parser` 6.1.5、`zod` 4.6.6、`katex` 0.18.2。
- **验证**：web 439 项单测、117 项契约测试、server 1328 项测试、lint、类型检查、生产构建、`pnpm install --frozen-lockfile` 全部通过。
- **门禁**：CI 的 `dependency-audit` 已从 informational 改为阻断。

后续要求：

- 每次依赖升级后重新运行 `pnpm security:audit`。
- 关注 `express`、`@earendil-works/pi-ai` 等上游依赖的安全公告，避免 override 长期滞后。
- 上游发布兼容修复版本后，优先升级并清理不再需要的 override。

### 7.2 其他风险

- web 覆盖率基线 27.34%，核心模块仍需补测。
- 浏览器 E2E 尚未建立，当前以 `smoke:preview`、单测和契约测试覆盖。
- Python Worker 测试尚未纳入 CI。
- 历史提交中可能存在密钥；需要一次全历史扫描，若发现则轮换。
- 大文件重构尚未开始，修改成本会随功能增加而上升。

## 8. 工程度量

每周记录一次，先建立基线，不设虚假目标：

| 维度 | 指标 |
| --- | --- |
| 交付效率 | 任务完成周期、PR 周期、构建耗时、评审等待时间 |
| 代码质量 | 缺陷密度、核心模块覆盖率、静态分析问题数、重复代码比例、复杂度、技术债务 |
| 流程稳定性 | 构建失败率、测试失败率、变更失败率、缺陷逃逸率、回滚次数 |

度量结果用于调整流程和补测试，不作为个人绩效依据。

## 9. 责任分工

| 角色 | 职责 |
| --- | --- |
| Tech Lead | 门禁定义、依赖升级决策、风险优先级 |
| 模块负责人 | 本模块测试、静态检查、技术债记录 |
| Reviewer | 按 `code_review.md` 完成评审 |
| CI 维护人 | 维护 `ci.yml`、缓存、失败通知与门禁调整 |
| 全体成员 | 提交前自检、不提交密钥、不绕过门禁 |
