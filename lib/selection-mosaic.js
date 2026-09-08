/**
 * Mosaic assembly on selection: circles morph into video-aspect tiles, glide
 * into an N×N grid, and scale to viewport. Fully reversible.
 */

import { PARAMS } from "./uniforms.js";
import { easeTransition } from "./selection.js";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Snap population to nearest perfect square (4, 9, 16, 25…). */
export function nearestSquareGrid(count) {
  const root = Math.sqrt(count);
  const lo = Math.floor(root);
  const hi = Math.ceil(root);
  const loCount = lo * lo;
  const hiCount = hi * hi;
  if (lo === hi) return { gridN: lo, gridCount: loCount };
  if (count - loCount <= hiCount - count) {
    return { gridN: lo, gridCount: loCount };
  }
  return { gridN: hi, gridCount: hiCount };
}

/** @param {import('./blob.js').Blob} blob */
export function captureMosaicPose(blob) {
  return {
    centerX: blob.centerX,
    centerY: blob.centerY,
    circles: blob.circles.map((c) => ({
      localX: c.localX,
      localY: c.localY,
      x: c.x,
      y: c.y,
      radius: c.radius,
      baseRadius: c.baseRadius,
      mosaicOpacity: c.mosaicOpacity,
      shapeBlend: c.shapeBlend,
      tileHalfW: c.tileHalfW,
      tileHalfH: c.tileHalfH,
      cornerRadius: c.cornerRadius,
      srcUvMinX: c.srcUvMinX,
      srcUvMinY: c.srcUvMinY,
      srcUvMaxX: c.srcUvMaxX,
      srcUvMaxY: c.srcUvMaxY,
      dstMinX: c.dstMinX,
      dstMinY: c.dstMinY,
      dstMaxX: c.dstMaxX,
      dstMaxY: c.dstMaxY,
    })),
  };
}

/** @param {import('./blob.js').Blob} blob @param {ReturnType<typeof captureMosaicPose>} pose */
function applyMosaicPose(blob, pose) {
  blob.centerX = pose.centerX;
  blob.centerY = pose.centerY;
  const n = Math.min(blob.circles.length, pose.circles.length);
  for (let i = 0; i < n; i++) {
    const c = blob.circles[i];
    const p = pose.circles[i];
    c.localX = p.localX;
    c.localY = p.localY;
    c.x = p.x;
    c.y = p.y;
    c.radius = p.radius;
    c.mosaicOpacity = p.mosaicOpacity;
    c.shapeBlend = p.shapeBlend;
    c.tileHalfW = p.tileHalfW;
    c.tileHalfH = p.tileHalfH;
    c.cornerRadius = p.cornerRadius;
    c.srcUvMinX = p.srcUvMinX;
    c.srcUvMinY = p.srcUvMinY;
    c.srcUvMaxX = p.srcUvMaxX;
    c.srcUvMaxY = p.srcUvMaxY;
    c.dstMinX = p.dstMinX;
    c.dstMinY = p.dstMinY;
    c.dstMaxX = p.dstMaxX;
    c.dstMaxY = p.dstMaxY;
    c.anchorX = c.x;
    c.anchorY = c.y;
    c.vx = 0;
    c.vy = 0;
  }
  blob.updateCentroid();
  blob.updateBounds();
}

/**
 * Per-circle FROM rects for geometric UV interpolation (tear-free blob frame).
 * @param {import('./blob.js').Circle} c
 * @param {import('./blob.js').Blob} blob
 */
function captureCircleFromRects(c, blob) {
  const r = Math.max(c.radius, c.baseRadius, 1);
  const cx = c.x;
  const cy = c.y;

  const lx = cx - blob.videoFrameCenterX;
  const ly = cy - blob.videoFrameCenterY;
  const fitW = Math.max(blob.videoFrameHalfW, 1);
  const fitH = Math.max(blob.videoFrameHalfH, 1);
  const u = clamp01(lx / (fitW * 2) + 0.5);
  const v = clamp01(ly / (fitH * 2) + 0.5);
  const halfUw = r / (fitW * 2);
  const halfUh = r / (fitH * 2);

  return {
    dstMinX: cx - r,
    dstMinY: cy - r,
    dstMaxX: cx + r,
    dstMaxY: cy + r,
    srcUvMinX: clamp01(u - halfUw),
    srcUvMinY: clamp01(v - halfUh),
    srcUvMaxX: clamp01(u + halfUw),
    srcUvMaxY: clamp01(v + halfUh),
  };
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {import('./blob.js').Blob} blob
 * @param {number} videoW
 * @param {number} videoH
 * @param {typeof import('./blob.js').Circle} CircleClass
 */
function computeMosaicTarget(sim, blob, videoW, videoH, CircleClass) {
  const naturalCount = blob.circles.length - (sim.mosaicPhantoms || 0);
  const { gridN, gridCount } = nearestSquareGrid(naturalCount);
  const aspect = videoW / Math.max(videoH, 1);
  const gap =
    PARAMS.mosaicTileGap / Math.max(sim.view.layoutScale || 1, 1e-6);

  const tileHalfH = 48;
  const tileHalfW = tileHalfH * aspect;
  const pitchX = tileHalfW * 2 + gap;
  const pitchY = tileHalfH * 2 + gap;
  const frameHalfW = ((gridN - 1) * 0.5) * pitchX + tileHalfW;
  const frameHalfH = ((gridN - 1) * 0.5) * pitchY + tileHalfH;

  const layoutScale = Math.max(sim.view.layoutScale || 1, 1e-6);
  const inset = (PARAMS.mosaicPadding + PARAMS.edgeBuffer) / layoutScale;
  const playerInset = PARAMS.focusPlayerHeight / layoutScale;
  const needW = Math.max(sim.view.halfW - inset, 1);
  const needH = Math.max(sim.view.halfH - inset - playerInset * 0.5, 1);
  let assemblyZoom = Math.min(needW / frameHalfW, needH / frameHalfH);
  if (PARAMS.mosaicMaxScale > 0) {
    assemblyZoom = Math.min(assemblyZoom, PARAMS.mosaicMaxScale);
  }
  assemblyZoom = Math.max(assemblyZoom, 1);

  const scaledTileHalfW = tileHalfW * assemblyZoom;
  const scaledTileHalfH = tileHalfH * assemblyZoom;
  const scaledPitchX = scaledTileHalfW * 2 + gap;
  const scaledPitchY = scaledTileHalfH * 2 + gap;
  const scaledFrameHalfW =
    ((gridN - 1) * 0.5) * scaledPitchX + scaledTileHalfW;
  const scaledFrameHalfH =
    ((gridN - 1) * 0.5) * scaledPitchY + scaledTileHalfH;

  const cells = [];
  const mid = (gridN - 1) * 0.5;
  for (let row = 0; row < gridN; row++) {
    for (let col = 0; col < gridN; col++) {
      const cx = (col - mid) * scaledPitchX;
      const cy = (mid - row) * scaledPitchY;
      const dist = Math.hypot(col - mid, row - mid) / Math.max(mid, 1);
      cells.push({
        row,
        col,
        cx,
        cy,
        stagger: dist,
        srcUvMinX: col / gridN,
        srcUvMinY: 1 - (row + 1) / gridN,
        srcUvMaxX: (col + 1) / gridN,
        srcUvMaxY: 1 - row / gridN,
        tileHalfW: scaledTileHalfW,
        tileHalfH: scaledTileHalfH,
      });
    }
  }

  const circleStarts = blob.circles.map((c, i) => ({
    index: i,
    x: c.x,
    y: c.y,
    from: captureCircleFromRects(c, blob),
    phantom: i >= naturalCount,
  }));

  const assignments = [];
  const usedCircles = new Set();

  const cellsByDist = [...cells].sort((a, b) => a.stagger - b.stagger);
  for (const cell of cellsByDist) {
    let best = -1;
    let bestD = Infinity;
    for (const cs of circleStarts) {
      if (usedCircles.has(cs.index)) continue;
      const d = Math.hypot(cs.x - cell.cx, cs.y - cell.cy);
      if (d < bestD) {
        bestD = d;
        best = cs.index;
      }
    }
    if (best < 0) break;
    usedCircles.add(best);
    assignments.push({ circleIndex: best, cell });
  }

  const surplus = circleStarts
    .filter((cs) => !cs.phantom && !usedCircles.has(cs.index))
    .map((cs) => cs.index);
  const deficit = gridCount - assignments.length;

  return {
    centerX: 0,
    centerY: 0,
    gridN,
    gridCount,
    assemblyZoom,
    frameHalfW: scaledFrameHalfW,
    frameHalfH: scaledFrameHalfH,
    assignments,
    surplus,
    deficit,
    cells,
    CircleClass,
  };
}

function addPhantoms(sim, blob, count, CircleClass) {
  if (count <= 0) return;
  for (let i = 0; i < count; i++) {
    const c = new CircleClass(blob.index, blob.circles.length, 0, 0, 0.5, 9000 + i);
    c.x = blob.centerX;
    c.y = blob.centerY;
    c.anchorX = blob.centerX;
    c.anchorY = blob.centerY;
    c.baseRadius = blob.circles[0]?.baseRadius ?? 50;
    c.radius = c.baseRadius;
    c.mosaicOpacity = 0;
    c.shapeBlend = 0;
    c.tileHalfW = c.radius;
    c.tileHalfH = c.radius;
    c.cornerRadius = c.radius;
    const fr = captureCircleFromRects(c, blob);
    c.dstMinX = fr.dstMinX;
    c.dstMinY = fr.dstMinY;
    c.dstMaxX = fr.dstMaxX;
    c.dstMaxY = fr.dstMaxY;
    c.srcUvMinX = fr.srcUvMinX;
    c.srcUvMinY = fr.srcUvMinY;
    c.srcUvMaxX = fr.srcUvMaxX;
    c.srcUvMaxY = fr.srcUvMaxY;
    c.isMosaicPhantom = true;
    blob.circles.push(c);
  }
  sim.mosaicPhantoms = (sim.mosaicPhantoms || 0) + count;
  sim.collectCircles();
}

function removePhantoms(sim, blob) {
  const n = sim.mosaicPhantoms || 0;
  if (n <= 0) return;
  blob.circles.splice(blob.circles.length - n, n);
  sim.mosaicPhantoms = 0;
  sim.collectCircles();
}

/** @param {import('./blob.js').BlobSim} sim @param {number} index @param {typeof import('./blob.js').Circle} CircleClass */
export function beginMosaicTransition(sim, index, CircleClass) {
  const blob = sim.blobs[index];
  if (!blob) return;

  sim.mosaicRest = captureMosaicPose(blob);
  sim.mosaicMorphFrom = captureMosaicPose(blob);
  sim.mosaicTarget = null;
  sim.mosaicZoomFrom = 1;
  sim.mosaicZoomTo = 1;
  sim.mosaicZoom = 1;
  sim.mosaicMerge = 0;
  sim.mosaicVideoReady = false;
  sim.mosaicPhantoms = 0;
  sim.mosaicGridN = 0;
  sim._CircleClass = CircleClass;

  for (const c of blob.circles) {
    c.mosaicOpacity = 1;
    c.shapeBlend = 0;
    c.tileHalfW = c.radius;
    c.tileHalfH = c.radius;
    c.cornerRadius = c.radius;
    const fr = captureCircleFromRects(c, blob);
    c.dstMinX = fr.dstMinX;
    c.dstMinY = fr.dstMinY;
    c.dstMaxX = fr.dstMaxX;
    c.dstMaxY = fr.dstMaxY;
    c.srcUvMinX = fr.srcUvMinX;
    c.srcUvMinY = fr.srcUvMinY;
    c.srcUvMaxX = fr.srcUvMaxX;
    c.srcUvMaxY = fr.srcUvMaxY;
  }
}

function markMosaicRetarget(sim, blob) {
  if (!sim.paramTransitioning) return;
  sim.mosaicMorphFrom = captureMosaicPose(blob);
  sim.mosaicZoomFrom = sim.mosaicZoom;
}

/**
 * @param {import('./blob.js').BlobSim} sim
 * @param {number} index
 * @param {number} videoW
 * @param {number} videoH
 */
export function applyMosaicVideoAspect(sim, index, videoW, videoH) {
  if (sim.paramTargetIndex !== index && sim.selectedIndex !== index) return;
  const blob = sim.blobs[index];
  if (!blob || !videoW || !videoH) return;

  const CircleClass = sim._CircleClass;
  if (!CircleClass) return;

  const prevW = sim.mosaicVideoW || 0;
  const prevH = sim.mosaicVideoH || 0;
  const naturalCount = blob.circles.length - (sim.mosaicPhantoms || 0);
  const gridCount = nearestSquareGrid(naturalCount).gridCount;

  if (
    sim.mosaicVideoReady &&
    prevW === videoW &&
    prevH === videoH &&
    sim.paramTargetIndex === index &&
    sim.mosaicTarget?.gridCount === gridCount
  ) {
    return;
  }

  const targetChanged =
    prevW !== videoW ||
    prevH !== videoH ||
    !sim.mosaicVideoReady ||
    sim.mosaicTarget?.gridCount !== gridCount;

  if (targetChanged) {
    markMosaicRetarget(sim, blob);
    removePhantoms(sim, blob);
  }

  let target = computeMosaicTarget(sim, blob, videoW, videoH, CircleClass);
  if (target.deficit > 0) {
    addPhantoms(sim, blob, target.deficit, CircleClass);
    target = computeMosaicTarget(sim, blob, videoW, videoH, CircleClass);
  }

  sim.mosaicTarget = target;
  sim.mosaicVideoW = videoW;
  sim.mosaicVideoH = videoH;
  sim.mosaicZoomTo = target.assemblyZoom;
  sim.mosaicVideoReady = true;
  sim.mosaicGridN = target.gridN;
  blob.mosaicFrameHalfW = target.frameHalfW;
  blob.mosaicFrameHalfH = target.frameHalfH;

  if (sim.paramTransitioning && sim.paramTargetIndex === index) {
    const from = sim.mosaicMorphFrom || sim.mosaicRest;
    if (from) {
      applyMosaicPose(blob, from);
    }
  }
}

function choreoEase(t, lead) {
  return easeTransition(clamp01(t / Math.max(lead, 0.05)));
}

/** Per-circle local progress with centre-outward stagger. */
function circleProgress(globalT, stagger, kind) {
  const s = stagger * PARAMS.mosaicStagger;
  if (kind === "morph") {
    return easeTransition(clamp01((globalT - s * 0.06) / 0.55));
  }
  if (kind === "move") {
    return easeTransition(clamp01((globalT - 0.06 - s * 0.14) / 0.72));
  }
  return easeTransition(clamp01((globalT - 0.12 - s * 0.04) / 0.88));
}

/**
 * @param {import('./blob.js').Blob} blob
 * @param {ReturnType<typeof captureMosaicPose>} from
 * @param {ReturnType<typeof computeMosaicTarget>} target
 * @param {number} globalT eased 0..1
 * @param {boolean} assembling
 */
function applyMosaicFrame(blob, from, target, globalT, assembling, layoutScale = 1) {
  const t = assembling ? globalT : 1 - globalT;
  const mergeT = choreoEase(t, 0.65);
  const cornerT = choreoEase(t, 0.5);

  const moveCenterP = circleProgress(t, 0, "move");
  blob.centerX = lerp(from.centerX, target.centerX, moveCenterP);
  blob.centerY = lerp(from.centerY, target.centerY, moveCenterP);

  const assigned = new Map(
    target.assignments.map((a) => [a.circleIndex, a.cell]),
  );
  const surplusSet = new Set(target.surplus);
  const phantomStart = from.circles.length - (target.deficit || 0);

  for (let i = 0; i < blob.circles.length; i++) {
    const c = blob.circles[i];
    const f = from.circles[i];
    if (!f) continue;

    const cell = assigned.get(i);
    const isSurplus = surplusSet.has(i);
    const isPhantom = c.isMosaicPhantom || i >= phantomStart;
    const stagger = cell?.stagger ?? 1;

    const morphP = circleProgress(t, stagger, "morph");
    const moveP = circleProgress(t, stagger, "move");
    const growP = circleProgress(t, stagger, "scale");

    if (isSurplus) {
      c.mosaicOpacity = lerp(1, 0, morphP);
    } else if (isPhantom) {
      c.mosaicOpacity = lerp(0, 1, morphP);
    } else {
      c.mosaicOpacity = 1;
    }

    if (!cell) {
      c.shapeBlend = lerp(f.shapeBlend, 0, assembling ? morphP : 1 - morphP);
      c.x = f.x;
      c.y = f.y;
      c.radius = lerp(f.radius, 0, morphP);
      continue;
    }

    const toWx = target.centerX + cell.cx;
    const toWy = target.centerY + cell.cy;
    c.x = lerp(f.x, toWx, moveP);
    c.y = lerp(f.y, toWy, moveP);
    c.localX = c.x - blob.centerX;
    c.localY = c.y - blob.centerY;

    c.shapeBlend = morphP;
    c.cornerRadius = lerp(f.cornerRadius, PARAMS.mosaicCornerMin, cornerT);

    const fromHalfW = f.tileHalfW || f.radius;
    const fromHalfH = f.tileHalfH || f.radius;
    const seam =
      PARAMS.mosaicSeamOverlap / Math.max(layoutScale || 1, 1e-6);
    const halfW = cell.tileHalfW + seam * growP;
    const halfH = cell.tileHalfH + seam * growP;
    c.tileHalfW = lerp(fromHalfW, halfW, growP);
    c.tileHalfH = lerp(fromHalfH, halfH, growP);
    c.radius = Math.max(c.tileHalfW, c.tileHalfH);

    c.dstMinX = lerp(f.dstMinX, toWx - halfW, moveP);
    c.dstMinY = lerp(f.dstMinY, toWy - halfH, moveP);
    c.dstMaxX = lerp(f.dstMaxX, toWx + halfW, moveP);
    c.dstMaxY = lerp(f.dstMaxY, toWy + halfH, moveP);

    c.srcUvMinX = lerp(f.srcUvMinX, cell.srcUvMinX, morphP);
    c.srcUvMinY = lerp(f.srcUvMinY, cell.srcUvMinY, morphP);
    c.srcUvMaxX = lerp(f.srcUvMaxX, cell.srcUvMaxX, morphP);
    c.srcUvMaxY = lerp(f.srcUvMaxY, cell.srcUvMaxY, morphP);

    c.anchorX = c.x;
    c.anchorY = c.y;
    c.vx = 0;
    c.vy = 0;
  }

  blob.mosaicMerge = mergeT;
  blob.updateBounds();
  return circleProgress(t, 0, "scale");
}

/** @param {import('./blob.js').BlobSim} sim @param {number} dt */
export function updateMosaicTransition(sim, dt) {
  if (!sim.paramTransitioning) return;

  sim.paramT += dt / Math.max(PARAMS.transitionSeconds, 0.05);
  const done = sim.paramT >= 1;
  if (done) sim.paramT = 1;

  const ease = easeTransition(sim.paramT);
  const growIndex = sim.paramTargetIndex;

  if (growIndex >= 0 && sim.mosaicRest && sim.mosaicTarget) {
    const blob = sim.blobs[growIndex];
    if (blob) {
      const from = sim.mosaicMorphFrom || sim.mosaicRest;
      const scaleT = applyMosaicFrame(
        blob,
        from,
        sim.mosaicTarget,
        ease,
        true,
        sim.view.layoutScale,
      );
      sim.mosaicZoom = lerp(sim.mosaicZoomFrom, sim.mosaicZoomTo, scaleT);
      sim.mosaicMerge = blob.mosaicMerge;
    }
  } else if (growIndex < 0 && sim.mosaicRest) {
    const blob = sim.blobs[sim.selectedIndex];
    if (!blob) return;
    const fromPose = sim.mosaicActive?.pose ?? captureMosaicPose(blob);
    const fromZoom = sim.mosaicActive?.zoom ?? sim.mosaicZoom;
    const fromMerge = sim.mosaicActive?.merge ?? sim.mosaicMerge;
    const target = sim.mosaicTarget;
    if (target) {
      const scaleT = applyMosaicFrame(
        blob,
        fromPose,
        target,
        ease,
        false,
        sim.view.layoutScale,
      );
      sim.mosaicZoom = lerp(fromZoom, sim.mosaicZoomFrom, scaleT);
      sim.mosaicMerge = lerp(fromMerge, 0, ease);
      blob.mosaicMerge = sim.mosaicMerge;
    }
    if (done) {
      applyMosaicPose(blob, sim.mosaicRest);
      removePhantoms(sim, blob);
      blob.mosaicFrameHalfW = 0;
      blob.mosaicFrameHalfH = 0;
      sim.mosaicZoom = 1;
      sim.mosaicMerge = 0;
      blob.mosaicMerge = 0;
      sim.mosaicActive = null;
    }
  }

  if (!done) return;

  if (growIndex >= 0) {
    const blob = sim.blobs[growIndex];
    if (blob) {
      sim.mosaicActive = {
        pose: captureMosaicPose(blob),
        zoom: sim.mosaicZoomTo,
        merge: 1,
      };
      sim.mosaicMorphFrom = null;
      blob.mosaicMerge = 1;
      sim.mosaicMerge = 1;
    }
  }
}

export function isMosaicTransitioning(sim, index) {
  if (!sim.paramTransitioning) return false;
  if (sim.paramTargetIndex === index) return true;
  if (sim.paramTargetIndex < 0 && sim.selectedIndex === index) return true;
  return false;
}

export function isMosaicSelected(sim, index) {
  return (
    sim.selectedIndex === index &&
    sim.paramTargetIndex >= 0 &&
    !sim.paramTransitioning &&
    PARAMS.displaceAmount < 0.01
  );
}

/** @param {import('./blob.js').BlobSim} sim */
export function resetMosaic(sim) {
  const idx = sim.selectedIndex;
  if (idx >= 0) {
    const blob = sim.blobs[idx];
    if (blob && sim.mosaicRest) {
      applyMosaicPose(blob, sim.mosaicRest);
    }
    removePhantoms(sim, blob);
  }
  sim.mosaicRest = null;
  sim.mosaicMorphFrom = null;
  sim.mosaicTarget = null;
  sim.mosaicActive = null;
  sim.mosaicZoom = 1;
  sim.mosaicZoomFrom = 1;
  sim.mosaicZoomTo = 1;
  sim.mosaicMerge = 0;
  sim.mosaicVideoReady = false;
  sim.mosaicVideoW = 0;
  sim.mosaicVideoH = 0;
  sim.mosaicGridN = 0;
  for (const blob of sim.blobs) {
    blob.mosaicMerge = 0;
    blob.mosaicFrameHalfW = 0;
    blob.mosaicFrameHalfH = 0;
    for (const c of blob.circles) {
      c.mosaicOpacity = 1;
      c.shapeBlend = 0;
      c.tileHalfW = c.radius;
      c.tileHalfH = c.radius;
      c.cornerRadius = c.radius;
    }
  }
}
