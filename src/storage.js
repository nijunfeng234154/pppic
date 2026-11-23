import { mkdir, writeFile, readFile, unlink, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export class LocalStorage {
  constructor(root) { this.root = root; }
  path(key) {
    if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/.test(key)) throw new Error('非法存储路径');
    return join(this.root, key);
  }
  async put(key, bytes) {
    const target = this.path(key);
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `.upload-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      // 同目录原子替换；进程崩溃不会留下可见的半张图片。
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async get(key) { return readFile(this.path(key)); }
  async stream(key) { return (await open(this.path(key), 'r')).createReadStream(); }
  async delete(key) { try { await unlink(this.path(key)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}

export function signS3(config, method, key, bytes = Buffer.alloc(0), now = new Date()) {
  const url = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error('无效 S3 endpoint');
  url.pathname = url.pathname.replace(/\/$/, '') + '/' + encode(config.bucket) + '/' + key.split('/').map(encode).join('/');
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const payloadHash = sha256(bytes);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': timestamp };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(name => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.secretAccessKey, date), config.region), 's3'), 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, toSign).toString('hex')}`;
  return { url, headers };
}

export class S3Storage {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  async request(method, key, bytes) {
    const { url, headers } = signS3(this.config, method, key, bytes);
    const response = await this.fetcher(url, { method, headers, body: method === 'PUT' ? bytes : undefined, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (method === 'DELETE' && response.status === 404) return response;
    if (!response.ok) { await response.body?.cancel(); throw new Error(`S3 ${method} 失败 (${response.status})`); }
    return response;
  }
  async put(key, bytes) { const r = await this.request('PUT', key, bytes); await r.body?.cancel(); }
  async get(key) { return Buffer.from(await (await this.request('GET', key)).arrayBuffer()); }
  async stream(key) { return Readable.fromWeb((await this.request('GET', key)).body); }
  async delete(key) { const r = await this.request('DELETE', key); await r.body?.cancel(); }
}
