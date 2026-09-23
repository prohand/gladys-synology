import { normalizeConfig } from '../../src/config.js';
import { SynologyFleetService } from '../../src/fleet-service.js';

/** A raw DSM payload with one of everything: two volumes, two disks and two backup tasks. */
export function rawDsmSnapshot({ serial = 'ABC123', model = 'DS920+', ...overrides } = {}) {
  return {
    system: { serial, model, firmware_ver: 'DSM 7.2.2-72806', sys_temp: 48 },
    utilization: { cpu: { total_load: 12 }, memory: { real_usage: 41 } },
    storage: {
      volumes: [
        {
          id: 'volume_1',
          display_name: 'Volume 1',
          status: 'normal',
          size: { total: 4 * 1024 ** 4, used: 3.8 * 1024 ** 4 },
        },
        { id: 'volume_2', display_name: 'Volume 2', status: 'crashed', size: { total: 1024 ** 4 } },
      ],
      disks: [
        { id: 'sata1', name: 'Drive 1', smart_status: 'normal', temp: 34 },
        { id: 'sata2', name: 'Drive 2', smart_status: 'failing', temp: 58 },
      ],
    },
    hyperBackup: {
      task_list: [
        {
          task_id: 7,
          name: 'Cloud archive',
          last_bkp_result: 'done',
          last_bkp_time: 1_790_000_000,
        },
        { task_id: 8, name: 'USB copy', last_bkp_result: 'failed', last_bkp_time: 1_790_003_600 },
      ],
    },
    ...overrides,
  };
}

/**
 * A real fleet whose DSM clients answer from `readings` (one list per NAS, the last reading is
 * repeated; an Error entry makes that refresh fail).
 */
export function createFleet(readingsPerNas, config = {}) {
  const urls = ['https://nas-1:5001', 'https://nas-2:5001'];
  const raw = { username: 'u', password: 'p', ...config };
  readingsPerNas.forEach((_, index) => {
    const prefix = index === 0 ? '' : `nas_${index + 1}_`;
    raw[`${prefix}url`] = raw[`${prefix}url`] ?? urls[index];
    raw[`${prefix}username`] = 'u';
    raw[`${prefix}password`] = 'p';
  });
  let created = 0;
  return new SynologyFleetService(normalizeConfig(raw), {
    now: () => Date.parse('2026-09-23T12:00:00.000Z'),
    clientFactory: () => {
      const readings = readingsPerNas[created];
      created += 1;
      let index = 0;
      return {
        async getSnapshot() {
          const reading = readings[Math.min(index, readings.length - 1)];
          index += 1;
          if (reading instanceof Error) throw reading;
          return reading;
        },
        async close() {},
      };
    },
  });
}
