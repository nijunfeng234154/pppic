import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harness, PNG, GIF } from './helpers.js';

let app;
before(async () => { app = await harness(); });
after(async () => { await app?.close(); });
const json = (body, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('health、静态页面和 OpenAPI 可访问，管理接口需要认证', async () => {
  assert.equal((await app.request('/healthz', { admin: false })).status, 200);
  const index = await app.request('/', { admin: false });
  assert.equal(index.status, 200);
  assert.match(await index.text(), /我的图库/);
  assert.match(index.headers.get('content-security-policy'), /script-src 'self'/);
  for (const path of ['/api/v1/images', '/api/v1/stats', '/api/v1/keys']) assert.equal((await app.request(path, { admin: false })).status, 401);
  const spec = await (await app.request('/api/openapi.json', { admin: false })).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.servers[0].url, app.config.publicUrl);
  assert.ok(spec.paths['/api/v1/images'].post.requestBody);
});

test('登录、cookie 属性、CSRF 防护、注销和会话失效', async () => {
  assert.equal((await app.request('/api/v1/session', { ...json({ token: 'wrong' }), admin: false })).status, 401);
  assert.equal((await app.request('/api/v1/session', { ...json({ token: app.config.adminToken }), admin: false, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  const login = await app.request('/api/v1/session', { ...json({ token: app.config.adminToken }), admin: false });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await app.request('/api/v1/images', { admin: false, headers: { cookie } })).status, 200);
  assert.equal((await app.request('/api/v1/session', { method: 'DELETE', admin: false, headers: { cookie, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await app.request('/api/v1/session', { method: 'DELETE', admin: false, headers: { cookie } })).status, 403);
  assert.equal((await app.request('/api/v1/session', { method: 'DELETE', admin: false, headers: { cookie, origin: app.config.publicUrl } })).status, 200);
  assert.equal((await app.request('/api/v1/images', { admin: false, headers: { cookie } })).status, 401);
});

test('完整链路：上传、去重、公开原图、ETag、修改、筛选、删除', async () => {
  const response = await app.upload(PNG, { name: '风景.png', album: '旅行' });
  assert.equal(response.status, 201);
  const { data: image, created } = await response.json();
  assert.equal(created, true);
  assert.equal(image.album, '旅行');
  assert.equal(image.mime, 'image/png');
  assert.match(image.links.markdown, /风景.png/);
  const media = await app.request(new URL(image.url).pathname, { admin: false });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/png');
  assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), PNG);
  const cached = await app.request(new URL(image.url).pathname, { admin: false, headers: { 'if-none-match': media.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal((await app.request(new URL(image.url).pathname, { method: 'HEAD', admin: false })).headers.get('content-length'), String(PNG.length));
  const duplicate = await app.upload(PNG, { name: 'different.jpg' });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).data.id, image.id);
  const patch = await app.request('/api/v1/images/' + image.id, json({ name: '日落.png', album: '精选', favorite: true }, 'PATCH'));
  assert.equal(patch.status, 200);
  const query = await (await app.request('/api/v1/images?' + new URLSearchParams({ q: '日落', album: '精选', favorite: 'true', format: 'png', limit: '1' }))).json();
  assert.equal(query.data[0].id, image.id);
  assert.equal(query.pagination.total, 1);
  assert.equal((await (await app.request('/api/v1/images?q=missing')).json()).pagination.total, 0);
  const stats = (await (await app.request('/api/v1/stats')).json()).data;
  assert.equal(stats.images, 1);
  assert.equal(stats.bytes, PNG.length);
  assert.equal(stats.favorites, 1);
  assert.deepEqual(stats.albums, [{ name: '精选', count: 1 }]);
  assert.equal((await app.request('/api/v1/images/' + image.id, { method: 'DELETE' })).status, 200);
  assert.equal((await app.request(new URL(image.url).pathname, { admin: false })).status, 404);
  assert.equal((await app.request('/api/v1/images/' + image.id, { method: 'DELETE' })).status, 404);
});

test('并发相同文件只保留一份，SQL 搜索通配符按字面匹配', async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => app.upload(GIF, { name: '100%_literal.gif' })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 201]);
  const images = await Promise.all(results.map(r => r.json()));
  assert.equal(new Set(images.map(r => r.data.id)).size, 1);
  const exact = await (await app.request('/api/v1/images?q=' + encodeURIComponent('%_'))).json();
  assert.equal(exact.data.length, 1);
  const injection = await (await app.request('/api/v1/images?q=' + encodeURIComponent("' OR 1=1 --"))).json();
  assert.equal(injection.data.length, 0);
});

test('格式与输入边界：伪造图片、SVG、超限、缺文件、非法 JSON、分页', async () => {
  for (const bytes of [Buffer.from('<svg onload="alert(1)"></svg>'), Buffer.from('<html>fake</html>'), Buffer.alloc(0)]) assert.equal((await app.upload(bytes)).status, 415);
  assert.equal((await app.upload(Buffer.alloc(1025))).status, 413);
  assert.equal((await app.request('/api/v1/images', { method: 'POST', body: new FormData() })).status, 400);
  const multiple = new FormData();
  multiple.append('file', new Blob([PNG]), 'a.png'); multiple.append('file', new Blob([PNG]), 'b.png');
  assert.equal((await app.request('/api/v1/images', { method: 'POST', body: multiple })).status, 400);
  for (const query of ['page=0', 'page=-1', 'limit=101', 'page=1abc', 'favorite=maybe', 'format=svg']) assert.equal((await app.request('/api/v1/images?' + query)).status, 400);
  assert.equal((await app.request('/api/v1/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await app.request('/api/v1/keys', { method: 'POST', body: 'name=x' })).status, 415);
  const image = (await (await app.upload()).json()).data;
  assert.equal((await app.request('/api/v1/images/' + image.id, json({ favorite: 'true' }, 'PATCH'))).status, 400);
  assert.equal((await app.request('/api/v1/images/' + image.id, json({ object_key: '../../secret' }, 'PATCH'))).status, 400);
  assert.equal((await app.request('/api/v1/images/' + image.id, json({ name: null }, 'PATCH'))).status, 400);
  assert.equal((await app.request('/api/v1/images/' + image.id, json({ album: null }, 'PATCH'))).status, 400);
});

test('API 密钥权限矩阵、哈希保存、不泄露、撤销立即生效', async () => {
  const tokens = {};
  const ids = {};
  for (const scope of ['upload', 'read', 'manage']) {
    const response = await app.request('/api/v1/keys', json({ name: scope, scope }));
    assert.equal(response.status, 201);
    const { data } = await response.json(); tokens[scope] = data.token; ids[scope] = data.id;
    const row = app.db.prepare('SELECT * FROM api_keys WHERE id=?').get(data.id);
    assert.notEqual(row.hash, data.token);
    assert.equal(row.hash.length, 64);
  }
  const list = await (await app.request('/api/v1/keys')).json();
  assert.ok(list.data.every(k => !('token' in k) && !('hash' in k)));
  const requestAs = (scope, path, options = {}) => app.request(path, { ...options, headers: { ...options.headers, authorization: 'Bearer ' + tokens[scope] } });
  assert.equal((await requestAs('upload', '/api/v1/images')).status, 403);
  assert.equal((await requestAs('read', '/api/v1/images')).status, 200);
  assert.equal((await app.upload(PNG, { token: tokens.read })).status, 403);
  const upload = await app.upload(PNG, { token: tokens.upload });
  assert.equal(upload.status, 200);
  const image = (await upload.json()).data;
  assert.equal((await requestAs('upload', '/api/v1/images/' + image.id, { method: 'DELETE' })).status, 403);
  assert.equal((await requestAs('manage', '/api/v1/images/' + image.id, json({ favorite: true }, 'PATCH'))).status, 200);
  for (const scope of Object.keys(tokens)) assert.equal((await requestAs(scope, '/api/v1/keys')).status, 403);
  assert.equal((await app.request('/api/v1/keys/' + ids.read, { method: 'DELETE' })).status, 200);
  assert.equal((await requestAs('read', '/api/v1/images')).status, 401);
  assert.ok(app.db.prepare('SELECT last_used_at FROM api_keys WHERE id=?').get(ids.manage).last_used_at);
});

test('分享文本清理属性注入字符，路径穿越请求不可读取本机文件', async () => {
  const image = (await (await app.upload(Buffer.concat([PNG, Buffer.from('unique')]), { name: 'a" onerror="alert(1)<x>.png' })).json()).data;
  assert.ok(!image.links.html.includes('" onerror="'));
  assert.ok(!image.links.markdown.includes('<x>'));
  for (const path of ['/i/../../.env', '/i/%2e%2e%2f.env', '/src/config.js', '/data/admin-token']) assert.equal((await app.request(path)).status, 404);
  const response = await app.request('/api/v1/images', { headers: { authorization: 'Bearer invalid' } });
  const error = await response.json();
  assert.equal(response.status, 401);
  assert.ok(error.error.request_id);
  assert.ok(!JSON.stringify(error).includes(app.dir));
});

test('存储配额生效；失败写入不创建记录，失败删除保留记录', async () => {
  const quota = await harness({ storageLimitBytes: PNG.length });
  try {
    assert.equal((await quota.upload()).status, 201);
    assert.equal((await quota.upload(GIF)).status, 507);
    assert.equal((await quota.upload()).status, 200);
  } finally { await quota.close(); }
  let failPut = true;
  const failing = await harness({}, { storage: { put: async () => { if (failPut) throw new Error('offline'); }, delete: async () => { throw new Error('offline'); } } });
  try {
    assert.equal((await failing.upload()).status, 503);
    assert.equal(failing.db.prepare('SELECT COUNT(*) AS count FROM images').get().count, 0);
    failPut = false;
    const image = (await (await failing.upload()).json()).data;
    assert.equal((await failing.request('/api/v1/images/' + image.id, { method: 'DELETE' })).status, 503);
    assert.equal(failing.db.prepare('SELECT COUNT(*) AS count FROM images').get().count, 1);
  } finally { await failing.close(); }
});

test('磁盘持久化：数据库可重开，文件字节实际落盘', async () => {
  const image = (await (await app.upload()).json()).data;
  const row = app.db.prepare('SELECT * FROM images WHERE id=?').get(image.id);
  assert.deepEqual(await readFile(join(app.dir, 'uploads', row.object_key)), PNG);
  const { openDatabase } = await import('../src/db.js');
  const reopened = openDatabase(join(app.dir, 'pppic.sqlite'));
  try { assert.equal(reopened.prepare('SELECT id FROM images WHERE id=?').get(image.id).id, image.id); }
  finally { reopened.close(); }
});

test('登录暴力尝试限流，正确口令也不能绕过封禁', async () => {
  const isolated = await harness();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await isolated.request('/api/v1/session', { ...json({ token: 'wrong' }), admin: false })).status, 401);
    const blocked = await isolated.request('/api/v1/session', { ...json({ token: isolated.config.adminToken }), admin: false });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally { await isolated.close(); }
});

test('五种真实格式均可上传并流式读取，扩展名和客户端 MIME 不影响格式识别', async () => {
  const formats = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
  for (const [format, mime] of Object.entries(formats)) {
    const bytes = await readFile(new URL(`./fixtures/测试图片.${format}`, import.meta.url));
    const response = await app.upload(bytes, { name: '文件名.bin', album: '格式验证' });
    assert.equal(response.status, 201, format);
    const image = (await response.json()).data;
    assert.equal(image.format, format);
    const media = await app.request(new URL(image.url).pathname, { admin: false });
    assert.equal(media.headers.get('content-type'), mime);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);
  }
});

test('无 Content-Length 的超限请求返回 413；畸形 multipart 返回 400', async () => {
  const huge = await app.request('/api/v1/images', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body: Buffer.alloc(70000) });
  assert.equal(huge.status, 413);
  const malformed = await app.request('/api/v1/images', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body: 'not-a-form' });
  assert.equal(malformed.status, 400);
});
