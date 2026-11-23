import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--test', 'tests/api.test.js', 'tests/storage.test.js'], { stdio: 'inherit', env: { ...process.env, PPPIC_TEST_HTTP: '1' } });
process.exit(result.status ?? 1);
