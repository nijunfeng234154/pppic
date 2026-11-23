import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { Readable, Writable } from 'node:stream';

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDXsAAAAASUVORK5CYII=', 'base64');
export const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// 将标准 Web Request 转成 Node 请求流，经过真实路由、鉴权、表单解析和持久层。
// 默认不监听端口，适用于受限沙箱；PPPIC_TEST_HTTP=1 可切换为真实 HTTP。
export async function inject(server, url, options = {}) {
  const request = new Request(url, options);
  const data = Buffer.from(await request.arrayBuffer());
  const req = Readable.from(data.length ? [data] : []);
  req.url = new URL(url).pathname + new URL(url).search;
  req.method = request.method;
  req.headers = Object.fromEntries(request.headers);
  req.socket = { remoteAddress: '127.0.0.1' };
  const headers = new Headers();
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  res.headersSent = false;
  res.statusCode = 200;
  res.setHeader = (key, value) => headers.set(key, value);
  res.getHeader = key => headers.get(key);
  res.removeHeader = key => headers.delete(key);
  res.writeHead = (status, values = {}) => { res.statusCode = status; for (const [k, v] of Object.entries(values)) headers.set(k, v); res.headersSent = true; return res; };
  const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
  server.emit('request', req, res);
  await finished;
  return new Response([204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers });
}
export async function harness(extra = {}, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pppic-test-'));
  const config = { dataDir: dir, adminToken: 'test-only-' + 'a'.repeat(32), publicUrl: 'http://localhost', driver: 'local', maxUploadBytes: 1024, storageLimitBytes: 1048576, cookieSecure: false, ...extra };
  const { server, db } = createApp(config, options);
  const realHttp = process.env.PPPIC_TEST_HTTP === '1';
  if (realHttp) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
    catch (error) { server.emit('close'); await rm(dir, { recursive: true, force: true }); throw error; }
  }
  config.publicUrl = realHttp ? 'http://127.0.0.1:' + server.address().port : 'http://127.0.0.1:3333';
  async function request(path, options = {}) {
    const headers = { ...(options.admin === false ? {} : { authorization: 'Bearer ' + config.adminToken }), ...options.headers };
    const { admin, ...rest } = options;
    return realHttp ? fetch(config.publicUrl + path, { ...rest, headers }) : inject(server, config.publicUrl + path, { ...rest, headers });
  }
  async function upload(bytes = PNG, { token, name = '测试图片.png', album = '博客', ...rest } = {}) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/png' }), name);
    form.append('album', album);
    return request('/api/v1/images', { method: 'POST', body: form, ...rest, ...(token ? { headers: { authorization: 'Bearer ' + token } } : {}) });
  }
  return { dir, config, server, db, request, upload, async close() { if (realHttp) await new Promise(resolve => server.close(resolve)); else server.emit('close'); await rm(dir, { recursive: true, force: true }); } };
}
