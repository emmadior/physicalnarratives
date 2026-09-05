/**
 * Selection focus: morph circle layout to video aspect, drift to centre, zoom
 * camera until the blob touches a canvas edge (minus inset). No radius growth.
 */

import { PARAMS, METABALL_VISIBLE_FRACTION } from "./uniforms.js";
import { easeTransition } from "./selection.js";
import { SELECTED_OVERLAP } from "./selection-params.js";

/** Must match CLUSTER_K in blob.js. */
const CLUSTER_K = 1.35;

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Video UV frame vs inset circle layout. Centers sit inside the video frame
 * by one metaball reach so the silhouette never samples clamped edge UVs.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {number} videoW
 * @param {number} videoH
 */
export function computeFocusFrames(blob, videoW, videoH) {
  const vidAspect = videoW / Math.max(videoH, 1);
  const maxR = Math.max(blob.params.minRadius, blob.params.maxRadius);
  const base = maxR * CLUSTER_K * PARAMS.focusLayoutScale;
  const outerRx = base * Math.sqrt(vidAspect);
  const outerRy = base / Math.sqrt(vidAspect);
  const fitScale = PARAMS.selectedVideoFitScale;

  const videoHalfW = outerRx * fitScale;
  const videoHalfH = outerRy * fitScale;
  const reach = maxR * METABALL_VISIBLE_FRACTION;
  const layoutRx = Math.max(videoHalfW - reach, outerRx * 0.45);
  const layoutRy = Math.max(videoHalfH - reach, outerRy * 0.45);

  return { videoHalfW, videoHalfH, layoutRx, layoutRy };
}

/** @param {import('./blob.js').Blob} blob */
export function syncCircleLocalsFromWorld(blob) {
  for (const c of blob.circles) {
    c.localX = c.x - blob.centerX;
    c.localY = c.y - blob.centerY;
    c.anchorX = c.x;
    c.anchorY = c.y;
  }
}

/** @param {import('./blob.js').Blob} blob */
export function captureFocusPose(blob) {
  return {
    centerX: blob.centerX,
    centerY: blob.centerY,
    circles: blob.circles.map((c) => ({
      localX: c.x - blob.centerX,
      localY: c.y - blob.centerY,
    })),
  };
}

/**
 * Target local positions arranged in an ellipse matching video aspect.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {number} videoW
 * @param {number} videoH
 */
export function computeVideoLayoutTargets(blob, videoW, videoH) {
  const { layoutRx, layoutRy } = computeFocusFrames(blob, videoW, videoH);
  const fromRx = Math.max(blob.clusterRx, 1e-6);
  const fromRy = Math.max(blob.clusterRy, 1e-6);

  return blob.relaxLayoutAt(
    blob.circles.map((c) => {
      const nx = (c.restLocalX ?? c.localX) / fromRx;
      const ny = (c.restLocalY ?? c.localY) / fromRy;
      return { localX: nx * layoutRx, localY: ny * layoutRy };
    }),
    layoutRx,
    layoutRy,
    SELECTED_OVERLAP,
  );
}

/** @param {import('./blob.js').Blob} blob @param {ReturnType<typeof captureFocusPose>} target */
function measureTargetZoom(blob, view, target, videoW, videoH) {
  syncCircleLocalsFromWorld(blob);
  const saved = captureFocusPose(blob);
  applyFocusPose(blob, target);
  blob.seat();

  const { videoHalfW, videoHalfH } = computeFocusFrames(blob, videoW, videoH);
  const layoutScale = Math.max(view.layoutScale || 1, 1e-6);
  const inset = (PARAMS.edgeBuffer + PARAMS.focusPadding) / layoutScale;
  const playerInset = PARAMS.focusPlayerHeight / layoutScale;
  // Extra vertical margin so the metaball iso-contour is not shaved off by
  // the canvas / video-frame rectangle.
  const vertInset = PARAMS.focusVertInset / layoutScale;
  const needW = Math.max(view.halfW - inset, 1);
  const needH = Math.max(view.halfH - inset - playerInset * 0.5 - vertInset, 1);
  // Fit the full video frame (like fullscreen object-fit: contain), not the
  // tighter metaball silhouette — otherwise the blob crops heavily.
  let zoom = Math.min(needW / videoHalfW, needH / videoHalfH);
  zoom *= PARAMS.focusZoomBoost;
  if (PARAMS.focusMaxScale > 0) zoom = Math.min(zoom, PARAMS.focusMaxScale);

  applyFocusPose(blob, saved);
  blob.seat();
  return Math.max(zoom, 1);
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} index
 */
export function beginFocusTransition(sim, index) {
  const blob = sim.blobs[index];
  if (!blob) return;

  syncCircleLocalsFromWorld(blob);
  sim.focusRest = captureFocusPose(blob);
  sim.focusMorphFrom = captureFocusPose(blob);
  // Target is filled once video dimensions are known — avoid morphing toward
  // rest anchors at canvas centre before the video-aspect layout exists.
  sim.focusTarget = null;
  sim.focusZoomFrom = 1;
  sim.focusZoomTo = 1;
  sim.focusZoom = 1;
  sim.focusVideoReady = false;
  sim.focusLinksReady = false;
}

function markFocusRetarget(sim, blob) {
  if (!sim.paramTransitioning) return;
  syncCircleLocalsFromWorld(blob);
  sim.focusMorphFrom = captureFocusPose(blob);
  sim.focusZoomFrom = sim.focusZoom;
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} index
 * @param {number} videoW
 * @param {number} videoH
 */
export function applyFocusVideoAspect(sim, index, videoW, videoH) {
  if (sim.paramTargetIndex !== index && sim.selectedIndex !== index) return;
  const blob = sim.blobs[index];
  if (!blob || !videoW || !videoH) return;

  const alreadySettled =
    !sim.paramTransitioning &&
    sim.focusVideoReady &&
    sim.paramTargetIndex === index &&
    sim.selectedIndex === index;
  if (alreadySettled) {
    sim.focusVideoW = videoW;
    sim.focusVideoH = videoH;
    return;
  }

  const prevW = sim.focusVideoW || 0;
  const prevH = sim.focusVideoH || 0;
  if (
    sim.focusVideoReady &&
    prevW === videoW &&
    prevH === videoH &&
    sim.paramTargetIndex === index
  ) {
    return;
  }

  const layoutCircles = computeVideoLayoutTargets(blob, videoW, videoH);
  const newTarget = {
    centerX: 0,
    centerY: 0,
    circles: layoutCircles,
  };

  const targetChanged =
    prevW !== videoW ||
    prevH !== videoH ||
    !sim.focusVideoReady ||
    sim.focusTarget?.circles?.length !== layoutCircles.length;

  if (targetChanged) {
    markFocusRetarget(sim, blob);
  }

  sim.focusTarget = newTarget;
  sim.focusVideoW = videoW;
  sim.focusVideoH = videoH;
  sim.focusZoomTo = measureTargetZoom(blob, sim.view, newTarget, videoW, videoH);
  sim.focusVideoReady = true;

  const frames = computeFocusFrames(blob, videoW, videoH);
  blob.focusVideoHalfW = frames.videoHalfW;
  blob.focusVideoHalfH = frames.videoHalfH;
  blob.focusLayoutRx = frames.layoutRx;
  blob.focusLayoutRy = frames.layoutRy;

  if (sim.paramTransitioning && sim.paramTargetIndex === index) {
    const from = sim.focusMorphFrom || sim.focusRest;
    if (from) {
      applyFocusPose(blob, from);
      blob.seat();
    }
  }
}

/** @param {import('./blob.js').Blob} blob @param {ReturnType<typeof captureFocusPose>} pose */
function applyFocusPose(blob, pose) {
  blob.centerX = pose.centerX;
  blob.centerY = pose.centerY;
  const n = Math.min(blob.circles.length, pose.circles.length);
  for (let i = 0; i < n; i++) {
    blob.circles[i].localX = pose.circles[i].localX;
    blob.circles[i].localY = pose.circles[i].localY;
  }
}

/**
 * Each ball moves along a straight world-space path; centre drift is included.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {ReturnType<typeof captureFocusPose>} from
 * @param {ReturnType<typeof captureFocusPose>} to
 * @param {number} t
 */
export function blendFocusPose(blob, from, to, t) {
  if (!from?.circles || !to?.circles) return;

  const cx = lerp(from.centerX, to.centerX, t);
  const cy = lerp(from.centerY, to.centerY, t);
  blob.centerX = cx;
  blob.centerY = cy;

  const n = Math.min(
    blob.circles.length,
    from.circles.length,
    to.circles.length,
  );
  for (let i = 0; i < n; i++) {
    const fromWx = from.circles[i].localX + from.centerX;
    const fromWy = from.circles[i].localY + from.centerY;
    const toWx = to.circles[i].localX + to.centerX;
    const toWy = to.circles[i].localY + to.centerY;
    blob.circles[i].localX = lerp(fromWx, toWx, t) - cx;
    blob.circles[i].localY = lerp(fromWy, toWy, t) - cy;
  }
  blob.seat();
  blob.measureRestFrame();
}

/** @param {import('./blob.js').BlobSim} sim @param {number} dt */
export function updateFocusTransition(sim, dt) {
  if (!sim.paramTransitioning) return;

  const growIndex = sim.paramTargetIndex;

  // Hold the live pose until video dimensions define the target layout.
  if (growIndex >= 0 && !sim.focusVideoReady) {
    const blob = sim.blobs[growIndex];
    const from = sim.focusMorphFrom || sim.focusRest;
    if (blob && from) {
      applyFocusPose(blob, from);
      blob.seat();
    }
    return;
  }

  sim.paramT += dt / Math.max(PARAMS.transitionSeconds, 0.05);
  const done = sim.paramT >= 1;
  if (done) sim.paramT = 1;

  const ease = easeTransition(sim.paramT);

  if (growIndex >= 0 && sim.focusRest && sim.focusTarget) {
    const blob = sim.blobs[growIndex];
    if (blob) {
      const from = sim.focusMorphFrom || sim.focusRest;
      blendFocusPose(blob, from, sim.focusTarget, ease);
      sim.focusZoom = lerp(sim.focusZoomFrom, sim.focusZoomTo, ease);
      if (ease >= 0.85 && !sim.focusLinksReady) {
        blob.buildLinks(3);
        sim.focusLinksReady = true;
      }
    }
  } else if (growIndex < 0 && sim.focusRest) {
    const blob = sim.blobs[sim.selectedIndex];
    if (!blob) return;
    const fromPose = sim.focusActive?.pose ?? captureFocusPose(blob);
    const fromZoom = sim.focusActive?.zoom ?? sim.focusZoom;
    blendFocusPose(blob, fromPose, sim.focusRest, ease);
    sim.focusZoom = lerp(fromZoom, sim.focusZoomFrom, ease);
    if (done) {
      sim.focusZoom = 1;
      sim.focusActive = null;
    }
  }

  if (!done) return;

  if (growIndex >= 0) {
    const blob = sim.blobs[growIndex];
    if (blob) {
      syncCircleLocalsFromWorld(blob);
      sim.focusActive = {
        pose: captureFocusPose(blob),
        zoom: sim.focusZoomTo,
      };
      sim.focusMorphFrom = null;
      beginFocusSettle(sim, growIndex);
    }
  }
}

/** @param {import('./blob.js').BlobSim} sim @param {number} index */
export function beginFocusSettle(sim, index) {
  if (index < 0) return;
  const blob = sim.blobs[index];
  if (!blob) return;

  sim.focusSettling = true;
  sim.focusSettleT = 0;
  sim.focusSettleIndex = index;
  syncCircleLocalsFromWorld(blob);
  if (!sim.focusLinksReady) blob.buildLinks(3);
}

/** @param {import('./blob.js').BlobSim} sim @param {number} dt */
export function updateFocusSettle(sim, dt) {
  if (!sim.focusSettling) return;

  sim.focusSettleT += dt / Math.max(PARAMS.focusSettleSeconds, 0.05);
  if (sim.focusSettleT >= 1) {
    sim.focusSettleT = 1;
    sim.focusSettling = false;
    sim.focusSettleIndex = -1;
  }
}

/** @param {import('./blob.js').BlobSim} sim */
export function focusSettleEase(sim) {
  if (!sim.focusSettling) return 1;
  return easeTransition(sim.focusSettleT);
}

/** @param {import('./blob.js').BlobSim} sim @param {number} index */
export function isFocusSettling(sim, index) {
  return sim.focusSettling && sim.focusSettleIndex === index;
}

/** Hard layout lock — only while the focus transition is running. */
export function isFocusTransitioning(sim, index) {
  if (!sim.paramTransitioning) return false;
  if (sim.paramTargetIndex === index) return true;
  if (sim.paramTargetIndex < 0 && sim.selectedIndex === index) return true;
  return false;
}

/** Selected and settled — blobbing allowed, aspect ratio preserved. */
export function isFocusSelected(sim, index) {
  return (
    sim.selectedIndex === index &&
    sim.paramTargetIndex >= 0 &&
    !sim.paramTransitioning
  );
}

/** @deprecated use isFocusTransitioning */
export function isFocusPinned(sim, index) {
  return isFocusTransitioning(sim, index);
}

/** Keep circle centres inside the inset layout ellipse while selected. */
export function containFocusAspect(blob, strength = 1) {
  const rx = blob.focusLayoutRx;
  const ry = blob.focusLayoutRy;
  if (!rx || !ry || strength <= 0) return;

  const slack = 1 + PARAMS.focusAspectSlack;
  for (const c of blob.circles) {
    const lx = c.x - blob.centerX;
    const ly = c.y - blob.centerY;
    const e = Math.hypot(lx / rx, ly / ry);
    if (e <= slack) continue;
    const pull = 1 + (e - slack) * 0.55;
    const tx = blob.centerX + lx / pull;
    const ty = blob.centerY + ly / pull;
    c.x = lerp(c.x, tx, strength);
    c.y = lerp(c.y, ty, strength);
    c.vx *= 1 - strength * 0.18;
    c.vy *= 1 - strength * 0.18;
  }
}

/**
 * Hard clamp so metaball reach never crosses the video UV frame.
 * Pass clampY = false while the breaker is splitting so the mass can overflow
 * the top/bottom instead of flattening into a straight canvas edge.
 */
export function containFocusVideoFrame(blob, strength = 1, clampY = true) {
  const hw = blob.focusVideoHalfW;
  const hh = blob.focusVideoHalfH;
  if (!hw || !hh || strength <= 0) return;

  for (const c of blob.circles) {
    const reach = c.radius * METABALL_VISIBLE_FRACTION;
    const maxX = Math.max(hw - reach, 0);
    const maxY = Math.max(hh - reach, 0);
    const lx = c.x - blob.centerX;
    const ly = c.y - blob.centerY;
    const nx = Math.max(-maxX, Math.min(maxX, lx));
    const ny = clampY ? Math.max(-maxY, Math.min(maxY, ly)) : ly;
    if (nx === lx && ny === ly) continue;
    c.x = lerp(c.x, blob.centerX + nx, strength);
    c.y = lerp(c.y, blob.centerY + ny, strength);
    c.vx *= 1 - strength * 0.25;
    if (clampY) c.vy *= 1 - strength * 0.25;
  }
}

/**
 * Video frame that fills the live circle AABB so the picture follows the
 * silhouette — idle, selected, and while the breaker is splitting.
 *
 * @param {import('./blob.js').Blob} blob
 */
export function liveSilhouetteFrame(blob) {
  if (!(blob.maxX > blob.minX) || !(blob.maxY > blob.minY)) return null;
  const pad = PARAMS.videoFitPadding;
  return {
    centerX: (blob.minX + blob.maxX) * 0.5,
    centerY: (blob.minY + blob.maxY) * 0.5,
    halfW: Math.max((blob.maxX - blob.minX) * 0.5, 1) * pad,
    halfH: Math.max((blob.maxY - blob.minY) * 0.5, 1) * pad,
    contain: 0,
    stretch: PARAMS.videoStretch,
  };
}

/**
 * Fixed focus / rest video frame with per-circle tearing. Never remaps onto
 * the live AABB — that made the picture scale like object-fit:cover when the
 * breaker stretched the blob. Circles keep their UV patches and split apart.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} index
 */
export function getBlendedVideoFrame(blob, sim, index) {
  const focused =
    blob.focusVideoHalfW > 0 &&
    blob.focusVideoHalfH > 0 &&
    (sim.selectedIndex === index ||
      sim.paramTargetIndex === index ||
      (sim.focusSettling && sim.focusSettleIndex === index));

  if (focused) {
    return {
      centerX: blob.centerX,
      centerY: blob.centerY,
      halfW: blob.focusVideoHalfW,
      halfH: blob.focusVideoHalfH,
      contain: 0,
    };
  }

  return null;
}

/** @param {import('./blob.js').BlobSim} sim */
export function resetFocus(sim) {
  sim.focusRest = null;
  sim.focusMorphFrom = null;
  sim.focusTarget = null;
  sim.focusActive = null;
  sim.focusZoom = 1;
  sim.focusZoomFrom = 1;
  sim.focusZoomTo = 1;
  sim.focusVideoReady = false;
  sim.focusVideoW = 0;
  sim.focusVideoH = 0;
  sim.focusSettling = false;
  sim.focusSettleT = 0;
  sim.focusSettleIndex = -1;
  sim.focusLinksReady = false;
  for (const blob of sim.blobs) {
    blob.focusLayoutRx = 0;
    blob.focusLayoutRy = 0;
    blob.focusVideoHalfW = 0;
    blob.focusVideoHalfH = 0;
  }
}
