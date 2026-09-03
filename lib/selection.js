/**
 * Selection helpers — metaball hit-test and easing.
 */

import { PARAMS } from "./uniforms.js";

/** Must match KERNEL_GAIN in blob.frag.glsl. */
const KERNEL_GAIN = 12.0;

export const EASINGS = {
  smoothstep: (t) => t * t * (3 - 2 * t),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  linear: (t) => t,
};

export function easeTransition(t) {
  const fn = EASINGS[PARAMS.transitionEasing] || EASINGS.easeInOutCubic;
  return Math.max(0, Math.min(1, fn(t)));
}

/** Matches metaballWeight in blob.frag.glsl — live radii, current positions. */
export function blobFieldAt(px, py, circles, falloff) {
  let sum = 0;
  for (const c of circles) {
    const q = Math.hypot(px - c.x, py - c.y) / Math.max(c.radius, 1);
    const k = Math.max(0, 1 - q * q);
    if (k > 0) sum += Math.pow(k, falloff) * k * KERNEL_GAIN;
  }
  return sum;
}

/** True if (px,py) is inside this blob's current visible silhouette. */
export function hitsBlob(sim, index, px, py) {
  const blob = sim.blobs[index];
  if (!blob) return false;
  return blobFieldAt(px, py, blob.circles, PARAMS.falloff) > PARAMS.threshold;
}

/**
 * True when a click should count as "on" the focused blob — metaball silhouette
 * plus generous bounds while selected (video frame + circle envelope).
 */
export function isInsideFocusedBlob(sim, index, px, py) {
  if (hitsBlob(sim, index, px, py)) return true;

  if (sim.paramTargetIndex < 0 || sim.selectedIndex !== index) return false;

  const blob = sim.blobs[index];
  if (!blob) return false;

  const cx = blob.videoFrameCenterX;
  const cy = blob.videoFrameCenterY;
  const hw = blob.videoFrameHalfW;
  const hh = blob.videoFrameHalfH;
  if (Math.abs(px - cx) <= hw && Math.abs(py - cy) <= hh) return true;

  // Live circle envelope — covers metaball wobble at the silhouette edge.
  const pad = Math.max(blob.params?.maxRadius ?? 0, 1) * 0.2;
  return (
    px >= blob.minX - pad &&
    px <= blob.maxX + pad &&
    py >= blob.minY - pad &&
    py <= blob.maxY + pad
  );
}

/** Hit-test against the live metaball iso-contour, not a bbox or rest pose. */
export function hitTest(sim, px, py) {
  const falloff = PARAMS.falloff;
  const threshold = PARAMS.threshold;
  let best = -1;
  let bestField = threshold;

  for (let i = 0; i < sim.blobs.length; i++) {
    const field = blobFieldAt(px, py, sim.blobs[i].circles, falloff);
    if (field > bestField) {
      bestField = field;
      best = i;
    }
  }

  return best;
}
