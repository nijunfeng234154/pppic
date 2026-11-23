import { rm } from 'node:fs/promises';
export default async function teardown() {
  if (process.env.PPPIC_E2E_DIR) await rm(process.env.PPPIC_E2E_DIR, { recursive: true, force: true });
}
