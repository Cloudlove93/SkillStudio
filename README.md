# SkillStudio

**SkillStudio**（课程项目名，暂定；后续可能演进为 skill+agent 平台）是一个面向教育场景的 **Skill 创建、使用、评测、优化与版本治理平台**。它把教师和教研人员在备课、教学设计、学习支持、评价与研究中的工作方法，从一次性提示词或临时对话，沉淀为可运行、可测试、可优化、可追溯、可复用的 Skill 数字资产。

当前产品定义、功能地图、核心流程、架构与实现状态边界，见 [SkillStudio 平台说明与功能地图](docs/EDUSKILL_PLATFORM_OVERVIEW.md) 与 [问题定义（5W1H）](docs/requirements/problem_definition.md)。

## 第 2 周课程提交材料

- [功能需求规格说明书](docs/requirements/functional_spec.md)：用户角色、功能范围、业务规则、验收场景及代码与测试追踪。
- [非功能需求规格说明书](docs/requirements/nonfunctional_spec.md)：安全、可靠性、性能、易用性、部署与质量验证要求。

两份材料依据现有成果整理，状态为待教师评审的提交稿；“已有实现”和历史测试记录不代表当前版本已经通过验收。

## 第 3 周课程材料

- [用户故事与验收条件](docs/requirements/user_stories.md)：20 个用户故事、优先级、需求关联、验收条件及建议演示顺序。

当前仅补充用户故事材料；原型展示、技术方案调研汇总和教师确认需另行完成。

## 目录结构（课程作业规范映射）

| 课程规范目录 | 仓库内实现 | 说明 |
| --- | --- | --- |
| `docs/` | [`docs/`](docs) | 需求（requirements）/ 算法（algorithm）/ 软件（software）/ 管理（mgmt）/ 复盘（retrospection）文档 |
| `code/backend` | [`educlaw-server/`](educlaw-server) | Express API 与业务编排 |
| `code/frontend` | [`educlaw-web/`](educlaw-web) | Skill-first React 工作台 |
| `code/core_engine` | [`openagent/`](openagent) | @openagent/core 智能体运行时，未来 skill+agent 核心引擎 |
| `tests/unit`、`tests/integration` | [`tests/`](tests) | 测试入口（模块内测试保留在各自模块） |
| `.github/workflows` | [`.github/workflows/`](.github/workflows) | CI/CD 工作流（待接入） |

## Start

```bash
pnpm install
docker compose up -d educlaw-postgres
pnpm --filter @educlaw/shared build
pnpm --filter educlaw-server dev
pnpm --filter educlaw-web dev
```

## Services

- `educlaw-server`: API, auth, packages, arena, logging, and persistence
- `educlaw-web`: frontend workspace
- `openagent`: agent runtime primitives (future core engine)

## Config

- Copy `.env.example` to `.env.local`
- Put real secrets only in `.env.local`

## Branch 规范

- `main`: 生产稳定分支（仅通过 PR 合并，需审核）
- `develop`: 开发主分支（日常集成）
- `feature/*`: 功能分支（从 `develop` 切出）
- `fix/*`: 缺陷修复分支
- 每项修改使用独立分支，验证后提交审核；未经确认不合并 `main`。

## Collaboration（协作）

- **仓库**：https://github.com/Cloudlove93/SkillStudio
- **GitHub Projects**：Kanban（任务看板）、Team Planning（团队规划）、Bug tracker（缺陷跟踪）
- **反馈**：通过 [GitHub Issues](https://github.com/Cloudlove93/SkillStudio/issues) 提交与获取评审反馈

## Workflow

- `main`: stable
- `develop`: integration
- `feature/*`: features
- `fix/*`: fixes
