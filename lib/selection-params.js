/**
 * Parameter-driven selection transitions — displace pin and repulsion targets.
 * Radius is unchanged; focus motion lives in selection-focus.js.
 */

import { PARAMS } from "./uniforms.js";
import { easeTransition } from "./selection.js";
import { updateFocusTransition } from "./selection-focus.js";

/** Slightly looser than idle — enough to prevent clumping, not ring-forming. */
export const SELECTED_OVERLAP = 0.48;
export const SELECTED_REPULSION = 2.4;

/** @param {import('./blob.js').BlobSim['blobs']} blobs */
export function captureParamSnapshot(blobs) {
  return {
    overlapTarget: PARAMS.overlapTarget,
    repulsion: PARAMS.repulsion,
    blobs: PARAMS.blobs.map((bp) => ({
      minRadius: bp.minRadius,
      maxRadius: bp.maxRadius,
      displaceAmount: bp.displaceAmount,
    })),
  };
}

/** @param {ReturnType<typeof captureParamSnapshot>} snap @param {number} index */
export function selectedParamTarget(snap, index) {
  return {
    overlapTarget: snap.overlapTarget,
    repulsion: snap.repulsion,
    blobs: snap.blobs.map((b, i) =>
      i === index ? { ...b, displaceAmount: 0 } : { ...b },
    ),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * @param {ReturnType<typeof captureParamSnapshot>} from
 * @param {ReturnType<typeof captureParamSnapshot>} to
 * @param {number} t eased 0..1
 * @param {import('./blob.js').BlobSim['blobs']} blobs
 */
export function applyParamBlend(from, to, t, blobs) {
  for (let i = 0; i < blobs.length; i++) {
    const bp = PARAMS.blobs[i];
    const bf = from.blobs[i];
    const bt = to.blobs[i];
    if (!bf || !bt) continue;

    bp.minRadius = bf.minRadius;
    bp.maxRadius = bf.maxRadius;
    bp.displaceAmount = lerp(bf.displaceAmount, bt.displaceAmount, t);

    const blob = blobs[i];
    blob?.resolveRadii();
    blob?.measureRestFrame();
  }
}

/** @param {import('./blob.js').BlobSim} sim */
export function captureLiveParams(sim) {
  return captureParamSnapshot(sim.blobs);
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} targetIndex -1 to deselect
 */
export function computeBlendTarget(sim, targetIndex) {
  if (targetIndex < 0) {
    return sim.restSnapshot || captureLiveParams(sim);
  }
  if (!sim.restSnapshot) {
    sim.restSnapshot = captureParamSnapshot(sim.blobs);
  }
  return selectedParamTarget(sim.restSnapshot, targetIndex);
}

/** @param {import('./blob.js').BlobSim} sim @param {number} dt */
export function updateParamTransition(sim, dt) {
  if (!sim.paramTransitioning) return;

  const wasT = sim.paramT;
  updateFocusTransition(sim, dt);

  const growIndex = sim.paramTargetIndex;
  const ease = easeTransition(sim.paramT);
  applyParamBlend(sim.paramFrom, sim.paramTo, ease, sim.blobs);

  const done = sim.paramT >= 1;
  if (!done) return;

  sim.paramTransitioning = false;
  sim.selectedIndex = sim.paramTargetIndex;

  if (growIndex < 0 && wasT < 1) {
    sim.restSnapshot = null;
  }
}
