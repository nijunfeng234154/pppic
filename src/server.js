import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { resolve } from 'node:path';

const config = loadConfig();
const { server } = createApp(config);
server.listen(config.port, config.host, () => {
  console.log(`pppic 已启动：${config.publicUrl}`);
  console.log(`存储：${config.driver}；数据目录：${config.dataDir}`);
  if (!process.env.ADMIN_TOKEN) console.log(`首次登录口令请在本机读取：${resolve(config.dataDir, 'admin-token')}`);
});
server.on('error', error => { console.error(`启动失败：${error.code || error.message}`); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
});
