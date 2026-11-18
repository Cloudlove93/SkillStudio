# 浏览器 E2E 测试

项目使用 Playwright 对预览环境做关键 UI 流程验证，覆盖登录、首页入口、资源推荐、仓库页面和工作流 Skill 节点。

## 1. 覆盖范围

- 登录：未登录跳转、账号密码登录、登录后进入首页。
- 首页：材料提炼、结构视图、工作流三个入口可见。
- 推荐：输入“初二数学课例的提问链分析”，命中“初中数学8年级课例包”。
- 仓库：Skill Tab 显示课例包，Agent Tab 显示跨场景 Agent。
- 工作流：添加 Skill 节点，选择仓库课例包。

测试只读，不保存工作流、不创建 Agent、不修改用户数据。

## 2. 本地运行

前置条件：

1. 预览环境已启动：`http://127.0.0.1:8081`。
2. 已有一个可用的测试账号。
3. 本机安装 Chrome 或 Edge（Playwright 可直接复用，无需下载 Chromium）。

运行：

```bash
E2E_BASE_URL=http://127.0.0.1:8081 \
E2E_USERNAME=your-test-account \
E2E_PASSWORD=your-test-password \
E2E_CHANNEL=chrome \
pnpm --filter educlaw-web run test:e2e
```

如果使用 Playwright 自带 Chromium：

```bash
pnpm --filter educlaw-web run test:e2e:install
E2E_BASE_URL=http://127.0.0.1:8081 \
E2E_USERNAME=your-test-account \
E2E_PASSWORD=your-test-password \
pnpm --filter educlaw-web run test:e2e
```

## 3. CI 运行

CI 的 `e2e` job 默认跳过，避免没有预览环境时误报失败。启用方式：

1. 在 GitHub 仓库 Settings → Variables 添加 `E2E_ENABLED=true`。
2. 添加 `E2E_BASE_URL`（可访问的预览地址）。
3. 在 Secrets 添加 `E2E_USERNAME`、`E2E_PASSWORD`。
4. 重新运行 CI。

工作流会自动安装 Chromium 并执行 `playwright test`，失败时上传 `playwright-report`。

## 4. 注意事项

- **不要把测试账号密码提交到仓库**；`.env.e2e` 已加入 `.gitignore`。
- E2E 依赖真实登录态和预览数据；如果测试账号工作区为空，推荐/仓库断言会失败。
- UI 文案或结构变化时，同步更新 `educlaw-web/e2e/workspace.spec.ts`。
- 浏览器级 E2E 与 `smoke:preview` 互补：smoke 覆盖 API/数据，E2E 覆盖真实 UI 交互。
