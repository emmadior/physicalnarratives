/**
 * Runtime FPS sampling. Call `tick(now)` once per animation frame.
 * Fires `onDegrade` once after sustained low frame rate (post warm-up).
 */

/**
 * @param {{
 *   warmUpMs?: number,
 *   sampleMs?: number,
 *   minFps?: number,
 *   badSamplesNeeded?: number,
 *   onDegrade?: (info: { fps: number }) => void,
 * }} [opts]
 */
export function createPerfGuard(opts = {}) {
  const warmUpMs = opts.warmUpMs ?? 2500;
  const sampleMs = opts.sampleMs ?? 1000;
  const minFps = opts.minFps ?? 26;
  const badSamplesNeeded = opts.badSamplesNeeded ?? 2;
  const onDegrade = opts.onDegrade;

  let startedAt = 0;
  let sampleStart = 0;
  let frames = 0;
  let badSamples = 0;
  let degraded = false;
  let enabled = true;

  return {
    /** Stop monitoring (e.g. after already adapting). */
    disable() {
      enabled = false;
    },
    get degraded() {
      return degraded;
    },
    /**
     * @param {number} now performance.now() / rAF timestamp
     */
    tick(now) {
      if (!enabled || degraded) return;

      if (!startedAt) {
        startedAt = now;
        sampleStart = now;
        frames = 0;
        return;
      }

      if (now - startedAt < warmUpMs) {
        sampleStart = now;
        frames = 0;
        return;
      }

      frames += 1;
      const elapsed = now - sampleStart;
      if (elapsed < sampleMs) return;

      const fps = (frames * 1000) / elapsed;
      frames = 0;
      sampleStart = now;

      if (fps < minFps) {
        badSamples += 1;
        if (badSamples >= badSamplesNeeded) {
          degraded = true;
          enabled = false;
          onDegrade?.({ fps });
        }
      } else {
        badSamples = Math.max(0, badSamples - 1);
      }
    },
  };
}

/** Cap used when the scene has already adapted to a slow machine. */
export const LOW_POWER_MAX_BLOBS = 3;
export const LOW_POWER_PIXEL_RATIO = 1;
