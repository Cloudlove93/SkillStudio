# EduSkill 多模态 Skill Pack 运行与验收手册

文档状态：实现验收稿
适用范围：本地 Docker Compose 与同构测试环境
冻结规范：`docs/2026-08-20-multimodal-skill-pack-implementation-spec-feishu-v2.md`

## 1. 运行拓扑

`docker-compose.yml` 启动以下组件：

- PostgreSQL：保存 session、job、revision、lease、进度、错误和发布回执等业务事实。
- `educlaw-db-init`：一次性、可重复执行的 schema 初始化任务；成功后 Server 才能启动。
- MinIO：保存原始媒体、转录、帧、manifest 和发布引用。Bucket 保持私有，不配置已完成对象 TTL 或生命周期删除。
- `educlaw-minio-init`：只负责幂等建 Bucket 和设为 private，不删除对象。
- Node Server：公开 action、内部 Worker action、状态机、事务、SSE 和发布门禁的唯一权威。
- Web：多模态 Skill 工作台。
- 两个质量 Worker：只 claim `media_quality_check`。
- 两个蒸馏 Worker：claim `media_prepare`、`transcribe`、`frame_materialize`。

Worker 不连接数据库、不依赖共享磁盘或 sticky session。容器内临时文件只用于当前执行，恢复依据全部来自 Node、数据库和对象存储。

## 2. 配置与密钥

从 `.env.example` 复制本地配置，不要提交真实密钥。以下值必须由部署系统注入：

- `DATABASE_URL`
- `LLM_API_KEY`
- `MEDIA_UPLOAD_TOKEN_SECRET`
- `INTERNAL_WORKER_TOKENS`
- `MEDIA_WORKER_SERVICE_TOKEN`
- `MINIO_ROOT_USER`、`MINIO_ROOT_PASSWORD`

`INTERNAL_WORKER_TOKENS` 与 `MEDIA_WORKER_SERVICE_TOKEN` 在单 token 本地环境应取相同值。生产环境应使用高熵值并定期轮换。

预签名 URL 的 MinIO endpoint 必须同时能被浏览器与 Docker 容器解析。本地固定使用 `http://eduskill.localhost:9000`；容器通过 `host-gateway` 解析该主机名。签名 URL 只存在于短期 API 响应和 Worker 内存，不进入 session/job JSON、日志或 localStorage。

社区版 MinIO 使用 `MINIO_API_CORS_ALLOW_ORIGIN` 配置集群级 CORS。Bucket 仍为 private；CORS 不等于匿名授权。

## 3. 启动与健康检查

```powershell
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps -a
```

正确顺序为：PostgreSQL/MinIO healthy → 两个 init 任务 exit 0 → Server healthy → Web 与四个 Worker running。

检查外部入口：

```powershell
Invoke-WebRequest -UseBasicParsing http://eduskill.localhost/login
Invoke-WebRequest -UseBasicParsing http://eduskill.localhost:9000/minio/health/live
```

检查 Worker：

```powershell
docker compose --env-file .env.docker logs --since 30s educlaw-media-quality-worker educlaw-media-distillation-worker
```

空队列时 claim 返回 200 且无 job；不能出现持续 401、500 或 restart-loop。

## 4. 横向扩展

Compose 默认各运行两个 Worker。临时扩容示例：

```powershell
docker compose --env-file .env.docker up -d --scale educlaw-media-quality-worker=4 --scale educlaw-media-distillation-worker=4
```

每个容器用 hostname 形成独立 `MEDIA_WORKER_IDENTITY`。数据库通过 claim/CAS 保证同一 job 同一时刻只有一个有效 lease；过期 lease 可被任意实例回收。缩容不应删除对象或业务状态。

## 5. 故障恢复演练

### Worker 崩溃与 lease 回收

1. 在 job 为 `leased` 时停止持有 lease 的 Worker。
2. 不修改数据库 job 记录。
3. 等待 `lease_expires_at` 过期和生产回收扫描。
4. 确认另一个 Worker 以新 lease token、递增 attempt 继续；旧 Worker 的 late heartbeat/complete 返回冲突。

### Node 重启

```powershell
docker compose --env-file .env.docker restart educlaw-server
```

Server 恢复后由数据库 revision、job、lease、progress 和对象 manifest 继续，不依赖旧进程内存。Worker 对可重试网络错误退避后继续 claim。

### 页面刷新

页面只在 sessionStorage/localStorage 保存无凭据的 session resume 信息。刷新后重新拉 session detail、SSE 和短期预览 URL；不得持久化 upload token 或签名 URL。

### 冷启动顺序验证

只停止应用进程，不删除卷：

```powershell
docker compose --env-file .env.docker stop educlaw-web educlaw-media-quality-worker educlaw-media-distillation-worker educlaw-server
docker compose --env-file .env.docker up -d
```

必须再次观察到 init exit 0、Server healthy 后 Worker 才启动。

## 6. 对象保留规则

- 原始媒体、成功输出 manifest、转录、证据帧和发布引用永久保留。
- session 逻辑删除、取消、重试或发布失败都不能调用对象物理删除。
- 只允许 abort 尚未完成的 multipart upload；已完成 multipart 对象不得清理。
- 本地 Worker 可以清理自己当前任务的临时目录，这不属于对象存储删除。
- MinIO 配置中禁止 `mc ilm`、expire-days、noncurrent-expire 等完成对象生命周期规则。

## 7. 验收矩阵

| 场景 | 主要自动化证据 | 必须结果 |
| --- | --- | --- |
| 普通有声视频 | real media fixture、prepare/transcribe/frame tests | 音轨转录，语义时刻驱动候选帧 |
| 纯播客/音频 | audio fixture、audio-only pipeline tests | audio 为 M1，零帧合法 |
| 无音轨视频 | no-audio fixture、visual branch tests | 明确降级到视觉路径，不伪造转录 |
| PPT 转场 | scene/visual signal tests | 转场候选进入教学关键帧排序 |
| 黑板慢写 | slow-change/periodic coverage tests | 不只依赖 scene cut，周期与变化兜底 |
| 长视频 | 分段 ASR、持续下载心跳 tests | 分段转录，下载与执行期间 lease 受保护 |
| 损坏文件 | ffprobe/quality failure tests | 可诊断失败，不推进 trusted source |
| MIME 欺骗 | sniff/probe cross-check tests | 不信任上传 Content-Type，拒绝不一致 |
| 超限媒体 | streaming size/duration tests | 尽早中止，时长读取 Worker 配置 |
| 并发确认/发布 | CAS/idempotency/concurrency tests | 单次状态推进；同键重放、异载荷冲突 |
| 取消后 late result | lease/cancel tests | late heartbeat/complete 不能推进 session |
| Worker 横向扩展 | 双 runner tests、Compose 双副本 | 无共享内存/磁盘依赖，任意实例可接管 |

## 8. 发布与回滚

发布必须经过三次人工确认与 revision-bound Arena 门禁。Pipeline 完成后绝不自动发布。发布在一个 Node 数据库事务中创建 immutable skill version、package version 和映射，保存发布回执后才进入 `published`。

回滚部署时：

1. 将 `MULTIMODAL_PIPELINE_RUNNER_ENABLED=false`，停止新编排。
2. 停止两个 Worker service；保留 Server/Web 的既有功能。
3. 不删除 PostgreSQL/MinIO 卷，不逆向删除新增列或 `skill_media_jobs`。
4. 修复后重新启动 Worker；queued/failed-retryable job 按数据库事实继续。

## 9. 交付门禁

```powershell
pnpm check
pnpm --dir educlaw-web test
python -m pytest python/media_worker
docker compose --env-file .env.docker config --quiet
git diff --check
```

还应验证 Server/Web/Worker 三类 production image 可构建，Worker 镜像内能加载 FFmpeg、ffprobe、`faster_whisper` 和 `media_worker`。未经明确授权不得 commit 或 push。

## 10. 2026-08-23 本地验收证据

- `pnpm check`：通过；Server lint 0 error，Web lint 0 error/3 个既有 Hook warning；Server 76 个 test files 通过、1 个跳过，共 862 tests 通过、3 个跳过；shared、Server、Web production build 全部通过。
- `pnpm --dir educlaw-web test`：18 个 test files、82 tests 全部通过。
- `python -m pytest python/media_worker -rs`：255 tests 通过、3 个跳过；跳过项均为 Windows 当前账户无法创建 symlink 的防护分支，不是媒体主链路跳过。
- 真实媒体 fixture 已用 FFmpeg/ffprobe 跑通短音频、有声视频和无音轨视频；长媒体分段/心跳、PPT scene、黑板慢变化、MIME 欺骗、超限、取消后 late result 等由确定性 fixture/契约测试覆盖。
- 最新 production images 已构建；Server 运行时可加载 S3 SDK/presigner/ipaddr，Worker 可加载 `media_worker`，镜像内 FFmpeg 为 7.1.5。
- Compose 验收：PostgreSQL、MinIO、Server healthy；DB/MinIO init 均 exit 0；Web、两个质量 Worker、两个蒸馏 Worker running，全部 restart count 为 0；四个 Worker identity 互不相同，claim 请求持续返回 200。
- HTTP 验收：`http://eduskill.localhost/login` 返回 200；MinIO live 返回 200；从 `http://eduskill.localhost` 发起的 PUT CORS preflight 返回 204，并精确返回该 Origin。

本地验收不替代生产容量测试和产品人工走查。上线前仍需注入正式密钥与模型配置，按目标视频时长和并发量做压测，并轮换本地忽略文件中曾用于开发的真实样式凭据。上述活动不要求修改当前数据库或 Worker 架构。

## 11. 2026-08-27 Skill 工作区前端验收补充

- `pnpm check`：通过；Server/Web lint、Server tests、shared/Server/Web production build 全部通过。Server 为 77 个 test files 通过、1 个跳过，共 938 tests 通过、3 个跳过。
- `pnpm --dir educlaw-web test`：24 个 test files、175 tests 全部通过。除共享 Inspector 状态、URL 深链、所有权切换、字体与响应式视觉契约外，新增真实 React 挂载测试，验证切换 Inspector 视图不会卸载多模态表单或丢失输入状态。
- `python -m pytest python/media_worker -rs`：264 tests 通过、3 个因 Windows 当前账户无法创建 symlink 而跳过。
- Docker production Web 镜像已使用当前代码重建；`http://eduskill.localhost/login` 与 MinIO live 均返回 200，PostgreSQL、MinIO、Server、Web、两个质量 Worker 和两个蒸馏 Worker 均在运行。
- 浏览器矩阵使用当前 production Docker bundle，并仅拦截身份和首次只读列表接口以避免改写共享验收数据。375×812、768×1024、1024×768、1366×768、1440×900、1920×1080 六档均无横向溢出、页面异常或控制台错误，所有可见按钮均具有可访问名称。
- 浅色与深色主题均已视觉走查；`prefers-reduced-motion: reduce` 下 Inspector transition 为 `0s`。键盘已验证打开/关闭 Inspector、桌面端以方向键调整宽度、转录搜索筛选与结果播报；切换“处理状态/完整转录/处理诊断”期间任务名称不丢失。
- 音视频工作台的共享 Inspector 在桌面端占用固定右栏；768px 与 1024px 下收拢左栏并以不透底的右侧覆盖层呈现；375px 下以不透底的底部面板呈现。另覆盖“桌面全屏 Inspector 后缩至 375px”的断点切换，主内容仍可见且无横向溢出。
- 当前多模态懒加载 chunk 为 78.19 kB（gzip 24.63 kB），相对本轮基线仍在 15% 性能预算内。Vite 仍会报告仓库中既有的若干非 Skill 工作区大 chunk；本轮没有扩大这些历史 chunk。
