# 阿里云 ECS 部署手册（最纯净版）

本目录是用于**阿里云 ECS** 的部署编排，已移除原 NAS 部署的 Nginx Proxy Manager 与 Cloudflare 隧道，仅保留最精简的服务组合：

- `mysql`：数据库（持久化到 `DATA_ROOT` 指定的数据盘路径）
- `api`：NestJS 后端（由根目录 `Dockerfile` 构建）
- `frontend`：Nginx 静态站 + `/api` 反向代理（同域部署，免去跨域）
- `migrate`：一次性迁移服务（`--profile init` 触发，建表/增量迁移）

## 前置条件

1. ECS 实例已安装 Docker 与 docker compose v2（建议 4C8G 起）。
2. 已挂载数据盘并格式化，例如挂载到 `/data`（数据库与备份放在 `/data/biz-reporting`）。
3. 已准备**已备案**的公网域名（如 `example.com`），用于访问与小程序的 request 合法域名。
4. （推荐）在阿里云 **SLB（负载均衡）** 或 **CDN** 上申请免费 SSL 证书，将 443 终止在 SLB，回源到 ECS 的 `HTTP_PORT`（默认 80）。这样容器内无需管理证书。

## 部署步骤

### 1. 上传/放置本包
将整个 `biz-reporting-system-ecs` 目录放到 ECS，进入 `deploy/ecs`：

```bash
cd /path/to/biz-reporting-system-ecs/deploy/ecs
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 用 vim/nano 编辑 .env，至少填入：
#   DATA_ROOT=/data/biz-reporting
#   DB_DATABASE / DB_USERNAME / DB_PASSWORD / MYSQL_ROOT_PASSWORD
#   JWT_SECRET / AUTH_SECURITY_HMAC_KEY  (各 ≥32 位随机串)
#   DOMAIN=你的域名
openssl rand -hex 24   # 用来生成 JWT_SECRET / AUTH_SECURITY_HMAC_KEY
```

### 3. 首次：初始化数据库（建表 + 增量迁移）

```bash
docker compose --env-file .env run --rm --profile init migrate
```

该命令执行一次后退出；`migrate` 服务带 `profiles: ["init"]`，不会常驻。

### 4. 启动全部服务

```bash
docker compose --env-file .env up -d --build
```

- 镜像首次构建会拉取依赖并编译（api / frontend），耗时取决于网络。
- 构建完成后：`frontend` 监听 `HTTP_PORT`(默认 80)，`api` 在内部 3000。

### 5. 配置域名与 HTTPS

- 在域名解析把 `example.com` 指向 ECS 公网 IP（或 SLB）。
- 在阿里云 SLB 监听 443 → 后端 ECS:80，并绑定 SSL 证书；健康检查路径可用 `/`。
- 小程序后台「request 合法域名」填 `https://example.com`（必须 HTTPS + 备案）。

### 6. 验证

```bash
curl -f http://localhost:${HTTP_PORT}/api/health/live   # 应返回 ok
curl -f http://localhost:${HTTP_PORT}/                                  # 应返回 HTML
```

浏览器访问 `https://example.com` 应打开管理后台。

## 日常运维

```bash
# 查看日志
docker compose --env-file .env logs -f api
docker compose --env-file .env logs -f frontend

# 停止 / 启动
docker compose --env-file .env down
docker compose --env-file .env up -d

# 数据库备份（输出到 $DATA_ROOT/backups/mysql）
bash backup.sh

# 升级（更新代码后重新构建）
docker compose --env-file .env up -d --build
```

## 数据迁移（从 CloudBase MySQL 迁过来）

1. 从 CloudBase 导出 SQL 备份（或开外网地址用 `mysqldump`）。
2. 在本机/跳板机执行：
   ```bash
   mysql -h <ECS_IP> -P 3306 -u "$DB_USERNAME" -p "$DB_DATABASE" < cloudbase_dump.sql
   ```
   也可在 ECS 上通过 `docker compose exec -T mysql mysql ...` 导入。
3. 字符集务必 `utf8mb4`，时区 Asia/Shanghai（my.cnf 已设）。

## 备注

- 数据库网络 `biz_db` 为 `internal: true`，仅容器间可达，**不会**暴露到公网。
- `frontend` 已把 `/api` 代理到 `api:3000`，因此小程序/前端均访问同一域名，无需额外 CORS 跨域配置（CORS_ORIGINS 仅作兜底）。
- 若需微信登录，填 `WECHAT_APPID` / `WECHAT_SECRET`，并配置小程序登录回调域名。
