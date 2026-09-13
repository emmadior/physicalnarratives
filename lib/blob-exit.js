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

/**
 * Resume idle motion after a return fly-in without snapping back to the
 * velocities / phase frozen at exit (that hard cut read as a morph jump).
 * Pose is already at the snapshot from the return lerp.
 *
 * Do not bake live world positions into localX/localY or anchors: the shader
 * maps video through (pos - anchor) against the rest frame. Zeroing that
 * offset after return clamps UVs and stretches edge pixels into streaks.
 *
 * @param {import('./blob.js').Blob} blob
 * @param {ReturnType<typeof captureMotionSnapshot>} snap
 */
export function softResumeAfterReturn(blob, snap) {
  blob.homeFx = snap.homeFx;
  blob.homeFy = snap.homeFy;
  blob.freeRef = snap.freeRef
    ? { x: snap.freeRef.x, y: snap.freeRef.y }
    : blob.freeRef;

  // Fresh drift — ease in from rest instead of replaying the exit-time shove.
  blob.velX = 0;
  blob.velY = 0;
  blob.velFromX = 0;
  blob.velFromY = 0;
  blob.velToX = 0;
  blob.velToY = 0;
  blob.phaseTime = 0;
  blob.phaseDur = Math.max(snap.phaseDur || 2, 1.5);
  blob.easeDur = 1.2;
  blob.nudgeIn = 0.35;
  blob.exitMotionBlend = 0;

  for (const c of blob.circles) {
    // Locals stay the rest layout (never mutated during exit). Rebind anchors
    // so displace UVs lock to the video frame; leave world x/y at the returned
    // snapshot so the silhouette continues without a hard seat snap.
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
  // Use absolute distance so points already outside the viewport still
  // resolve to a stable outward edge (signed min would pick the past edge
  // and keep returning the same direction forever).
  const candidates = [
    { d: Math.abs(distR), dir: { x: 1, y: 0 } },
    { d: Math.abs(distL), dir: { x: -1, y: 0 } },
    { d: Math.abs(distT), dir: { x: 0, y: 1 } },
    { d: Math.abs(distB), dir: { x: 0, y: -1 } },
  ];
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].d < best.d) best = candidates[i];
  }
  return best.dir;
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
  let ux = dir.x;
  let uy = dir.y;
  const cx = blob.centerX;
  const cy = blob.centerY;
  const hw = Math.max(view.halfW || 0, 1);
  const hh = Math.max(view.halfH || 0, 1);
  const margin = PARAMS.exitMargin / Math.max(view.layoutScale || 1, 1e-6);
  const span = Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY, 1);

  const travelAlong = (xDir, yDir) => {
    let t = Infinity;
    if (xDir > 1e-6) t = Math.min(t, (hw + margin - ext.minX - cx) / xDir);
    else if (xDir < -1e-6) t = Math.min(t, (-hw - margin - ext.maxX - cx) / xDir);
    if (yDir > 1e-6) t = Math.min(t, (hh + margin - ext.minY - cy) / yDir);
    else if (yDir < -1e-6) t = Math.min(t, (-hh - margin - ext.maxY - cy) / yDir);
    return t;
  };

  let tBest = travelAlong(ux, uy);

  if (!Number.isFinite(tBest)) {
    const fallback = nearestEdgeDir(cx, cy, view);
    ux = fallback.x;
    uy = fallback.y;
    tBest = travelAlong(ux, uy);
  }

  // Already clear of the viewport in this direction — nudge further out once.
  // Never recurse: that could stack-overflow when the blob is already outside.
  if (!Number.isFinite(tBest) || tBest < 0) {
    const push = Math.max(margin, span * 0.25);
    return { x: cx + ux * push, y: cy + uy * push };
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
    if (slot?.active && snap) softResumeAfterReturn(sim.blobs[i], snap);
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
