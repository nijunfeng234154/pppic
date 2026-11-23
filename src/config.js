import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

function integer(value, fallback, min, max) {
  const result = Number(value ?? fallback);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('环境变量整数超出范围');
  return result;
}

export function loadConfig(env = process.env) {
  const port = integer(env.PORT, 3333, 1, 65535);
  const publicUrl = new URL(env.PUBLIC_URL || `http://localhost:${port}`);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('PUBLIC_URL 必须是 HTTP(S) 源地址，不含路径或认证信息');
  const dataDir = resolve(env.DATA_DIR || './data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let adminToken = env.ADMIN_TOKEN;
  if (!adminToken) {
    const tokenPath = resolve(dataDir, 'admin-token');
    try { adminToken = readFileSync(tokenPath, 'utf8').trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      adminToken = randomBytes(32).toString('base64url');
      writeFileSync(tokenPath, adminToken + '\n', { mode: 0o600, flag: 'wx' });
    }
  }
  if (adminToken.length < 24 || adminToken.length > 512 || /\s/.test(adminToken)) throw new Error('ADMIN_TOKEN 需要 24–512 个不含空白的字符');
  const driver = env.STORAGE_DRIVER || 'local';
  if (!['local', 's3'].includes(driver)) throw new Error('STORAGE_DRIVER 仅支持 local 或 s3');
  const config = {
    port, host: env.HOST || '127.0.0.1', publicUrl: publicUrl.origin, dataDir, adminToken,
    maxUploadBytes: integer(env.MAX_UPLOAD_MB, 20, 1, 100) * 1024 ** 2,
    storageLimitBytes: integer(env.STORAGE_LIMIT_MB, 10240, 1, 10485760) * 1024 ** 2,
    cookieSecure: env.COOKIE_SECURE === 'true' || publicUrl.protocol === 'https:', driver,
    s3: { endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'auto', bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  };
  if (driver === 's3' && Object.values(config.s3).some(v => !v)) throw new Error('S3 配置不完整');
  return config;
}
