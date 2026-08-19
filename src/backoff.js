export const DEFAULT_INITIAL_DELAY = 30_000;
export const DEFAULT_MAX_DELAY = 900_000;

/**
 * Exponential delays used to retry a failed DSM initialization until the NAS answers again,
 * for example while it reboots after a DSM update.
 */
export function createBackoff({
  initialDelay = DEFAULT_INITIAL_DELAY,
  maxDelay = DEFAULT_MAX_DELAY,
  factor = 2,
} = {}) {
  let delay = initialDelay;
  return {
    next() {
      const current = Math.min(delay, maxDelay);
      delay = Math.min(current * factor, maxDelay);
      return current;
    },
    reset() {
      delay = initialDelay;
    },
  };
}
