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

/**
 * Fake GladysIntegration: records the handlers registered by the runtime so a test can fire them,
 * and keeps every published device, state and connection status.
 */
export function createFakeGladysIntegration({ config = {} } = {}) {
  const gladys = createFakeGladys();
  const handlers = {};
  const events = {};
  return {
    ...gladys,
    handlers,
    discovered: [],
    statuses: [],
    config,
    onScanRequest: (handler) => (handlers.scan = handler),
    onPoll: (handler) => (handlers.poll = handler),
    onDeviceCreated: (handler) => (handlers.deviceCreated = handler),
    onAction(key, handler) {
      handlers[`action:${key}`] = handler;
    },
    onConfigUpdated: (handler) => (handlers.configUpdated = handler),
    handleShutdown: (handler) => (handlers.shutdown = handler),
    on(event, handler) {
      events[event] = handler;
    },
    emit(event, ...args) {
      return events[event]?.(...args);
    },
    async getConfig() {
      return this.config;
    },
    async publishDiscoveredDevices(devices) {
      this.discovered.push(devices);
    },
    async setConnectionStatus(connected, message) {
      this.statuses.push({ connected, message });
      return { success: true };
    },
  };
}

/** Scheduler stub: timers are collected instead of firing, so tests stay deterministic. */
export function createFakeScheduler() {
  const intervals = [];
  const timeouts = [];
  return {
    intervals,
    timeouts,
    setInterval(callback, delay) {
      const timer = { callback, delay, cleared: false };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      if (timer) timer.cleared = true;
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
}
