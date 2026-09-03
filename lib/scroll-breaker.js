/**
 * Selected-state breaker: an invisible ellipse that rises with the project
 * info text and splits the focused blob around it.
 */

import { PARAMS } from "./uniforms.js";
import { isFocusSelected } from "./selection-focus.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (t) => clamp(t, 0, 1);

/**
 * @param {import('./blob.js').BlobSim} sim
 */
export function isBreakerLive(sim) {
  return (
    isFocusSelected(sim, sim.selectedIndex) &&
    (sim.breakerOpacity > 0.01 || sim.scrollProgress > 0.001)
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
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} deltaCss
 */
export function addScrollDelta(sim, deltaCss) {
  if (!isFocusSelected(sim, sim.selectedIndex)) return;
  const range = Math.max(PARAMS.scrollRange, 1);
  sim.scrollCss = clamp((sim.scrollCss || 0) + deltaCss, 0, range);
  sim.scrollTarget = sim.scrollCss / range;
}

/** @param {import('./blob.js').BlobSim} sim */
export function resetScroll(sim) {
  sim.scrollTarget = 0;
  sim.scrollProgress = 0;
  sim.scrollCss = 0;
}

/**
 * CSS size of the info block — drives the invisible collider.
 *
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} widthCss
 * @param {number} heightCss
 */
export function setInfoBoxCss(sim, widthCss, heightCss) {
  sim.infoBoxCssW = Math.max(widthCss, 0);
  sim.infoBoxCssH = Math.max(heightCss, 0);
}

/**
 * How strongly the breaker currently occupies the blob's vertical span, 0..1.
 *
 * @param {import('./blob.js').BlobSim} sim
 */
export function breakerOverlap(sim) {
  const b = sim.breaker;
  const blob = sim.blobs[sim.selectedIndex];
  if (!b || !blob || b.active < 0.01) return 0;
  const ry = blob.focusLayoutRy || blob.halfH || 1;
  const span = ry + (b.halfH || b.radius || 1);
  if (span < 1) return 0;
  return clamp01(1 - Math.abs(b.y - blob.centerY) / span);
}

/**
 * Info-sized ellipse in layout units. Height matches the text; width is
 * twice the height (and capped to the visible page).
 *
 * @param {import('./blob.js').BlobSim} sim
 */
function breakerSize(sim) {
  const zoom = Math.max(sim.focusZoom || 1, 1);
  const scale = Math.max(sim.view.layoutScale || 1, 1e-6);
  const visHalfW = sim.view.halfW / zoom;
  const cssH = sim.infoBoxCssH > 1 ? sim.infoBoxCssH : PARAMS.scrollTextHeight;
  // CSS px → layout: screen offset = layout * layoutScale * zoom (see input.js).
  const halfH = Math.max(cssH / (2 * scale * zoom), 12);
  const halfW = Math.min(halfH * PARAMS.breakerWidthScale, visHalfW * 0.92);
  return { halfW, halfH };
}

/**
 * Rise from below the page through the blob centre and out the top,
 * locked to the same path as the info text.
 *
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} dt
 */
export function updateBreaker(sim, dt) {
  const selected = isFocusSelected(sim, sim.selectedIndex);
  const targetOn = selected ? 1 : 0;
  const fade = 1 / Math.max(PARAMS.breakerFadeSeconds, 0.05);
  sim.breakerOpacity +=
    (targetOn - sim.breakerOpacity) * Math.min(1, fade * dt);
  if (Math.abs(sim.breakerOpacity - targetOn) < 1e-3) {
    sim.breakerOpacity = targetOn;
  }

  if (!selected && sim.breakerOpacity < 0.01) {
    resetScroll(sim);
    sim.breaker.active = 0;
    return;
  }

  const blob = sim.blobs[sim.selectedIndex] || null;
  const zoom = Math.max(sim.focusZoom || 1, 1);
  const visHalfH = sim.view.halfH / zoom;
  const { halfW, halfH } = breakerSize(sim);

  // Park the whole text block (centred on this Y) fully below / above the page.
  const startY = -visHalfH - halfH * 1.25;
  const endY = visHalfH + halfH * 1.25;
  const y = startY + (endY - startY) * sim.scrollProgress;

  sim.breaker.x = blob ? blob.centerX : 0;
  sim.breaker.y = y;
  sim.breaker.halfW = halfW;
  sim.breaker.halfH = halfH;
  sim.breaker.radius = halfH;
  sim.breaker.active = sim.breakerOpacity;
}

/**
 * Keep rest anchors on the focus layout while the circle is splitting the
 * mass, so the blob heals when the breaker leaves.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {import('./blob.js').BlobSim} sim
 */
export function pinFocusAnchors(blob, sim) {
  const target = sim.focusTarget;
  if (!target?.circles) return;
  for (let i = 0; i < blob.circles.length; i++) {
    const t = target.circles[i];
    if (!t) continue;
    const c = blob.circles[i];
    c.localX = t.localX;
    c.localY = t.localY;
    c.anchorX = t.localX + blob.centerX;
    c.anchorY = t.localY + blob.centerY;
  }
}

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @param {{ x: number, y: number, halfW: number, halfH: number }} breaker
 */
export function linkCrossesBreaker(a, b, breaker) {
  const hw = Math.max(breaker.halfW || breaker.radius || 1, 1);
  const hh = Math.max(breaker.halfH || breaker.radius || 1, 1);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const inside = (px, py) => {
    const nx = (px - breaker.x) / hw;
    const ny = (py - breaker.y) / hh;
    return nx * nx + ny * ny < 1.08;
  };
  if (len2 < 1e-6) return inside(a.x, a.y);
  const t = clamp(
    ((breaker.x - a.x) * vx + (breaker.y - a.y) * vy) / len2,
    0,
    1,
  );
  return inside(a.x + vx * t, a.y + vy * t);
}

/**
 * Ellipse-space separation of a blob circle from the breaker.
 *
 * @param {{ x: number, y: number, radius: number }} c
 * @param {{ x: number, y: number, halfW: number, halfH: number }} b
 */
function ellipseSep(c, b) {
  const hw = Math.max((b.halfW || b.radius || 1) + c.radius, 1);
  const hh = Math.max((b.halfH || b.radius || 1) + c.radius, 1);
  let dx = c.x - b.x;
  let dy = c.y - b.y;
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
    dx = c.x >= b.x ? 1 : -1;
    dy = 0;
  }
  const nx = dx / hw;
  const ny = dy / hh;
  const e = Math.hypot(nx, ny) || 1e-4;
  let ux = dx / (hw * hw) / e;
  let uy = dy / (hh * hh) / e;
  const glen = Math.hypot(ux, uy) || 1;
  ux /= glen;
  uy /= glen;
  return { e, ux, uy, dx, dy };
}

/**
 * One-way repulsion + a lateral split so the ellipse reads as a wedge
 * through the middle rather than a lift.
 *
 * @param {import('./blob.js').BlobSim} sim
 */
export function applyBreakerForces(sim) {
  const b = sim.breaker;
  if (!b || b.active < 0.01) return;
  if (!isFocusSelected(sim, sim.selectedIndex)) return;

  const blob = sim.blobs[sim.selectedIndex];
  if (!blob) return;

  const strength = PARAMS.breakerRepulsion * b.active;
  const split = PARAMS.breakerSplit * b.active;
  if (strength <= 0 && split <= 0) return;

  const hh = Math.max(b.halfH || b.radius || 1, 1);

  for (const c of blob.circles) {
    const { e, ux, uy } = ellipseSep(c, b);
    const side = c.x >= b.x ? 1 : -1;
    const band = clamp01(1 - Math.abs(c.y - b.y) / Math.max(hh + c.radius, 1));

    if (e < PARAMS.breakerOverlap) {
      const push =
        strength *
        (PARAMS.breakerOverlap - e) *
        Math.min(Math.max(hh, 40), 180);
      c.fx += ux * push + side * split * band;
      c.fy += uy * push * 0.22;
    } else if (band > 0.15 && split > 0) {
      c.fx += side * split * band * 0.35;
    }
  }
}

/**
 * Positional constraint so the split is immediate, not just a slow shove.
 *
 * @param {import('./blob.js').BlobSim} sim
 */
export function applyBreakerConstraints(sim) {
  const b = sim.breaker;
  if (!b || b.active < 0.01) return;
  if (!isFocusSelected(sim, sim.selectedIndex)) return;

  const blob = sim.blobs[sim.selectedIndex];
  if (!blob) return;

  const corrK = PARAMS.breakerPush * b.active;
  if (corrK <= 0) return;

  const hh = Math.max(b.halfH || b.radius || 1, 1);

  for (const c of blob.circles) {
    const { e, ux, uy } = ellipseSep(c, b);
    if (e >= PARAMS.breakerOverlap) continue;

    let px = ux;
    let py = uy * 0.18;
    if (Math.abs(c.x - b.x) < Math.max(8, c.radius * 0.25)) {
      px = c.x >= b.x ? 1 : -1;
      py = 0;
    }
    const len = Math.hypot(px, py) || 1;
    px /= len;
    py /= len;

    const corr =
      (PARAMS.breakerOverlap - e) * corrK * Math.min(Math.max(hh, 40), 180);
    c.x += px * corr;
    c.y += py * corr;

    const vn = c.vx * px + c.vy * py;
    if (vn < 0) {
      c.vx -= vn * px;
      c.vy -= vn * py;
    }
  }
}
