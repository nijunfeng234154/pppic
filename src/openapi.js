export function openapi(baseUrl) {
  const image = { type: 'object', required: ['id', 'name', 'url', 'links'], properties: {
    id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, url: { type: 'string', format: 'uri' }, size: { type: 'integer' }, format: { type: 'string' }, mime: { type: 'string' }, album: { type: 'string' }, favorite: { type: 'boolean' }, created_at: { type: 'string', format: 'date-time' }, storage: { type: 'string' },
    links: { type: 'object', properties: Object.fromEntries(['url', 'markdown', 'html', 'bbcode'].map(k => [k, { type: 'string' }])) },
  } };
  const response = (description, schema) => ({ description, ...(schema ? { content: { 'application/json': { schema } } } : {}) });
  const error = response('错误响应；详见 error.code、message、request_id', { $ref: '#/components/schemas/Error' });
  const wrapped = schema => ({ type: 'object', properties: { data: schema } });
  const imageRef = { $ref: '#/components/schemas/Image' };
  const uploadResponse = { type: 'object', required: ['created', 'data'], properties: { created: { type: 'boolean' }, data: imageRef } };
  const jsonBody = schema => ({ required: true, content: { 'application/json': { schema } } });
  const operation = (summary, status, schema, extra = {}) => ({ summary, responses: { [status]: response('成功', schema), '400': error, '401': error, '403': error, '404': error, '413': error, '415': error, '429': error, '503': error }, ...extra });
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  const key = { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, prefix: { type: 'string' }, scope: { type: 'string', enum: ['upload', 'read', 'manage'] }, created_at: { type: 'string', format: 'date-time' }, last_used_at: { type: ['string', 'null'] } } };
  return {
    openapi: '3.1.0', info: { title: 'pppic API', version: '0.1.0', description: '单租户图床。Bearer 管理口令或 API 密钥鉴权；浏览器也可使用会话 cookie，写入请求需匹配 PUBLIC_URL 的 Origin。upload 仅上传；read 仅读取；manage 可上传/读取/修改/删除图片。密钥管理仅允许管理员。' },
    servers: [{ url: baseUrl }], security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    paths: {
      '/healthz': { get: operation('数据库存活检查（不验证 S3）', 200, { type: 'object' }, { security: [] }) },
      '/api/v1/config': { get: operation('公开上传限制', 200, wrapped({ type: 'object' }), { security: [] }) },
      '/api/v1/session': {
        post: operation('使用管理员口令登录，创建 7 天会话', 200, wrapped({ type: 'object' }), { security: [], requestBody: jsonBody({ type: 'object', required: ['token'], properties: { token: { type: 'string' } } }) }),
        get: operation('获取当前认证状态', 200, wrapped({ type: 'object' })),
        delete: operation('注销当前 cookie 会话', 200, wrapped({ type: 'object' })),
      },
      '/api/v1/stats': { get: operation('图库统计、相册及配额（read/manage）', 200, wrapped({ type: 'object', properties: { images: { type: 'integer' }, bytes: { type: 'integer' }, favorites: { type: 'integer' }, albums: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, count: { type: 'integer' } } } }, storage_limit_bytes: { type: 'integer' }, storage_driver: { type: 'string' } } })) },
      '/api/v1/images': {
        get: operation('分页查询图片（read/manage）', 200, { ...wrapped({ type: 'array', items: imageRef }), properties: { data: { type: 'array', items: imageRef }, pagination: { type: 'object', properties: Object.fromEntries(['page', 'limit', 'total', 'pages'].map(k => [k, { type: 'integer' }])) } } }, {
          parameters: ['q', 'album', 'format', 'favorite', 'page', 'limit'].map(name => ({ name, in: 'query', schema: ['page', 'limit'].includes(name) ? { type: 'integer', minimum: 1, ...(name === 'limit' ? { maximum: 100, default: 24 } : { maximum: 1000000, default: 1 }) } : name === 'favorite' ? { type: 'boolean' } : { type: 'string' } })),
        }),
        post: operation('上传一张图片（upload/manage），按内容去重', 201, uploadResponse, {
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, album: { type: 'string', maxLength: 80 } } } } } },
          responses: { '201': response('新建图片', uploadResponse), '200': response('已有相同内容，created=false', uploadResponse), '400': error, '401': error, '403': error, '413': error, '415': error, '429': error, '503': error, '507': error },
        }),
      },
      '/api/v1/images/{id}': {
        parameters: [id],
        get: operation('获取图片信息（read/manage）', 200, wrapped(imageRef)),
        patch: operation('修改名称、相册或收藏（manage）', 200, wrapped(imageRef), { requestBody: jsonBody({ type: 'object', minProperties: 1, additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 240 }, album: { type: 'string', maxLength: 80 }, favorite: { type: 'boolean' } } }) }),
        delete: operation('永久删除图片及存储文件（manage）', 200, wrapped({ type: 'object', properties: { deleted: { type: 'boolean' } } })),
      },
      '/api/v1/keys': {
        get: operation('列出密钥（仅管理员，不返回原文或哈希）', 200, wrapped({ type: 'array', items: key })),
        post: operation('创建密钥（仅管理员），token 仅返回一次', 201, wrapped({ ...key, properties: { ...key.properties, token: { type: 'string' } } }), { requestBody: jsonBody({ type: 'object', required: ['name', 'scope'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, scope: { type: 'string', enum: ['upload', 'read', 'manage'] } } }) }),
      },
      '/api/v1/keys/{id}': { parameters: [id], delete: operation('撤销密钥（仅管理员）', 200, wrapped({ type: 'object' })) },
      '/i/{id}.{ext}': { parameters: [id, { name: 'ext', in: 'path', required: true, schema: { type: 'string', enum: ['png', 'jpg', 'gif', 'webp', 'avif'] } }], get: { summary: '公开原图（无需鉴权），支持 ETag', security: [], responses: { '200': { description: '原图字节', content: Object.fromEntries(['png', 'jpeg', 'gif', 'webp', 'avif'].map(type => ['image/' + type, { schema: { type: 'string', format: 'binary' } }])) }, '304': { description: '未修改' }, '404': error } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, sessionCookie: { type: 'apiKey', in: 'cookie', name: 'pppic_session' } },
      schemas: { Image: image, Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' } } } } } },
    },
  };
}
