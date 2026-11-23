# pppic

可自托管的私人图床，支持 Web 页面和 REST API（基于 HTTP 的程序调用接口）。零生产 npm 依赖，使用 Node.js 24、SQLite 和原生前端。

- 拖拽、选择、粘贴多图上传，独立上传进度、失败重试。
- PNG / JPEG / GIF / WebP / AVIF，默认单张 20 MiB，按内容去重。
- 图库搜索、格式筛选、分页、相册、收藏、网格/列表、批量删除。
- 复制直链、Markdown、HTML、BBCode；图库私有、分享链接公开。
- 管理员登录、HttpOnly 会话、可撤销的分权限 API 密钥。
- 本地磁盘和 S3 兼容存储（AWS S3、R2、MinIO 等）；S3 使用私有桶，通过图床转发原图。
- Docker Compose、健康检查、OpenAPI 规范和自动化测试。

## Docker Compose 部署（推荐）

服务器需要安装 Docker Engine 和 Docker Compose v2（容器编排工具），无需安装 Node.js 或 npm 依赖。仓库使用根目录的 `Dockerfile` 和 `docker-compose.yaml` 构建并启动服务。

```bash
git clone https://github.com/nijunfeng234154/pppic.git
cd pppic
# 仅首次创建；已有 .env 时直接编辑，避免覆盖
cp -n .env.example .env
docker compose -f docker-compose.yaml up -d --build --wait
docker compose -f docker-compose.yaml ps
curl --fail http://localhost:3333/healthz
```

在部署主机打开 **http://localhost:3333**。首次启动自动生成管理口令，仅在自己的终端查看：

```bash
docker compose -f docker-compose.yaml exec pppic cat /app/data/admin-token
```

如果设置了 `ADMIN_TOKEN`，使用该值登录，不会生成上述文件。口令需为 24–512 个无空白字符。容器以非 root 用户运行，使用只读根文件系统、512 MiB 内存上限、1 CPU 上限和日志轮转；镜像内置 `/healthz` 健康检查。健康检查用于报告状态，进程退出时由重启策略重启，健康检查失败本身不会自动重启容器。

### 部署配置

编辑 `.env` 后重新执行 `docker compose -f docker-compose.yaml up -d --build --wait`：

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3333` | 主机端口，容器内部始终为 3333 |
| `PUBLIC_URL` | `http://localhost:3333` | 实际浏览器访问的源地址，同时用于分享链接和来源校验 |
| `ADMIN_TOKEN` | 留空 | 首次自动生成并保存到数据卷，也可自行设置 |
| `MAX_UPLOAD_MB` | `20` | 单张图片上限，单位 MiB |
| `STORAGE_LIMIT_MB` | `10240` | 图片存储配额，单位 MiB |
| `COOKIE_SECURE` | `false` | HTTPS 部署设置为 `true` |
| `STORAGE_DRIVER` | `local` | `local` 本地磁盘或 `s3` 对象存储 |

默认端口仅绑定主机 `127.0.0.1`。公网部署请用 Nginx 等反向代理转发至 `127.0.0.1:3333`，将 `PUBLIC_URL` 改为实际 HTTPS 域名（例如 `https://img.example.com`），并设置 `COOKIE_SECURE=true`。在远程服务器上测试时，也可通过 SSH 端口转发访问。完整反向代理示例见[部署与回滚](docs/部署与回滚.md)。

修改 `PORT` 时同步修改 `.env` 中的 `PUBLIC_URL`；不提供 `PUBLIC_URL` 时 Compose 会按 `PORT` 生成 localhost 地址。`.env` 中 `HOST`、`DATA_DIR` 用于本地 Node 启动；容器固定使用 `0.0.0.0` 和 `/app/data`。

启用 S3 时设置 `STORAGE_DRIVER=s3`，并填写 `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`。使用专用私有桶；SQLite 元数据仍保存在本地数据卷，切换驱动不会自动迁移已有图片。

### 日常运维

```bash
# 查看日志
docker compose -f docker-compose.yaml logs --tail=100 -f pppic
# 重启
docker compose -f docker-compose.yaml restart pppic
# 更新前先按部署文档备份数据并记录当前提交
git rev-parse HEAD
git pull --ff-only
docker compose -f docker-compose.yaml up -d --build --wait
# 停止并移除容器，保留数据卷
docker compose -f docker-compose.yaml down
```

图片、SQLite 和自动生成的管理口令保存在项目数据卷 `pppic_data`（实际名称带 Compose 项目前缀）。部署目录或项目名应保持稳定，以免误用新卷。**不要执行 `docker compose down -v`，它会删除数据卷。** 完整备份、恢复与回滚步骤见[部署与回滚](docs/部署与回滚.md)。

## 本地启动

需要 **Node.js 24.x**。运行服务不需要安装 npm 包：

```bash
npm start
```

打开 **http://localhost:3333**。首次启动生成随机管理口令，文件为 `data/admin-token`，仅在本机查看：

```bash
cat data/admin-token
```

可选：复制 `.env.example` 为 `.env` 后调整设置。已有 `.env` 时直接编辑，不要覆盖。开发热重载用 `npm run dev`。

`PUBLIC_URL` 必须与浏览器访问的源地址完全一致，包括协议、域名、端口，不带路径。例如使用 `http://127.0.0.1:3333` 访问时，要把 `PUBLIC_URL` 也设置为该地址，否则写入请求会因来源校验被拒绝。

## API 调用

先在 Web 的「API 密钥」页面创建密钥，完整密钥只显示一次。以下环境变量使用你刚创建的密钥；不要提交到代码仓库。

```bash
read -r -s PPPIC_API_KEY
export PPPIC_API_KEY
curl http://localhost:3333/api/v1/images \
  -H "Authorization: Bearer $PPPIC_API_KEY" \
  -F 'file=@/path/to/image.png' \
  -F 'album=我的博客'
```

响应示例：

```json
{
  "created": true,
  "data": {
    "id": "图片唯一标识",
    "name": "image.png",
    "url": "http://localhost:3333/i/图片唯一标识.png",
    "links": {
      "url": "图片直链",
      "markdown": "![image.png](图片直链)",
      "html": "<img src=\"图片直链\" alt=\"image.png\">",
      "bbcode": "[img]图片直链[/img]"
    }
  }
}
```

重复内容返回 HTTP 200 和 `created: false`，复用原记录的名称、相册和链接；新内容返回 201。每次请求只接收一张图片，多张请分开发送。

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| POST | `/api/v1/images` | upload / manage |
| GET | `/api/v1/images?q=&album=&format=&favorite=&page=1&limit=24` | read / manage |
| GET | `/api/v1/images/{id}` | read / manage |
| PATCH | `/api/v1/images/{id}`，字段 name、album、favorite | manage |
| DELETE | `/api/v1/images/{id}` | manage |
| GET | `/api/v1/stats` | read / manage |
| GET / POST | `/api/v1/keys` | 仅管理员 |
| DELETE | `/api/v1/keys/{id}` | 仅管理员 |
| GET / HEAD | `/i/{id}.{ext}` | 公开 |
| GET | `/healthz` | 公开 |

管理员可使用管理口令作为 Bearer 凭证；应用应使用独立 API 密钥。所有密钥都不能管理其他密钥。服务默认不开放跨域读取（CORS）；跨站应用请通过自己的服务端调用 API。

OpenAPI（机器可读接口规范）位于 `/api/openapi.json`，也可在 Web「接口文档」中查看用法。错误响应统一为 `{"error":{"code":"…","message":"…","request_id":"…"}}`。

## 测试

```bash
npm run check
npm test                     # 16 项单元/请求注入集成测试，不需要开放端口
npm run test:http            # 同一套接口测试使用真实 HTTP，需要允许监听本机端口
```

浏览器测试使用开发依赖 Playwright（浏览器自动化测试工具），不会进入生产镜像：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm test:e2e
```

浏览器测试在独立临时目录启动 3344 端口，覆盖桌面和手机的登录、上传、收藏、编辑、搜索、删除、密钥撤销和注销，不会操作正式 `data/`。测试结束清理临时目录，失败保留截图和 trace 到 `test-results/`。首次安装浏览器需要联网。

当前环境的验证结果及限制见 [测试与验收报告](docs/测试与验收报告.md)。GitHub Actions 配置已准备，尚未在远程仓库运行。

## 部署与项目流程

- [产品与交付计划](docs/产品与交付计划.md)
- [架构与配置说明](docs/架构与配置说明.md)
- [部署与回滚](docs/部署与回滚.md)
- [测试与验收报告](docs/测试与验收报告.md)
- [交付经验](docs/交付经验.md)

本项目按 [AI-Fullstack-Delivery-Workflow](https://github.com/zhaoxuya520/AI-Fullstack-Delivery-Workflow) 的产品 → 全栈 → QA → 部署准备 → 文档链路交付。上游源码快照保存在 `.delivery-workflow/`。部署验证状态见[测试与验收报告](docs/测试与验收报告.md)。

## 当前边界

这是单管理员、单实例版本。未包含多用户注册、匿名上传、URL 抓取、图片压缩转码、内容审核、EXIF 清理和 CDN 配置；格式检查是文件头识别，不等于完整图片解码或恶意内容扫描。请只上传你信任的图片。不要将高熵公开链接视为私密文件访问控制。

Node.js 24 的内置 SQLite 在本机版本仍会输出实验性提示，数据库层已隔离以便后续替换。S3 适配通过本地契约测试，真实云账号与桶的连通性仍需部署后验证。未执行生产部署。
