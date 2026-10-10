# biz-reporting-system-ecs（最纯净 ECS 部署包）

从原 `biz-reporting-system-clean` 仓库裁剪出的、**仅用于阿里云 ECS 部署**的最小工程包。
去掉了所有 AI 生成文档、规格说明、规则库、CloudBase 专属配置与本地构建产物，只保留可构建与可运行的必要文件。

## 目录结构

```
biz-reporting-system-ecs/
├── Dockerfile                # API 多阶段构建（ECS/任意 Docker 主机通用）
├── package.json              # pnpm monorepo 根
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── .dockerignore / .gitignore
├── apps/
│   ├── api/                  # NestJS 后端源码（含 migration/ 迁移脚本）
│   └── admin-web/            # React 管理后台源码
├── packages/
│   ├── shared-constants/     # 共享常量
│   └── shared-types/         # 共享类型
├── scripts/                  # 迁移与初始化脚本（scripts/db/migrate.mjs）
├── sql/                      # 增量 SQL 迁移
└── deploy/
    └── ecs/                  # ★ 阿里云 ECS 部署配置（详见 deploy/ecs/README.md）
        ├── compose.yml
        ├── frontend.Dockerfile
        ├── migrate.Dockerfile
        ├── frontend-nginx.conf
        ├── mysql/my.cnf
        ├── .env.example
        ├── backup.sh
        └── README.md
```

## 与原仓库相比，已剔除

- `docs/`、`specs/`、`rules/`、`evidence/` 全部 AI 生成文档与规格
- 根目录各类 `*报告*.md`、`phase*.md`、`*指南*.md`、`CLEANUP-REPORT.md` 等
- `cloudbaserc.json`、`.cloudbaserc`（CloudBase 专属）
- `node_modules/`、`dist/`（构建产物，镜像内重新构建）
- `.git/`、`*.tsbuildinfo`、`*.log`、`*.sqlite`、临时脚本（`scripts/oneoff`、`tmp_*.mjs` 等）

## 如何部署

1. 将本目录传到阿里云 ECS。
2. 进入 `deploy/ecs`，按 `deploy/ecs/README.md` 操作：
   - `cp .env.example .env` 并填写密钥/数据库/域名
   - `docker compose --env-file .env run --rm --profile init migrate` 初始化库
   - `docker compose --env-file .env up -d --build` 启动
3. 域名解析 + 阿里云 SLB(HTTPS) 回源到 ECS 的 `HTTP_PORT`。

## 注意

- 数据库从 CloudBase MySQL 迁过来时，注意字符集 `utf8mb4`、时区、密钥独立生成。
- 小程序 request 合法域名需 HTTPS + 备案。
