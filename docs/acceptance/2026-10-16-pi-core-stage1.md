# Pi Core 第一阶段整合验收记录

日期：2026-10-16（北京时间）。本记录针对远端 `4afdfe2` 与本次本地修复的整合版。范围仍为 Node 内 Pi Core、固定版本 Markdown Skill Run/Test，以及独立 Spike 的只读 reference 工具；不扩展完整 Inno、多 Harness、队列、自动评分或正式 references/scripts。

## 1. 基线与整合方式

| 项目 | 内容 |
|---|---|
| 远端 | `https://github.com/Cloudlove93/EduClaw-arena.git` |
| 最新远端基线 | `origin/feat/pi-harness-skill-run-test`，`4afdfe23f824f2e99e736c46fa9f1bdeae1efd54` |
| 本地整合分支 | `codex/pi-core-review-fixes`，最终 SHA 由提交后报告给原会话 |
| 前轮修复备份 | 本地分支 `codex/pi-core-backup-20261016-before-upstream`，提交 `2baad6b7296440466fee711766a99f25b3a44b05`；不推送该备份分支 |
| 整合方式 | 精确备份任务文件后，将修复分支快进到 `4afdfe2`，采用新版前端，再恢复未被新版修改的后端、Spike 和验收文件；未 reset、强推或覆盖用户改动 |
| 用户规范 | 两份 `docs/requirements` 用户规范保留未跟踪，不进入提交 |
| SDK | 固定 `pi-agent-core@1.1.0`、`pi-ai@1.1.0`，锁文件未改 |

本轮新证据全部在 [integrated-4afdfe2](evidence/integrated-4afdfe2/)；`evidence` 根目录的旧截图和旧结果属于 `e816342` 阶段历史材料，不能作为本轮通过依据。

## 2. 最终行为与必要修复

1. 采用远端前端实现：新会话 ID 确认不取消首轮；同步发送锁拦截重复提交；EOF/stream_end 未确认保存时失败；只以持久化 `done` 创建成功回答；历史加载提示、旧响应保护继续保留。没有恢复旧的“side_done 即成功”语义。
2. 修复加载历史期间发请求的竞争：按钮、Enter、统一 sendContent 与自动 rerun 均受加载状态限制。同步 ref 防止同一次 effect 周期提前发送；rerun 等待历史和版本就绪，实际入场后才标记已处理，不增加任务队列。
3. 浏览器刷新发现 StrictMode effect 重放会使首次历史请求失效后又跳过重新加载。清理时重置会话 ref，下一次初始化重新读取；自动 rerun 通过可取消微任务确认入场，避免 StrictMode 首次清理吞掉请求。两项回归先失败后通过。
4. 保留真正切换会话时的取消、历史加载失败后可手动重试、连续成功/停止后再发请求；迟到历史响应不覆盖新会话。
5. 保留后端四项修复：Kimi 温度兼容、显式 thinking 开关、可展示思考贯通 SSE/落库、会话锁后重读权威历史；等待事务连接后再次检查取消。
6. 保留 Spike 的预算、工具回灌证据、取消/超时/异常和配置优先级修复。正式 Run/Test 仍不注册工具；reference 工具只存在于独立 Spike。
7. 加固模拟测试：SDK 回归使用模拟 config；Spike 配置测试完全 mock 文件读取；一次性验收进程阻止正式 config 模块读取项目 `.env/.env.local`，只使用显式隔离配置，避免断言输出真实秘密。

## 3. 本轮实际验证

| 命令 / 检查 | 本轮结果 | 验证边界 |
|---|---|---|
| 前端 `skill-run-thinking-integration.test.tsx` | 18 通过 | 包含新版 10 项、加载/版本门控、切换取消、加载失败重试、StrictMode 两项 |
| `pnpm --filter educlaw-web test` | 单元 250、契约 116 通过 | 最新 StrictMode 修复后重新运行 |
| `pnpm --filter educlaw-server test --silent` | 1064 通过、3 跳过 | 整合树重新运行 |
| `pnpm --dir spikes/pi-core test` / `build` | 22 通过、构建成功 | HTTP payload、工具结果进入后续请求、预算/取消/配置隔离 |
| `pnpm run build:shared` / `build:server` / `build:web` | 均成功 | 前端仍有 >500kB chunk 提示 |
| 修改 server/web 文件 ESLint / `git diff --check` | 通过 | 提交前再次检查暂存差异 |
| 项目 Dockerfile 的隔离镜像构建 | 成功 | 专用 tag `educlaw-pi-acceptance:integrated-4afdfe2`，context 不含环境文件或凭证；不覆盖业务 latest |
| 容器 Node / SDK | Node v22.23.2，SDK 均 1.1.0 | 实际容器运行，满足 Node >=22.19.0 |
| builder 容器 Pi 专项 | 67 通过 | Linux 内真实锁定 SDK，mocked fetch，不发真实 Provider 请求 |
| 隔离本地 HTTP/SSE/DB 验收 | 11 项通过 | 真实服务路由、Pi SDK、临时 PostgreSQL；模型和外部认证网关模拟；包括实际 180000ms 超时 |
| builder 容器 HTTP/SSE/DB 验收 | 10 项通过，退出码 0 | 真实隔离 PostgreSQL，模型/外部网关模拟；无浏览器及 180 秒用例 |
| 最终镜像正式 index.js | readyz 200，off/on 的 persisted done、SSE/落库通过 | NODE_ENV=test、关闭多模态 runner；不声称生产环境/对象存储部署验证通过 |
| 浏览器 Run/Test | 通过 | 新首轮、连续请求、thinking on/off、停止、错误后重试、刷新恢复；新截图单独归档 |
| 浏览器历史加载屏障 | 通过 | 仅对本轮临时数据库持有显式事务锁，加载期间输入/发送禁用；回滚释放后恢复发送和保存 |

[结构化验证汇总](evidence/integrated-4afdfe2/verification.json)、[本地 11 项](evidence/integrated-4afdfe2/pi-core-local-20261016.json)、[容器 10 项](evidence/integrated-4afdfe2/pi-core-container-chain-20261016.json)、[最终镜像路由](evidence/integrated-4afdfe2/pi-container-runtime.json)、[容器环境](evidence/integrated-4afdfe2/pi-container-environment.json)。

## 4. 业务与故障证据

- 固定历史版本：创建 v2 后，旧会话继续执行 v1；多轮 `context_message_ids` 与执行历史一致。
- thinking off 不转发/保存思考；on 的可展示思考贯通 SDK → SSE → side_done/done → 数据库。没有可展示思考也可成功。
- 同线程 RUN_BUSY、不同线程全局名额、取消/断连、上游 503、真实默认超时、事务保存失败均验证失败策略和后续重试；并发用显式 barrier，保存故障只在临时库注入并移除触发器。
- 其他用户访问被拒绝且不触发 Provider；身份网关为本地模拟，归属校验与数据库为真实代码。
- 关闭 Pi 后同一会话使用 Legacy 继续历史；Pi 成功回答被原回答优化入口接受并创建 processing run，未执行完整模型分析/采纳。
- 浏览器 Test 对话保存 5 个问题、3 个成功回答；停止和失败仅保留问题。详见 [浏览器结果](evidence/integrated-4afdfe2/pi-browser-checks.json) 和 [数据库摘要](evidence/integrated-4afdfe2/pi-browser-database.json)。

本轮截图：[Run](evidence/integrated-4afdfe2/pi-run-page.png)、[Test 思考](evidence/integrated-4afdfe2/pi-test-thinking-page.png)、[历史加载禁发](evidence/integrated-4afdfe2/pi-history-loading-page.png)、[历史就绪后发送](evidence/integrated-4afdfe2/pi-history-resumed-page.png)、[停止](evidence/integrated-4afdfe2/pi-stop-page.png)、[错误](evidence/integrated-4afdfe2/pi-error-page.png)、[刷新恢复](evidence/integrated-4afdfe2/pi-refresh-page.png)。

## 5. 真实 Provider 与未覆盖范围

本轮没有再请求已确认无效的真实密钥。前轮已核查进程、`.env.local`、`.env`、`.env.docker` 和现有同项目服务容器；配置一致，两个项目已知 Moonshot endpoint 均返回鉴权 401。这里只保留 [历史真实探针](evidence/pi-real-provider.json) 和 [历史配置排查](evidence/pi-provider-config-audit.json) 作为未通过依据，不把它们标作整合版通过。

真实 Provider 最小成功、Tool Loop、取消仍受鉴权阻塞，未验证。真实外部认证、完整回答优化生成/采纳、生产 NODE_ENV、对象存储及部署也未在本轮联调。

前轮工具日志的密钥暴露事件已向用户提示需轮换，不在此重复秘密。新测试与验收脚本均使用隔离配置；提交前扫描任务文件和证据，排除环境文件、真实密钥、敏感完整日志、构建产物、临时集群及用户未跟踪规范。

## 6. 日志、追溯与环境清理

[本轮宿主 runId 证据](evidence/integrated-4afdfe2/pi-runid-trace.jsonl) 与 [容器 runId 证据](evidence/integrated-4afdfe2/pi-container-runid-trace.jsonl) 只保留事件、标识、状态和统计，不包含 prompt、凭证或完整工具输出。可串联路径选择、dispatch、Agent 模型请求、终态、保存和名额释放。

没有新增 execution_metadata_json。SSE/回答来源表不保存 runId，离线精确追溯仍依赖当时 stdout 日志；仓库未配置保留天数/轮转，不编造生产保留期限。证据字段或日志保留策略仍需工程负责人决定；沿用现有 SSE 路由。

本轮只使用独立临时 PostgreSQL、专用容器/网络与模拟网关。自建进程和容器在验收后停止；不停止或重启共享业务容器、不删除其 volume，Docker Desktop 保持运行。最终提交后停止写入，交由原会话独立复审并决定 push；本会话不 push。

当前结论：整合版本地、浏览器及隔离容器功能/故障验收通过；真实 Provider 验收仍未完成，不能宣称第一阶段全部验收通过。
