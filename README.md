# pppic

可自托管的私人图床，支持 Web 页面和 REST API（基于 HTTP 的程序调用接口）。零生产 npm 依赖，使用 Node.js 24、SQLite 和原生前端。

- 拖拽、选择、粘贴多图上传，独立上传进度、失败重试。
- PNG / JPEG / GIF / WebP / AVIF，默认单张 20 MiB，按内容去重。
- 图库搜索、格式筛选、分页、相册、收藏、网格/列表、批量删除。
- 复制直链、Markdown、HTML、BBCode；图库私有、分享链接公开。
- 管理员登录、HttpOnly 会话、可撤销的分权限 API 密钥。
- 本地磁盘和 S3 兼容存储（AWS S3、R2、MinIO 等）；S3 使用私有桶，通过图床转发原图。
- Docker Compose、健康检查、OpenAPI 规范和自动化测试。

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

本项目按 [AI-Fullstack-Delivery-Workflow](https://github.com/zhaoxuya520/AI-Fullstack-Delivery-Workflow) 的产品 → 全栈 → QA → 部署准备 → 文档链路交付。上游源码快照保存在 `.delivery-workflow/`。由于环境的 Git 网络和元数据写入限制，本次未获取上游 Git 历史、未初始化或提交当前项目。

## 当前边界

这是单管理员、单实例版本。未包含多用户注册、匿名上传、URL 抓取、图片压缩转码、内容审核、EXIF 清理和 CDN 配置；格式检查是文件头识别，不等于完整图片解码或恶意内容扫描。请只上传你信任的图片。不要将高熵公开链接视为私密文件访问控制。

Node.js 24 的内置 SQLite 在本机版本仍会输出实验性提示，数据库层已隔离以便后续替换。S3 适配通过本地契约测试，真实云账号与桶的连通性仍需部署后验证。未执行生产部署。
