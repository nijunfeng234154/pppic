import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openDatabase } from './db.js';
import { LocalStorage, S3Storage } from './storage.js';
import { detectImage, formats } from './image.js';
import { openapi } from './openapi.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
class HttpError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
function text(value, label, max, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(400, 'INVALID_INPUT', `${label}格式不正确（最多 ${max} 字符）`);
  return value.trim();
}
function pageNumber(value, fallback, max) {
  if (value == null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value)) || Number(value) > max) fail(400, 'INVALID_PAGINATION', '分页参数无效');
  return Number(value);
}
async function body(req, max) {
  if (Number(req.headers['content-length']) > max) { req.resume(); fail(413, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制'); }
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort); };
    const onError = error => { cleanup(); reject(error); };
    const onAbort = () => onError(new HttpError(400, 'REQUEST_ABORTED', '请求已中断'));
    const onEnd = () => { cleanup(); resolve(Buffer.concat(parts)); };
    const onData = chunk => {
      size += chunk.length;
      if (size > max) {
        parts.length = 0;
        cleanup();
        req.on('error', () => {});
        req.resume();
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制'));
      } else parts.push(chunk);
    };
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAbort);
  });
}
async function jsonBody(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED', '请使用 application/json');
  const bytes = await body(req, 16384);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(400, 'INVALID_JSON', 'JSON 格式错误'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_JSON', '需要 JSON 对象');
  return value;
}

export function createApp(config, options = {}) {
  const db = options.db || openDatabase(join(config.dataDir, 'pppic.sqlite'));
  const stores = { local: new LocalStorage(join(config.dataDir, 'uploads')) };
  if (config.s3?.endpoint) stores.s3 = new S3Storage(config.s3, options.fetcher);
  if (options.storage) stores[config.driver] = options.storage;
  let mutation = Promise.resolve();
  function exclusive(fn) {
    const next = mutation.then(fn);
    mutation = next.catch(() => {});
    return next;
  }
  let activeUploads = 0;
  let activeMedia = 0;
  const attempts = new Map();
  const cleanup = setInterval(() => {
    const time = Date.now();
    for (const [ip, value] of attempts) if (value.until <= time) attempts.delete(ip);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(time);
  }, 60000).unref();
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const serialize = row => {
    const url = `${config.publicUrl}/i/${row.id}.${row.ext}`;
    const alt = row.name.replace(/[\[\]<>"'\\]/g, '');
    return { id: row.id, name: row.name, size: row.size, format: row.ext, mime: row.mime, album: row.album, favorite: Boolean(row.favorite), created_at: row.created_at, storage: row.driver, url,
      links: { url, markdown: `![${alt}](${url})`, html: `<img src="${url}" alt="${alt.replace(/&/g, '&amp;')}">`, bbcode: `[img]${url}[/img]` } };
  };
  function auth(req, scope = 'read', adminOnly = false) {
    const authorization = req.headers.authorization;
    if (authorization) {
      const token = authorization.match(/^Bearer (\S+)$/i)?.[1];
      if (!token || token.length > 512) fail(401, 'UNAUTHORIZED', 'API 密钥无效');
      const tokenHash = hash(token);
      if (timingSafeEqual(Buffer.from(tokenHash), Buffer.from(hash(config.adminToken)))) return { admin: true };
      const key = db.prepare('SELECT * FROM api_keys WHERE hash=?').get(tokenHash);
      if (!key) fail(401, 'UNAUTHORIZED', 'API 密钥无效或已撤销');
      if (adminOnly || !(key.scope === 'manage' || key.scope === scope)) fail(403, 'FORBIDDEN', '当前密钥没有执行此操作的权限');
      db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=?').run(now(), key.id);
      return { admin: false };
    }
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('pppic_session='))?.slice(14);
    if (token && token.length <= 512 && db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires_at>?').get(hash(token), Date.now())) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.publicUrl) fail(403, 'INVALID_ORIGIN', '请求来源不匹配，请检查 PUBLIC_URL');
      return { admin: true, session: hash(token) };
    }
    fail(401, 'UNAUTHORIZED', '请先登录或提供 Bearer API 密钥');
  }
  function origin(req) {
    if (req.headers.origin && req.headers.origin !== config.publicUrl) fail(403, 'INVALID_ORIGIN', '请求来源不匹配，请检查 PUBLIC_URL');
  }
  const cookie = (token, maxAge) => `pppic_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.cookieSecure ? '; Secure' : ''}`;

  const server = createServer({ requestTimeout: 60000, headersTimeout: 15000, maxHeaderSize: 16384 }, async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://internal');
      const path = url.pathname;
      const method = req.method;
      if (path === '/healthz' && method === 'GET') {
        db.prepare('SELECT 1').get();
        return json(res, 200, { status: 'ok', version: '0.1.0' });
      }
      if (path === '/api/openapi.json' && method === 'GET') return json(res, 200, openapi(config.publicUrl));
      if (path === '/api/v1/config' && method === 'GET') return json(res, 200, { data: { max_upload_bytes: config.maxUploadBytes, formats, public_url: config.publicUrl } });
      if (path === '/api/v1/session' && method === 'POST') {
        origin(req);
        const ip = req.socket.remoteAddress;
        const time = Date.now();
        let attempt = attempts.get(ip);
        if (!attempt || attempt.until < time) {
          if (attempts.size >= 10000) fail(429, 'RATE_LIMITED', '登录请求过多，请稍后再试');
          attempt = { count: 0, until: time + 15 * 60000 };
          attempts.set(ip, attempt);
        }
        if (++attempt.count > 10) { res.setHeader('Retry-After', String(Math.ceil((attempt.until - time) / 1000))); fail(429, 'RATE_LIMITED', '尝试次数过多，请 15 分钟后重试'); }
        const input = await jsonBody(req);
        if (typeof input.token !== 'string' || input.token.length > 512 || !timingSafeEqual(Buffer.from(hash(input.token)), Buffer.from(hash(config.adminToken)))) fail(401, 'UNAUTHORIZED', '管理口令错误');
        const token = randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO sessions(hash,expires_at) VALUES (?,?)').run(hash(token), time + 7 * 86400000);
        res.setHeader('Set-Cookie', cookie(token, 7 * 86400));
        return json(res, 200, { data: { authenticated: true } });
      }
      if (path === '/api/v1/session') {
        const user = auth(req);
        if (method === 'GET') return json(res, 200, { data: { authenticated: true, admin: user.admin } });
        if (method === 'DELETE') {
          if (user.session) db.prepare('DELETE FROM sessions WHERE hash=?').run(user.session);
          res.setHeader('Set-Cookie', cookie('', 0));
          return json(res, 200, { data: { authenticated: false } });
        }
      }
      const media = path.match(/^\/i\/([a-f0-9-]{36})\.(png|jpg|gif|webp|avif)$/);
      if (media && ['GET', 'HEAD'].includes(method)) {
        const image = db.prepare('SELECT * FROM images WHERE id=? AND ext=?').get(media[1], media[2]);
        if (!image) fail(404, 'NOT_FOUND', '图片不存在或已删除');
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        res.setHeader('ETag', `"${image.hash}"`);
        res.setHeader('Content-Type', image.mime);
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        if (req.headers['if-none-match'] === `"${image.hash}"`) { res.writeHead(304); return res.end(); }
        res.setHeader('Content-Length', image.size);
        if (method === 'HEAD') { res.writeHead(200); return res.end(); }
        if (activeMedia >= 16) fail(503, 'BUSY', '图片读取繁忙，请稍后重试');
        activeMedia++;
        try {
          if (!stores[image.driver]) fail(503, 'STORAGE_UNAVAILABLE', '请恢复该图片使用的存储配置');
          const stream = await stores[image.driver].stream(image.object_key);
          res.writeHead(200);
          await pipeline(stream, res);
        } finally { activeMedia--; }
        return;
      }
      if (path === '/api/v1/stats' && method === 'GET') {
        auth(req);
        const totals = db.prepare('SELECT COUNT(*) AS images, COALESCE(SUM(size),0) AS bytes, COALESCE(SUM(favorite),0) AS favorites FROM images').get();
        const albums = db.prepare("SELECT album AS name, COUNT(*) AS count FROM images WHERE album<>'' GROUP BY album ORDER BY album").all();
        return json(res, 200, { data: { ...totals, albums, storage_limit_bytes: config.storageLimitBytes, storage_driver: config.driver } });
      }
      if (path === '/api/v1/images' && method === 'GET') {
        auth(req);
        const page = pageNumber(url.searchParams.get('page'), 1, 1000000);
        const limit = pageNumber(url.searchParams.get('limit'), 24, 100);
        const clauses = [];
        const args = [];
        const q = text(url.searchParams.get('q'), '搜索词', 200);
        if (q) { clauses.push("name LIKE ? ESCAPE '\\'"); args.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%'); }
        if (url.searchParams.has('album')) { clauses.push('album=?'); args.push(text(url.searchParams.get('album'), '相册', 80)); }
        const format = url.searchParams.get('format');
        if (format) { if (!formats.includes(format)) fail(400, 'INVALID_FORMAT', '不支持的格式'); clauses.push('ext=?'); args.push(format); }
        const favorite = url.searchParams.get('favorite');
        if (favorite != null) { if (!['true', 'false'].includes(favorite)) fail(400, 'INVALID_INPUT', 'favorite 需为 true/false'); clauses.push('favorite=?'); args.push(favorite === 'true' ? 1 : 0); }
        const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
        const total = db.prepare('SELECT COUNT(*) AS count FROM images' + where).get(...args).count;
        const rows = db.prepare('SELECT * FROM images' + where + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(...args, limit, (page - 1) * limit);
        return json(res, 200, { data: rows.map(serialize), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      }
      if (path === '/api/v1/images' && method === 'POST') {
        auth(req, 'upload');
        if (activeUploads >= 4) { res.setHeader('Retry-After', '2'); fail(429, 'UPLOAD_BUSY', '上传繁忙，请稍后重试'); }
        activeUploads++;
        try {
          const contentType = req.headers['content-type'] || '';
          if (!/^multipart\/form-data\s*;/i.test(contentType)) fail(415, 'MULTIPART_REQUIRED', '请使用 multipart/form-data 的 file 字段');
          const bytes = await body(req, config.maxUploadBytes + 65536);
          let form;
          try { form = await new Request('http://internal', { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData(); }
          catch { fail(400, 'INVALID_MULTIPART', '上传表单格式错误'); }
          const file = form.get('file');
          if (!file || typeof file.arrayBuffer !== 'function' || form.getAll('file').length !== 1) fail(400, 'FILE_REQUIRED', '每次请求需要且仅允许一个 file 文件');
          if (file.size > config.maxUploadBytes) fail(413, 'FILE_TOO_LARGE', '图片超过大小限制');
          const contents = Buffer.from(await file.arrayBuffer());
          const type = detectImage(contents);
          if (!type) fail(415, 'UNSUPPORTED_IMAGE', '仅支持有效文件头的 PNG、JPEG、GIF、WebP、AVIF 图片');
          const name = text(file.name, '文件名', 240) || `image.${type.ext}`;
          const album = text(form.get('album'), '相册', 80);
          const digest = hash(contents);
          const result = await exclusive(async () => {
            const existing = db.prepare('SELECT * FROM images WHERE hash=?').get(digest);
            if (existing) return { created: false, data: serialize(existing) };
            const used = db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM images').get().bytes;
            if (used + file.size > config.storageLimitBytes) fail(507, 'QUOTA_EXCEEDED', '存储配额不足，请释放空间');
            const key = `${digest}.${type.ext}`;
            const row = { id: randomUUID(), name, hash: digest, ext: type.ext, mime: type.mime, size: file.size, object_key: key, driver: config.driver, album, favorite: 0, created_at: now() };
            // 文件写入成功后才创建可见记录；数据库失败则清理文件。
            try { await stores[config.driver].put(key, contents); }
            catch (e) {
              if (e.code !== 'EEXIST') throw e;
              // 崩溃留下的同名文件只有内容一致时才可复用。
              if (hash(await stores[config.driver].get(key)) !== digest) throw e;
            }
            try { db.prepare('INSERT INTO images(id,name,hash,ext,mime,size,object_key,driver,album,favorite,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row)); }
            catch (e) { await stores[config.driver].delete(key).catch(() => {}); throw e; }
            return { created: true, data: serialize(row) };
          });
          return json(res, result.created ? 201 : 200, result);
        } finally { activeUploads--; }
      }
      const imagePath = path.match(/^\/api\/v1\/images\/([a-f0-9-]{36})$/);
      if (imagePath) {
        auth(req, ['PATCH', 'DELETE'].includes(method) ? 'manage' : 'read');
        if (method === 'GET') {
          const row = db.prepare('SELECT * FROM images WHERE id=?').get(imagePath[1]);
          if (!row) fail(404, 'NOT_FOUND', '图片不存在');
          return json(res, 200, { data: serialize(row) });
        }
        if (method === 'PATCH') {
          const input = await jsonBody(req);
          if (!Object.keys(input).length || Object.keys(input).some(k => !['name', 'album', 'favorite'].includes(k))) fail(400, 'INVALID_INPUT', '可修改字段为 name、album、favorite');
          const values = {};
          if ('name' in input) { values.name = text(input.name, '文件名', 240); if (!values.name) fail(400, 'INVALID_INPUT', '文件名不能为空'); }
          if ('album' in input) { if (typeof input.album !== 'string') fail(400, 'INVALID_INPUT', '相册需为字符串，空字符串表示未分类'); values.album = text(input.album, '相册', 80); }
          if ('favorite' in input) { if (typeof input.favorite !== 'boolean') fail(400, 'INVALID_INPUT', 'favorite 需为布尔值'); values.favorite = Number(input.favorite); }
          const row = await exclusive(() => {
            const updated = db.prepare(`UPDATE images SET ${Object.keys(values).map(k => k + '=?').join(',')} WHERE id=? RETURNING *`).get(...Object.values(values), imagePath[1]);
            if (!updated) fail(404, 'NOT_FOUND', '图片不存在');
            return updated;
          });
          return json(res, 200, { data: serialize(row) });
        }
        if (method === 'DELETE') {
          await exclusive(async () => {
            const row = db.prepare('SELECT * FROM images WHERE id=?').get(imagePath[1]);
            if (!row) fail(404, 'NOT_FOUND', '图片不存在');
            if (!stores[row.driver]) fail(503, 'STORAGE_UNAVAILABLE', '请恢复该图片使用的存储配置');
            await stores[row.driver].delete(row.object_key);
            db.prepare('DELETE FROM images WHERE id=?').run(row.id);
          });
          return json(res, 200, { data: { deleted: true } });
        }
      }
      if (path === '/api/v1/keys') {
        auth(req, 'manage', true);
        if (method === 'GET') return json(res, 200, { data: db.prepare('SELECT id,name,prefix,scope,created_at,last_used_at FROM api_keys ORDER BY created_at DESC').all() });
        if (method === 'POST') {
          const input = await jsonBody(req);
          const name = text(input.name, '密钥名称', 80);
          if (!name || !['upload', 'read', 'manage'].includes(input.scope)) fail(400, 'INVALID_INPUT', '请填写名称和有效权限');
          if (db.prepare('SELECT COUNT(*) AS count FROM api_keys').get().count >= 100) fail(409, 'KEY_LIMIT', '最多保留 100 个密钥');
          const token = 'pppic_' + randomBytes(32).toString('base64url');
          const data = { id: randomUUID(), name, prefix: token.slice(0, 14), scope: input.scope, created_at: now() };
          db.prepare('INSERT INTO api_keys(id,name,prefix,scope,created_at,hash) VALUES (?,?,?,?,?,?)').run(...Object.values(data), hash(token));
          return json(res, 201, { data: { ...data, token } });
        }
      }
      const keyPath = path.match(/^\/api\/v1\/keys\/([a-f0-9-]{36})$/);
      if (keyPath && method === 'DELETE') {
        auth(req, 'manage', true);
        const result = db.prepare('DELETE FROM api_keys WHERE id=?').run(keyPath[1]);
        if (!result.changes) fail(404, 'NOT_FOUND', '密钥不存在');
        return json(res, 200, { data: { deleted: true } });
      }
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      if (assets[path] && ['GET', 'HEAD'].includes(method)) {
        const [filename, type] = assets[path];
        const contents = await readFile(join(publicDir, filename));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': contents.length });
        return res.end(method === 'HEAD' ? undefined : contents);
      }
      fail(404, 'NOT_FOUND', '接口或页面不存在');
    } catch (error) {
      // 不将 S3 认证信息、堆栈、文件路径暴露给客户端。
      if (!error.status) console.error(JSON.stringify({ request_id: requestId, error: error.code || error.name }));
      if (!res.headersSent) {
        res.removeHeader('Content-Length');
        res.removeHeader('ETag');
        if (error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="pppic"');
        json(res, error.status || 503, { error: { code: error.code || 'SERVICE_UNAVAILABLE', message: error.status ? error.message : '服务或存储暂时不可用，请稍后重试', request_id: requestId } });
      } else res.destroy();
    }
  });
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return { server, db };
}
