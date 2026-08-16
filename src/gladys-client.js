export class GladysClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}/api/v1${path}`, {
      ...options,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...options.headers },
    });
    if (!response.ok) throw new Error(`Gladys a répondu HTTP ${response.status} sur ${path}`);
    if (response.status === 204) return undefined;
    return response.json();
  }

  async ensureDevice(device) {
    if (this.cache.has(device.id)) return this.cache.get(device.id);
    const query = encodeURIComponent(device.id);
    const found = await this.request(`/device?external_id=${query}`).catch(() => []);
    let saved = Array.isArray(found) ? found.find((item) => item.external_id === device.id) : undefined;
    if (!saved) {
      saved = await this.request('/device', { method: 'POST', body: JSON.stringify({
        name: device.name, external_id: device.id, selector: device.id.replace(/:/g, '-'), model: device.model,
        should_poll: false, features: device.features.map((feature) => ({
          name: feature.name, external_id: `${device.id}:${feature.id}`, selector: `${device.id}:${feature.id}`.replace(/:/g, '-'),
          category: feature.category, type: feature.type, unit: feature.unit, min: feature.min, max: feature.max,
          read_only: true, has_feedback: false,
        })),
      }) });
    }
    this.cache.set(device.id, saved);
    return saved;
  }

  async publish(device) {
    const saved = await this.ensureDevice(device);
    for (const feature of device.features) {
      const externalId = `${device.id}:${feature.id}`;
      const stored = saved.features?.find((item) => item.external_id === externalId);
      if (!stored) continue;
      await this.request(`/device/${saved.selector}/feature/${stored.selector}/state`, {
        method: 'POST', body: JSON.stringify({ value: feature.value }),
      });
    }
  }
}
