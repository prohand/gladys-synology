export function createFakeGladys() {
  const published = [];
  return {
    published,
    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },
    async publishStates(states) {
      published.push(...states);
    },
  };
}
