# pppic 开发约定

默认使用中文，先给结论，保持简洁；不确定的信息需明确标注。保留用户修改，不覆盖已有文件。新增生产依赖前说明原因。代码变更必须运行相关测试。

## 产品交付流程

本项目使用 `.delivery-workflow/` 中的 AI-Fullstack-Delivery-Workflow。修改功能前读取其 `routing.md` 和对应角色的 `WORKFLOW.md`、具体技能；使用已有产品范围与数据契约，避免重新假设权限。

新功能遵循：产品范围及验收 → 接口/数据模型 → 端到端实现 → 测试 → 文档 → 经验沉淀。小型全栈功能使用 `workflows/fullstack-engineer/skills/e2e-feature-delivery/SKILL.md`。简单修复按相应角色处理，不必重走全部角色。

- 产品范围：`docs/产品与交付计划.md`
- 架构/权限：`docs/架构与配置说明.md`
- API 契约：`src/openapi.js`
- 验收证据：`docs/测试与验收报告.md`
- 已验证经验：`docs/交付经验.md`

## 工程约束

- Node.js 24.x，生产无 npm 依赖；SQLite 元数据与存储驱动分离。
- 单租户，管理接口私有，原图链接公开。不得把浏览器隐藏按钮当作权限校验。
- 不提交 `.env`、`data/` 或原始密钥，不在日志打印管理口令。
- 不改变现有数据库结构而不提供迁移、备份和恢复说明。
- 检查：`npm run check`；离线接口测试：`npm test`。
- 正常网络环境还需 `npm run test:http`；浏览器：`pnpm test:e2e`。
- 如果环境限制导致未验证，明确记录限制，不把请求注入测试写成真实 HTTP/浏览器测试通过。
