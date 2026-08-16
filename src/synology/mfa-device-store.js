import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_MFA_DEVICE_PATH = '/data/synology-mfa-device.json';
let saveQueue = Promise.resolve();

export class SynologyMfaDeviceStore {
  constructor(filePath = process.env.SYNOLOGY_MFA_DEVICE_PATH || DEFAULT_MFA_DEVICE_PATH) {
    this.filePath = filePath;
  }

  async load({ url, username }) {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const record = records.find((item) => item.url === url && item.username === username);
      if (!record) return null;
      return typeof record.device_id === 'string' && record.device_id ? record.device_id : null;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async save({ url, username }, deviceId) {
    const operation = saveQueue.then(() => this.saveRecord({ url, username }, deviceId));
    saveQueue = operation.catch(() => {});
    return operation;
  }

  async saveRecord({ url, username }, deviceId) {
    let records = [];
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      records = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    records = records.filter((record) => record.url !== url || record.username !== username);
    records.push({ url, username, device_id: deviceId });
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(records)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
