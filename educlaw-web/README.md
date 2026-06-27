# educlaw-web

## 项目名称

`educlaw-web` 是 EduSkill 的前端工作台，包含登录、智能体包管理、对话工作台、版本查看和手动编辑能力。

## 服务启动方式

```bash
cd educlaw-web
pnpm install
pnpm dev
```

构建与检查：

```bash
pnpm build
pnpm lint
pnpm format
```

## 环境变量

| 变量 | 说明 | 默认值 / 备注 |
| --- | --- | --- |
| `VITE_API_BASE` | 前端请求的 API 前缀 | 默认走同源 `/api` |

开发代理可在 `vite.config.ts` 中配置到本地后端。

## 页面与功能

- `/login`：登录页
- `/`：EduSkill 工作台首页
- 智能体生成、导入、版本对比、手动编辑
- Arena 对话与交互式优化入口

## 请求链路

- 每次请求都会生成并透传 `x-request-id`
- 显式传入的 `Authorization` 头不会被客户端工具覆盖
