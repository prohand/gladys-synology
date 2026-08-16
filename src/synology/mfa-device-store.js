import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_MFA_DEVICE_PATH = '/data/synology-mfa-device.json';

export class SynologyMfaDeviceStore {
  constructor(filePath = process.env.SYNOLOGY_MFA_DEVICE_PATH || DEFAULT_MFA_DEVICE_PATH) {
    this.filePath = filePath;
  }

  async load({ url, username }) {
    try {
      const record = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (record.url !== url || record.username !== username) return null;
      return typeof record.device_id === 'string' && record.device_id ? record.device_id : null;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async save({ url, username }, deviceId) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify({ url, username, device_id: deviceId })}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
