# 系统部署说明

本文依据当前 Docker Compose、Dockerfile 和部署脚本整理。生产目标、认证服务和模型服务由部署环境提供；本地示例变量不能直接用于公网生产。

## 1. 部署组成

| 组件 | 用途 | 配置入口 |
| --- | --- | --- |
| `educlaw-web` | 构建 React 静态站点，由 Nginx 容器服务并代理 API / 认证请求 | `educlaw-web/Dockerfile`、`educlaw-web/nginx/` |
| `educlaw-server` | Express API、业务编排和运行时接口，默认容器端口 3000 | `educlaw-server/Dockerfile` |
| `educlaw-db` | PostgreSQL 17 业务数据库 | Compose 的 `postgres-data` 卷 |
| `educlaw-db-init` | 等待数据库就绪后初始化 / 更新 schema | Server 镜像中的 `init-db.js` |
| `educlaw-minio` | 本地开发用 SeaweedFS S3 兼容对象存储 | Compose 的 `minio-data` 卷 |
| Media Workers | 处理质量检查和蒸馏任务，开发环境位于 `media` profile | `python/media_worker/Dockerfile` |
| `auth-service` | 外部认证 / SSO 服务；Compose 通过外部 Docker 网络连接 | `auth-service/`，网络名由 `AUTH_NETWORK_NAME` 指定 |
| 模型服务 | 兼容 OpenAI API 的外部模型端点 | `LLM_BASE_URL`、`LLM_API_KEY`、模型名 |

## 2. 准备环境配置

1. 复制根目录 `.env.example` 为部署专用环境文件，例如 `.env`（开发脚本要求 `.env.docker`）。
2. 设置 PostgreSQL、认证网络、应用来源、对象存储、内部 Worker token 和模型提供方变量。
3. 为生产环境替换示例密码和 token，按密钥管理系统注入真实值。不要把生产 `.env` 加入 Git 或写进镜像。
4. 使用真实域名配置 `APP_ORIGIN`，并确认对象存储签名 URL 能从浏览器和容器访问；多模态上传要求端点的网络可达。

应用实际读取的环境变量以 `docker-compose.yml`、`docker-compose.dev.yml` 和各模块配置代码为准。`.env.example` 同时保留了开发占位值，启动前须逐项审阅。

## 3. Docker Compose 服务部署

### 前置条件

- 已安装并启动 Docker Engine / Docker Compose v2。
- `auth-service` 已部署，且共享网络存在。生产 compose 默认使用 `${AUTH_NETWORK_NAME:-auth-service_internal-net}` 外部网络；开发脚本也会检查 `auth-service_internal-net`。
- `.env` 中配置数据库凭据、服务间 token、对象存储凭据和模型服务参数。
- 如果部署媒体 Worker，另行确认磁盘、CPU、媒体大小上限和 ASR 资源足够。

### 启动

在仓库根目录执行：

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Compose 会构建前后端及 Worker 镜像；Server 等待 `educlaw-db-init` 完成后启动，Web 等待 Server 健康检查成功。生产 compose 默认声明媒体 Worker 服务；开发 compose 将 Worker 放在 `media` profile 下。

查看服务日志：

```sh
docker compose logs -f educlaw-server
docker compose logs -f educlaw-db-init
```

验证 Server readiness：

```sh
curl --fail http://127.0.0.1:3000/readyz
```

应用入口由 `APP_ORIGIN`、反向代理和认证服务路由决定。不要在公网直接暴露数据库、对象存储管理接口或内部 Worker token 接口。

### 本地开发 Compose

Windows 开发环境可按 `scripts/dev-docker.ps1` 使用 `.env.docker`：

```powershell
.\scripts\dev-docker.ps1 -Action validate
.\scripts\dev-docker.ps1 -Action bootstrap
.\scripts\dev-docker.ps1 -Action status
```

脚本要求 Docker context 为 `desktop-linux`，且认证网络已存在。`bootstrap` 构建并启动开发 Web；`start-media` / `stop-media` 启停 `media` profile Worker。请在运行前核对脚本中的网络名和本机配置。

## 4. 停止、更新与持久化

```sh
docker compose down
```

该命令保留命名卷。不要加 `-v`，除非明确要删除 PostgreSQL 和对象存储持久化数据。

更新镜像后执行 `docker compose up -d --build`，确认 `educlaw-db-init`、Server 和 Web 状态正常，再检查日志与核心用户路径。部署前后都应记录镜像 / Git 提交版本。

Compose 文件提供 `postgres-data` 与 `minio-data` 命名卷，但仓库没有自动备份 / 恢复工作流。上线前须由部署负责人制定数据库和对象存储的备份策略，并完成恢复演练；两边的数据需保持可对应，RPO / RTO 根据实际演练确定。

## 5. Linux 无 Docker 部署脚本

仓库提供 [`scripts/deploy-prod.sh`](../../scripts/deploy-prod.sh)，目标为 Ubuntu / Debian 上的传统部署：安装 Node.js、pnpm、PostgreSQL 和 Nginx，构建静态前端，使用 systemd（或无 systemd 时 tmux）运行 Server。

该脚本会写入 `.env`、配置本机数据库及 Nginx，并要求 root 权限。运行前应审阅脚本、确认主机和环境变量、准备可恢复的数据库备份。它不自动部署当前 Compose 中的 SeaweedFS 对象存储、媒体 Worker 或 `auth-service`，需要这些功能的环境必须另外配置并验证。脚本内的模型默认值和健康检查路径属于该部署路径，不应覆盖 Compose 环境的配置说明。

示例：

```sh
APP_HOST=example.org bash scripts/deploy-prod.sh
```

部署后脚本检查本机后端 `/healthz` 和 Nginx 前端响应。对外域名、TLS、认证网关、对象存储、媒体 Worker、数据库备份及告警需要由运维环境额外配置；脚本成功结束不等同于完成这些检查。

## 6. 健康检查与运维

- Compose Server readiness 使用 `/readyz`；传统 Linux 脚本使用 `/healthz`。探针不能证明外部模型服务或认证系统可用。
- 生产 compose 的 Server 停机宽限为 45 秒；服务应按受支持的 drain / shutdown 语义更新，不要以强制杀进程作为常规发布方法。
- 调整 Worker 并发、模型超时、媒体上传限制或 ASR 参数前，应评估数据库连接、CPU、内存和对象存储带宽。
- 生产环境不要默认开放 `MINIO_CONSOLE_PORT`、PostgreSQL 或内部服务端口到公网。
- 日志包含请求上下文与结构化错误；限制访问范围并设置符合数据保留要求的轮转策略。
- Compose 配置当前提供 readiness / 容器重启策略，但仓库未包含完整监控告警、TLS 证书和自动备份实现。

## 7. 部署验收记录

每次正式部署应记录 Git 提交、镜像版本、部署环境、变更配置项（不含密钥）、数据库初始化结果、服务健康状态、认证与模型验证结果、核心工作流结果、备份点、回滚方式和执行人。失败或未执行项应保留为待处理状态，不计为通过。
