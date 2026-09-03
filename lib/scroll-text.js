/**
 * Scroll narrative: rising text repels the selected blob upward. Circles may
 * cross the top canvas edge (clipped) so the silhouette appears split in two.
 */

import { PARAMS } from "./uniforms.js";
import { isFocusSelected } from "./selection-focus.js";

const clamp01 = (t) => Math.max(0, Math.min(1, t));

/**
 * @param {import('./blob.js').BlobSim} sim
 */
export function isScrollNarrativeActive(sim) {
  return (
    isFocusSelected(sim, sim.selectedIndex) &&
    (sim.scrollProgress > 0.001 || sim.scrollTarget > 0.001)
  );
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} dt
 */
export function updateScrollProgress(sim, dt) {
  const rate = 1 / Math.max(PARAMS.scrollSmoothSeconds, 0.05);
  const target = clamp01(sim.scrollTarget);
  sim.scrollProgress += (target - sim.scrollProgress) * Math.min(1, rate * dt);
  if (Math.abs(sim.scrollProgress - target) < 1e-4) {
    sim.scrollProgress = target;
  }
}

/**
 * CSS px scrolled → target progress.
 *
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} scrollCssPx
 */
export function setScrollTarget(sim, scrollCssPx) {
  sim.scrollTarget = clamp01(scrollCssPx / Math.max(PARAMS.scrollRange, 1));
}

/** @param {import('./blob.js').BlobSim} sim */
export function resetScroll(sim) {
  sim.scrollTarget = 0;
  sim.scrollProgress = 0;
}

/**
 * Convert a DOM rect to layout space (origin centre, +y up).
 *
 * @param {DOMRect} rect
 * @param {DOMRect} containerRect
 * @param {number} layoutScale
 * @param {number} focusZoom
 */
export function domRectToLayout(rect, containerRect, layoutScale, focusZoom) {
  const zoom = Math.max(focusZoom, 1);
  const scale = Math.max(layoutScale, 1e-6);
  const cx = containerRect.left + containerRect.width * 0.5;
  const cy = containerRect.top + containerRect.height * 0.5;

  const toX = (px) => ((px - cx) / scale) * zoom;
  const toY = (py) => (-(py - cy) / scale) * zoom;

  const left = toX(rect.left);
  const right = toX(rect.right);
  const top = toY(rect.top);
  const bottom = toY(rect.bottom);

  return {
    left: Math.min(left, right),
    right: Math.max(left, right),
    top: Math.max(top, bottom),
    bottom: Math.min(top, bottom),
  };
}

/**
 * Fallback text block when no DOM element is measured yet.
 *
 * @param {import('./blob.js').BlobSim['view']} view
 * @param {number} scrollProgress
 * @param {number} layoutScale
 */
export function estimateTextBlockLayout(view, scrollProgress, layoutScale) {
  const scale = Math.max(layoutScale, 1e-6);
  const textH = PARAMS.scrollTextHeight / scale;
  const rise = scrollProgress * (view.halfH * 2 + textH);
  const bottom = -view.halfH - textH + rise;
  const top = bottom + textH;
  const marginX = view.halfW * 0.12;
  return {
    left: -view.halfW + marginX,
    right: view.halfW - marginX,
    top,
    bottom,
  };
}

/**
 * @param {number} px
 * @param {number} py
 * @param {{ left: number, right: number, top: number, bottom: number }} box
 */
function closestPointOnRect(px, py, box) {
  const cx = Math.max(box.left, Math.min(box.right, px));
  const cy = Math.max(box.bottom, Math.min(box.top, py));
  return { x: cx, y: cy };
}

/**
 * @param {import('./blob.js').Blob} blob
 * @param {{ left: number, right: number, top: number, bottom: number }} box
 * @param {number} layoutScale
 */
function applyTextRepulsion(blob, box, layoutScale) {
  const strength = PARAMS.scrollRepulsion;
  if (strength <= 0) return;

  const pad = PARAMS.scrollTextPadding / Math.max(layoutScale, 1e-6);
  const inflated = {
    left: box.left - pad,
    right: box.right + pad,
    top: box.top + pad,
    bottom: box.bottom - pad,
  };

  for (const c of blob.circles) {
    const cp = closestPointOnRect(c.x, c.y, inflated);
    let dx = c.x - cp.x;
    let dy = c.y - cp.y;
    let dist = Math.hypot(dx, dy);
    const minDist = c.radius * 0.92;

    if (dist < 1e-4) {
      dx = 0;
      dy = 1;
      dist = 1;
    }

    if (dist >= minDist) continue;

    const push = strength * (minDist - dist);
    const ux = dx / dist;
    const uy = dy / dist;
    // Bias upward so the text reads as lifting the blob.
    const lift = PARAMS.scrollLiftBias;
    const nx = ux * (1 - lift);
    const ny = uy * (1 - lift) + lift;

    c.fx += nx * push;
    c.fy += ny * push;
  }
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {{ left: number, right: number, top: number, bottom: number } | null} textBox
 */
export function applyScrollForces(sim, textBox) {
  if (!isFocusSelected(sim, sim.selectedIndex)) return;
  if (sim.scrollProgress <= 0 && sim.scrollTarget <= 0) return;

  const blob = sim.blobs[sim.selectedIndex];
  if (!blob) return;

  const box =
    textBox ??
    estimateTextBlockLayout(sim.view, sim.scrollProgress, sim.view.layoutScale);

  applyTextRepulsion(blob, box, sim.view.layoutScale);
  if (shouldAllowTopOverflow(sim)) {
    applyTopSpillForces(blob, sim.view, sim.scrollProgress);
  }
}

/**
 * Circles squeezed under the top edge spill sideways — the split silhouette.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {import('./blob.js').BlobSim['view']} view
 * @param {number} scrollProgress
 */
export function applyTopSpillForces(blob, view, scrollProgress) {
  const strength = PARAMS.scrollTopSpill * scrollProgress;
  if (strength <= 0) return;

  const buffer =
    view.edgeBuffer != null
      ? view.edgeBuffer
      : PARAMS.edgeBuffer / Math.max(view.layoutScale || 1, 1e-6);
  const ceiling = view.halfH - buffer;

  for (const c of blob.circles) {
    if (c.y < ceiling - c.radius * 0.35) continue;
    const side = c.x >= blob.centroidX ? 1 : -1;
    c.fx += side * strength;
  }
}

/**
 * @param {import('./blob.js').BlobSim} sim
 */
export function getDispersalCenterY(sim) {
  const view = sim.view;
  const maxPush = view.halfH * PARAMS.scrollCenterPush;
  return sim.scrollProgress * maxPush;
}

/** @param {import('./blob.js').BlobSim} sim */
export function shouldAllowTopOverflow(sim) {
  return sim.scrollProgress > PARAMS.scrollTopUnlock;
}
