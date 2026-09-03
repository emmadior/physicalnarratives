/**
 * Off-canvas exit / return for unselected blobs during focus.
 *
 * Exit is a shove along the vector from the selected centre, fully clearing
 * the viewport (full circle radii + breathing). Return waits until the
 * selected blob has finished shrinking.
 */

import { PARAMS } from "./uniforms.js";

const COINCIDENT_EPS = 4;

function easeInCubic(t) {
  return t * t * t;
}

function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** @param {import('./blob.js').Blob} blob */
export function captureMotionSnapshot(blob) {
  return {
    centerX: blob.centerX,
    centerY: blob.centerY,
    homeFx: blob.homeFx,
    homeFy: blob.homeFy,
    freeRef: blob.freeRef ? { x: blob.freeRef.x, y: blob.freeRef.y } : null,
    velX: blob.velX,
    velY: blob.velY,
    velFromX: blob.velFromX,
    velFromY: blob.velFromY,
    velToX: blob.velToX,
    velToY: blob.velToY,
    phaseTime: blob.phaseTime,
    phaseDur: blob.phaseDur,
    easeDur: blob.easeDur,
    nudgeIn: blob.nudgeIn,
    circles: blob.circles.map((c) => ({
      x: c.x,
      y: c.y,
      vx: c.vx,
      vy: c.vy,
      fx: c.fx,
      fy: c.fy,
      radius: c.radius,
    })),
  };
}

/** @param {import('./blob.js').Blob} blob @param {ReturnType<typeof captureMotionSnapshot>} snap */
export function restoreMotionSnapshot(blob, snap) {
  blob.centerX = snap.centerX;
  blob.centerY = snap.centerY;
  blob.homeFx = snap.homeFx;
  blob.homeFy = snap.homeFy;
  blob.freeRef = snap.freeRef
    ? { x: snap.freeRef.x, y: snap.freeRef.y }
    : blob.freeRef;
  blob.velX = snap.velX;
  blob.velY = snap.velY;
  blob.velFromX = snap.velFromX;
  blob.velFromY = snap.velFromY;
  blob.velToX = snap.velToX;
  blob.velToY = snap.velToY;
  blob.phaseTime = snap.phaseTime;
  blob.phaseDur = snap.phaseDur;
  blob.easeDur = snap.easeDur;
  blob.nudgeIn = snap.nudgeIn;

  const n = Math.min(blob.circles.length, snap.circles.length);
  for (let i = 0; i < n; i++) {
    const c = blob.circles[i];
    const s = snap.circles[i];
    c.x = s.x;
    c.y = s.y;
    c.vx = s.vx;
    c.vy = s.vy;
    c.fx = s.fx;
    c.fy = s.fy;
    c.anchorX = c.localX + blob.centerX;
    c.anchorY = c.localY + blob.centerY;
  }
  blob.updateCentroid();
  blob.updateBounds();
}

/** @param {import('./blob.js').Blob} blob */
export function translateBlob(blob, nx, ny) {
  const dx = nx - blob.centerX;
  const dy = ny - blob.centerY;
  if (dx === 0 && dy === 0) return;
  blob.centerX = nx;
  blob.centerY = ny;
  for (const c of blob.circles) {
    c.x += dx;
    c.y += dy;
    c.anchorX += dx;
    c.anchorY += dy;
    c.vx = 0;
    c.vy = 0;
    c.fx = 0;
    c.fy = 0;
  }
  blob.updateCentroid();
  blob.updateBounds();
}

/**
 * AABB of the blob relative to its centre, using full radii inflated by the
 * maximum breathing amplitude so a peak breath cannot clip the edge.
 * @param {import('./blob.js').Blob} blob
 */
export function relativeExtent(blob) {
  const breath = 1 + PARAMS.breathAmount;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const c of blob.circles) {
    const r = Math.max(c.radius, c.baseRadius) * breath;
    const lx = c.x - blob.centerX;
    const ly = c.y - blob.centerY;
    minX = Math.min(minX, lx - r);
    maxX = Math.max(maxX, lx + r);
    minY = Math.min(minY, ly - r);
    maxY = Math.max(maxY, ly + r);
  }
  return { minX, maxX, minY, maxY };
}

function nearestEdgeDir(cx, cy, view) {
  const distR = view.halfW - cx;
  const distL = view.halfW + cx;
  const distT = view.halfH - cy;
  const distB = view.halfH + cy;
  const min = Math.min(distR, distL, distT, distB);
  if (min === distR) return { x: 1, y: 0 };
  if (min === distL) return { x: -1, y: 0 };
  if (min === distT) return { x: 0, y: 1 };
  return { x: 0, y: -1 };
}

/**
 * Unit shove direction: selected centre → blob centre, or nearest-edge fallback.
 * @param {import('./blob.js').Blob} blob
 * @param {import('./blob.js').Blob} selected
 * @param {{ halfW: number, halfH: number }} view
 */
export function exitDirection(blob, selected, view) {
  const dx = blob.centerX - selected.centerX;
  const dy = blob.centerY - selected.centerY;
  const len = Math.hypot(dx, dy);
  if (len < COINCIDENT_EPS) {
    return nearestEdgeDir(blob.centerX, blob.centerY, view);
  }
  return { x: dx / len, y: dy / len };
}

/**
 * Destination centre such that the entire blob (full radii + breath) is outside
 * the viewport in the given direction, plus exitMargin in CSS px.
 * @param {import('./blob.js').Blob} blob
 * @param {{ x: number, y: number }} dir
 * @param {{ halfW: number, halfH: number, layoutScale: number }} view
 */
export function exitDestination(blob, dir, view) {
  const ext = relativeExtent(blob);
  const ux = dir.x;
  const uy = dir.y;
  const cx = blob.centerX;
  const cy = blob.centerY;
  const hw = view.halfW;
  const hh = view.halfH;
  const margin = PARAMS.exitMargin / Math.max(view.layoutScale || 1, 1e-6);

  let tBest = Infinity;

  if (ux > 1e-6) {
    tBest = Math.min(tBest, (hw + margin - ext.minX - cx) / ux);
  } else if (ux < -1e-6) {
    tBest = Math.min(tBest, (-hw - margin - ext.maxX - cx) / ux);
  }
  if (uy > 1e-6) {
    tBest = Math.min(tBest, (hh + margin - ext.minY - cy) / uy);
  } else if (uy < -1e-6) {
    tBest = Math.min(tBest, (-hh - margin - ext.maxY - cy) / uy);
  }

  if (!Number.isFinite(tBest) || tBest < 0) {
    const fallback = nearestEdgeDir(cx, cy, view);
    return exitDestination(blob, fallback, view);
  }

  return { x: cx + ux * tBest, y: cy + uy * tBest };
}

/** @param {import('./blob.js').BlobSim} sim */
export function isMotionLocked(sim, index) {
  return !!sim.exitSlots[index]?.active && sim.exitPhase !== "idle";
}

function captureAllSnapshots(sim) {
  sim.motionSnapshots = sim.blobs.map(captureMotionSnapshot);
}

function capturePose(blob) {
  return {
    centerX: blob.centerX,
    centerY: blob.centerY,
    circles: blob.circles.map((c) => ({ x: c.x, y: c.y })),
  };
}

function applyPoseLerp(blob, from, toCenterX, toCenterY, toCircles, t) {
  const nx = lerp(from.centerX, toCenterX, t);
  const ny = lerp(from.centerY, toCenterY, t);
  blob.centerX = nx;
  blob.centerY = ny;
  const n = Math.min(
    blob.circles.length,
    from.circles.length,
    toCircles.length,
  );
  for (let i = 0; i < n; i++) {
    const c = blob.circles[i];
    c.x = lerp(from.circles[i].x, toCircles[i].x, t);
    c.y = lerp(from.circles[i].y, toCircles[i].y, t);
    c.anchorX = c.localX + blob.centerX;
    c.anchorY = c.localY + blob.centerY;
    c.vx = 0;
    c.vy = 0;
    c.fx = 0;
    c.fy = 0;
  }
  blob.updateCentroid();
  blob.updateBounds();
}

/**
 * Begin / retarget shoving every blob except `keepIndex` off-canvas.
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} keepIndex
 */
export function beginExit(sim, keepIndex) {
  if (!sim.motionSnapshots) captureAllSnapshots(sim);

  const selected = sim.blobs[keepIndex];
  if (!selected) return;

  sim.exitPhase = "exiting";
  sim.exitT = 0;
  sim.returnWaitT = 0;

  for (let i = 0; i < sim.blobs.length; i++) {
    if (i === keepIndex) {
      if (sim.exitSlots[i]) sim.exitSlots[i].active = false;
      continue;
    }
    const blob = sim.blobs[i];
    const dir = exitDirection(blob, selected, sim.view);
    const dest = exitDestination(blob, dir, sim.view);
    sim.exitSlots[i] = {
      active: true,
      from: capturePose(blob),
      toX: dest.x,
      toY: dest.y,
    };
  }
}

/** Keep already-off blobs off-screen after a resize. */
export function retargetAwayPositions(sim) {
  if (sim.exitPhase !== "away" && sim.exitPhase !== "waiting") return;
  const keep =
    sim.paramTargetIndex >= 0 ? sim.paramTargetIndex : sim.selectedIndex;
  const selected = keep >= 0 ? sim.blobs[keep] : null;

  for (let i = 0; i < sim.blobs.length; i++) {
    const slot = sim.exitSlots[i];
    if (!slot?.active) continue;
    const blob = sim.blobs[i];
    const dir = selected
      ? exitDirection(blob, selected, sim.view)
      : nearestEdgeDir(blob.centerX, blob.centerY, sim.view);
    const dest = exitDestination(blob, dir, sim.view);
    slot.toX = dest.x;
    slot.toY = dest.y;
    translateBlob(blob, dest.x, dest.y);
  }
}

/** Called when the selected blob has finished shrinking. */
export function beginReturnWait(sim) {
  const anyAway = sim.exitSlots.some((s) => s?.active);
  if (!anyAway) {
    finishExitCycle(sim);
    return;
  }
  sim.exitPhase = "waiting";
  sim.returnWaitT = 0;
}

function startReturn(sim) {
  sim.exitPhase = "returning";
  sim.exitT = 0;
  for (let i = 0; i < sim.blobs.length; i++) {
    const slot = sim.exitSlots[i];
    if (!slot?.active) continue;
    slot.from = capturePose(sim.blobs[i]);
  }
}

function finishExitCycle(sim) {
  for (let i = 0; i < sim.blobs.length; i++) {
    const slot = sim.exitSlots[i];
    const snap = sim.motionSnapshots?.[i];
    if (slot?.active && snap) restoreMotionSnapshot(sim.blobs[i], snap);
    sim.exitSlots[i] = null;
  }
  sim.motionSnapshots = null;
  sim.exitPhase = "idle";
  sim.exitT = 0;
  sim.returnWaitT = 0;
  sim.restSnapshot = null;
}

/** @param {import('./blob.js').BlobSim} sim @param {number} dt */
export function updateExitMotion(sim, dt) {
  if (sim.exitPhase === "idle") return;

  if (sim.exitPhase === "waiting") {
    sim.returnWaitT += dt;
    if (sim.returnWaitT >= Math.max(PARAMS.returnDelaySeconds, 0)) {
      startReturn(sim);
    }
    return;
  }

  if (sim.exitPhase === "away") return;

  const exiting = sim.exitPhase === "exiting";
  const duration = Math.max(
    exiting ? PARAMS.exitSeconds : PARAMS.returnSeconds,
    0.05,
  );
  sim.exitT += dt / duration;
  const done = sim.exitT >= 1;
  if (done) sim.exitT = 1;
  const ease = exiting ? easeInCubic(sim.exitT) : easeOutCubic(sim.exitT);

  for (let i = 0; i < sim.blobs.length; i++) {
    const slot = sim.exitSlots[i];
    if (!slot?.active || !slot.from) continue;
    const blob = sim.blobs[i];
    if (exiting) {
      applyPoseLerp(
        blob,
        slot.from,
        slot.toX,
        slot.toY,
        slot.from.circles.map((c) => ({
          x: c.x + (slot.toX - slot.from.centerX),
          y: c.y + (slot.toY - slot.from.centerY),
        })),
        ease,
      );
    } else {
      const snap = sim.motionSnapshots[i];
      applyPoseLerp(
        blob,
        slot.from,
        snap.centerX,
        snap.centerY,
        snap.circles,
        ease,
      );
    }
  }

  if (!done) return;

  if (exiting) {
    sim.exitPhase = "away";
    return;
  }

  finishExitCycle(sim);
}
