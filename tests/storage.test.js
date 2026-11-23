import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorage, S3Storage, signS3 } from '../src/storage.js';
import { detectImage } from '../src/image.js';
import { loadConfig } from '../src/config.js';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG, GIF } from './helpers.js';

const s3 = { endpoint: 'https://s3.example.test', region: 'us-east-1', bucket: 'image bucket', accessKeyId: 'example-key', secretAccessKey: 'test-only-secret' };
test('S3 签名确定性、路径编码、请求方法与内容绑定', () => {
  const time = new Date('2026-11-20T00:00:00.000Z');
  const signed = signS3(s3, 'PUT', 'a b/风景.png', PNG, time);
  assert.equal(signed.url.pathname, '/image%20bucket/a%20b/%E9%A3%8E%E6%99%AF.png');
  assert.equal(signed.headers['x-amz-date'], '20261120T000000Z');
  assert.match(signed.headers.authorization, /Credential=example-key\/20261120\/us-east-1\/s3\/aws4_request/);
  assert.equal(signed.headers.authorization, signS3(s3, 'PUT', 'a b/风景.png', PNG, time).headers.authorization);
  assert.notEqual(signed.headers.authorization, signS3(s3, 'GET', 'a b/风景.png', PNG, time).headers.authorization);
  assert.notEqual(signed.headers.authorization, signS3(s3, 'PUT', 'a b/风景.png', GIF, time).headers.authorization);
  assert.throws(() => signS3({ ...s3, endpoint: 'https://host/?query=1' }, 'GET', 'a'));
});
test('S3 适配器发送签名、不跟随重定向、处理失败，私有桶无需公开', async () => {
  const requests = [];
  const storage = new S3Storage(s3, async (url, options) => {
    requests.push({ url, ...options });
    if (options.method === 'GET') return new Response(PNG);
    return new Response(null, { status: 204 });
  });
  await storage.put('image.png', PNG);
  assert.deepEqual(await storage.get('image.png'), PNG);
  await storage.delete('image.png');
  assert.deepEqual(requests.map(r => r.method), ['PUT', 'GET', 'DELETE']);
  assert.ok(requests.every(r => r.redirect === 'error' && r.headers.authorization && r.signal));
  assert.deepEqual(requests[0].body, PNG);
  const failing = new S3Storage(s3, async () => new Response('sensitive body', { status: 403 }));
  await assert.rejects(failing.put('image.png', PNG), /S3 PUT 失败 \(403\)/);
  const missing = new S3Storage(s3, async () => new Response(null, { status: 404 }));
  await missing.delete('missing.png');
});
test('本地存储拒绝任意路径，配置生成私密口令并跨启动复用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pppic-config-'));
  try {
    const storage = new LocalStorage(dir);
    assert.throws(() => storage.path('../secret'));
    assert.throws(() => storage.path('image.svg'));
    const config = loadConfig({ DATA_DIR: dir });
    assert.equal(config.adminToken.length, 43);
    assert.equal(loadConfig({ DATA_DIR: dir }).adminToken, config.adminToken);
    assert.equal((await stat(join(dir, 'admin-token'))).mode & 0o777, 0o600);
    assert.throws(() => loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: 'short' }));
    assert.throws(() => loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://host/path' }));
    assert.throws(() => loadConfig({ DATA_DIR: dir, STORAGE_DRIVER: 's3' }));
    assert.throws(() => loadConfig({ DATA_DIR: dir, MAX_UPLOAD_MB: '-1' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('图片识别基于文件内容而非扩展名，拒绝截断与非图片', () => {
  assert.deepEqual(detectImage(PNG), { ext: 'png', mime: 'image/png' });
  assert.deepEqual(detectImage(GIF), { ext: 'gif', mime: 'image/gif' });
  for (const value of [PNG.subarray(0, 10), GIF.subarray(0, 8), Buffer.from('<svg/>'), Buffer.from('hello')]) assert.equal(detectImage(value), null);
});
