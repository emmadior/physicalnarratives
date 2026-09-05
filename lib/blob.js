/**
 * CPU side of the effect.
 *
 * A `Blob` is a group of circles that share a video and a common drift — nothing
 * more. It is *not* a separate shape: every circle in the scene, whichever blob
 * it belongs to, contributes to one shared metaball field in the shader. Two
 * blobs that touch therefore merge with exactly the same soft necks that circles
 * inside one blob already form, and their videos cross-fade over the merged
 * region. This file only has to keep the circle arrays honest.
 *
 * Coordinate space: layout pixels, origin at the canvas centre, +y up. The sim
 * is resolution independent; main.js scales the output to CSS pixels.
 */

import { createNoise2D } from "simplex-noise";
import { PARAMS, MAX_PER_BLOB, METABALL_VISIBLE_FRACTION } from "./uniforms.js";
import {
  captureLiveParams,
  computeBlendTarget,
  updateParamTransition,
  SELECTED_OVERLAP,
  SELECTED_REPULSION,
} from "./selection-params.js";
import {
  applyFocusVideoAspect,
  beginFocusTransition,
  blendFocusPose,
  captureFocusPose,
  syncCircleLocalsFromWorld,
  beginFocusSettle,
  updateFocusSettle,
  focusSettleEase,
  isFocusSettling,
  containFocusAspect,
  containFocusVideoFrame,
  isFocusSelected,
  isFocusTransitioning,
  resetFocus,
} from "./selection-focus.js";
import {
  beginExit,
  beginReturnWait,
  isMotionLocked,
  retargetAwayPositions,
  updateExitMotion,
} from "./blob-exit.js";
import {
  applyBreakerConstraints,
  applyBreakerForces,
  breakerOverlap,
  linkCrossesBreaker,
  pinFocusAnchors,
  resetScroll,
  updateBreaker,
  updateScrollProgress,
} from "./scroll-breaker.js";

/** Fixed physics timestep. Behaviour is identical at 30, 60 or 144 fps. */
const FIXED_DT = 1 / 60;
/** Never simulate more than this much wall time in one frame (tab stalls). */
const MAX_FRAME_DT = 0.25;

/** Golden angle: gives an even, non-lattice spiral fill. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Cluster half-extent as a multiple of the blob's largest radius. Deliberately
 * small: the circles have to sit well inside each other's influence for the
 * field to fuse into one mass instead of a ring of separate bumps.
 */
const CLUSTER_K = 1.35;

/**
 * Sites of the dominant lobes, in units of the cluster half-extents. An evenly
 * filled ellipse of circles reads as a puffy cloud: every circle owns an equal
 * share of the outline, so the silhouette is a ring of same-sized bumps.
 * Organising the anchors around a few big lobes instead gives the mass a handful
 * of large arcs joined by necks, with the small circles buried as bulges — which
 * is what reads as liquid metal.
 */
const LOBE_SITES = [
  [-0.74, 0.08],
  [-0.08, -0.34],
  [0.34, 0.34],
  [0.82, -0.1],
];

/** How strongly satellites are drawn into their lobe. 0 = raw spiral, 1 = stacked. */
const LOBE_PULL = 0.5;

/**
 * Fraction of a circle's radius that actually shows up in the silhouette (the
 * metaball iso-contour sits inside the nominal radius — see KERNEL_GAIN in the
 * fragment shader). Used so edge contact happens where the blob *looks* like it
 * touches the edge.
 */
/** Iso-contour reach as a fraction of circle radius — must match the shader. */
const VISIBLE_FRACTION = METABALL_VISIBLE_FRACTION;

/** Deterministic PRNG so the layout is identical on every reload. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep01 = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Quadrant seeds for the initial scatter, so blobs never start on top of each other. */
const QUADRANTS = [
  [-0.58, -0.5],
  [0.58, -0.52],
  [-0.55, 0.54],
  [0.6, 0.5],
];

export class Circle {
  constructor(blobIndex, index, anchorX, anchorY, radiusT, seed) {
    this.blobIndex = blobIndex;
    this.index = index;

    /** Rest position in the blob's own frame. Never mutated after build. */
    this.localX = anchorX;
    this.localY = anchorY;

    /** Rest position in world space: local + the blob's drifting centre. */
    this.anchorX = anchorX;
    this.anchorY = anchorY;

    this.x = anchorX;
    this.y = anchorY;
    this.vx = 0;
    this.vy = 0;

    /**
     * Position within [minRadius, maxRadius] rather than an absolute size, so
     * dragging the radius sliders resizes existing circles without a rebuild.
     */
    this.radiusT = radiusT;
    this.baseRadius = 0; // resolved from radiusT each step
    this.radius = 0; // baseRadius * breathing

    /** Unique noise offset — without it every circle would move in lockstep. */
    this.seed = seed;

    // Optional per-circle transform of the video slice (see uUseFullTransform).
    this.angle = 0;
    this.scale = 1;
  }
}

/**
 * One group of circles: a shared video, a shared drift, and a fixed frame of
 * reference the video is mapped into.
 */
export class Blob {
  constructor(index, seed) {
    this.index = index;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.noise2D = createNoise2D(mulberry32(seed ^ 0x9e3779b9));

    /** Proportions of this blob's cluster, so the four never read as clones. */
    this.aspect = lerp(1.0, 1.45, this.rng());

    this.circles = [];
    this.links = [];

    // Centre of the blob in world space; the anchors ride on it.
    this.centerX = 0;
    this.centerY = 0;
    /** Home expressed as a fraction of the free space, so resize keeps the scatter. */
    this.homeFx = 0;
    this.homeFy = 0;

    // --- lazy drift personality -------------------------------------------
    this.velX = 0;
    this.velY = 0;
    this.velFromX = 0;
    this.velFromY = 0;
    this.velToX = 0;
    this.velToY = 0;
    this.phaseTime = 0;
    // Stagger the very first phase so the four blobs can never fall into sync.
    this.phaseDur = lerp(2, 14, this.rng());
    this.easeDur = lerp(3, 6, this.rng());
    this.nudgeIn = lerp(1, 6, this.rng());

    /** 0→1 blend after return fly-in; null when idle morph is fully active. */
    this.exitMotionBlend = null;

    /** Rest half-extents of the silhouette, from the rest layout. */
    this.halfW = 1;
    this.halfH = 1;
    /** Video frame half-extents (rest bbox plus padding). Fixed after build. */
    this.fitHalfW = 1;
    this.fitHalfH = 1;
    /** Rest silhouette centre in blob-local space (offset from centerX/Y). */
    this.restCenterX = 0;
    this.restCenterY = 0;

    /** Video-aspect ellipse half-axes while focused (layout units). */
    this.focusLayoutRx = 0;
    this.focusLayoutRy = 0;
    this.focusVideoHalfW = 0;
    this.focusVideoHalfH = 0;

    /** Live AABB, uploaded so the shader can skip this group per pixel. */
    this.minX = 0;
    this.minY = 0;
    this.maxX = 0;
    this.maxY = 0;

    this.centroidX = 0;
    this.centroidY = 0;
  }

  get params() {
    return PARAMS.blobs[this.index];
  }

  /** True when the video mat is pinned to the blob (not torn per-circle). */
  get videoPinned() {
    return this.params.displaceAmount < 0.01;
  }

  /** True when the pinned mat uses the video-aspect focus frame. */
  get videoFocusFramed() {
    return (
      this.videoPinned && this.focusVideoHalfW > 0 && this.focusVideoHalfH > 0
    );
  }

  /** Video frame centre and half-extents uploaded to the shader. */
  get videoFrameCenterX() {
    if (this.focusVideoHalfW > 0) return this.centerX;
    return this.centerX + this.restCenterX;
  }

  get videoFrameCenterY() {
    if (this.focusVideoHalfH > 0) return this.centerY;
    return this.centerY + this.restCenterY;
  }

  get videoFrameHalfW() {
    if (this.focusVideoHalfW > 0) return this.focusVideoHalfW;
    return this.fitHalfW;
  }

  get videoFrameHalfH() {
    if (this.focusVideoHalfH > 0) return this.focusVideoHalfH;
    return this.fitHalfH;
  }

  /** Full rebuild of the layout: circles, radii, links and the video frame. */
  build() {
    const bp = this.params;
    const rng = mulberry32(this.seed);
    const count = clamp(Math.round(bp.circleCount), 1, MAX_PER_BLOB);

    // Cluster size is derived from the radius range so the packing density —
    // and therefore how fused the mass looks — stays the same at any scale.
    const maxRadius = Math.max(bp.minRadius, bp.maxRadius);
    this.clusterRx = maxRadius * CLUSTER_K * this.aspect;
    this.clusterRy = (maxRadius * CLUSTER_K) / this.aspect;

    // Roughly one dominant lobe per five circles, at least two.
    const lobeCount = clamp(Math.round(count / 5), 2, LOBE_SITES.length);
    const lobes = LOBE_SITES.slice(0, lobeCount).map(([lx, ly]) => ({
      x: lx * this.clusterRx + (rng() - 0.5) * this.clusterRx * 0.1,
      y: ly * this.clusterRy + (rng() - 0.5) * this.clusterRy * 0.1,
      owner: -1,
      ownerDist: Infinity,
    }));

    this.circles = [];
    for (let i = 0; i < count; i++) {
      // Golden-angle spiral: sqrt() spaces the rings by equal area so the
      // cluster is evenly filled instead of dense in the middle.
      const t = (i + 0.5) / count;
      const rr = Math.sqrt(t);
      const a = i * GOLDEN_ANGLE;

      let x =
        Math.cos(a) * rr * this.clusterRx +
        (rng() - 0.5) * this.clusterRx * 0.22;
      let y =
        Math.sin(a) * rr * this.clusterRy +
        (rng() - 0.5) * this.clusterRy * 0.22;

      // Draw the point toward its nearest lobe, keeping the spiral's variety
      // but grouping the population into a few masses.
      let nearest = 0;
      let nearestDist = Infinity;
      for (let l = 0; l < lobes.length; l++) {
        const d = Math.hypot(x - lobes[l].x, y - lobes[l].y);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = l;
        }
      }
      x += (lobes[nearest].x - x) * LOBE_PULL;
      y += (lobes[nearest].y - y) * LOBE_PULL;
      const lobeDist = nearestDist * (1 - LOBE_PULL);

      // Size by distance to the lobe centre: the circle sitting on a lobe is
      // dominant, the ones hanging off it are progressively smaller so they
      // bulge the outline rather than adding another equal-sized bump.
      const radiusT = clamp(
        1 - lobeDist / (this.clusterRy * 0.95) + (rng() - 0.5) * 0.25,
        0.02,
        1,
      );

      this.circles.push(new Circle(this.index, i, x, y, radiusT, rng() * 1000));

      if (lobeDist < lobes[nearest].ownerDist) {
        lobes[nearest].ownerDist = lobeDist;
        lobes[nearest].owner = i;
      }
    }

    // Guarantee each lobe has one circle at full size, even if the spiral left
    // its closest member off-centre.
    for (const lobe of lobes) {
      if (lobe.owner >= 0) this.circles[lobe.owner].radiusT = 1;
    }

    this.resolveRadii();
    this.relaxAnchors(50, rng);
    this.buildLinks(3);
    this.measureRestFrame();

    for (const c of this.circles) {
      c.restLocalX = c.localX;
      c.restLocalY = c.localY;
      c.x = c.anchorX = c.localX + this.centerX;
      c.y = c.anchorY = c.localY + this.centerY;
      c.vx = c.vy = 0;
    }
  }

  /** Map each circle's normalised radiusT onto the current radius range. */
  resolveRadii() {
    const bp = this.params;
    const lo = Math.min(bp.minRadius, bp.maxRadius);
    const hi = Math.max(bp.minRadius, bp.maxRadius);
    for (const c of this.circles) {
      c.baseRadius = lo + (hi - lo) * c.radiusT;
      if (c.radius === 0) c.radius = c.baseRadius;
    }
  }

  /**
   * Relax a candidate focus layout inside the video-aspect ellipse.
   *
   * @param {{ localX: number, localY: number }[]} circles
   * @param {number} rx
   * @param {number} ry
   * @param {number} overlapTarget
   */
  relaxLayoutAt(circles, rx, ry, overlapTarget) {
    const savedRx = this.clusterRx;
    const savedRy = this.clusterRy;
    const savedPos = this.circles.map((c) => ({
      localX: c.localX,
      localY: c.localY,
    }));

    this.clusterRx = rx;
    this.clusterRy = ry;
    for (let i = 0; i < this.circles.length; i++) {
      this.circles[i].localX = circles[i].localX;
      this.circles[i].localY = circles[i].localY;
    }
    this.resolveRadii();
    this.relaxAnchors(48, () => 0.5, overlapTarget);
    const out = this.circles.map((c) => ({
      localX: c.localX,
      localY: c.localY,
    }));

    for (let i = 0; i < this.circles.length; i++) {
      this.circles[i].localX = savedPos[i].localX;
      this.circles[i].localY = savedPos[i].localY;
    }
    this.clusterRx = savedRx;
    this.clusterRy = savedRy;
    this.seat();
    return out;
  }

  /**
   * Push overlapping anchors apart so no two circles start stacked, while
   * gently pulling everything back inside the cluster ellipse.
   */
  relaxAnchors(iterations, rng, overlapTarget = PARAMS.overlapTarget) {
    const target = overlapTarget;
    const n = this.circles.length;

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < n; i++) {
        const a = this.circles[i];
        for (let j = i + 1; j < n; j++) {
          const b = this.circles[j];
          let dx = b.localX - a.localX;
          let dy = b.localY - a.localY;
          let dist = Math.hypot(dx, dy);
          if (dist < 1e-4) {
            const ang = rng() * Math.PI * 2;
            dx = Math.cos(ang);
            dy = Math.sin(ang);
            dist = 1e-4;
          }
          const min = (a.baseRadius + b.baseRadius) * target;
          if (dist >= min) continue;

          const push = (min - dist) * 0.5;
          const nx = (dx / dist) * push;
          const ny = (dy / dist) * push;
          a.localX -= nx;
          a.localY -= ny;
          b.localX += nx;
          b.localY += ny;
        }
      }

      // Soft containment: keep the cluster an ellipse rather than letting
      // repulsion inflate it into a disc.
      for (const c of this.circles) {
        const e = Math.hypot(
          c.localX / this.clusterRx,
          c.localY / this.clusterRy,
        );
        if (e > 1) {
          const pull = 1 + (e - 1) * 0.5;
          c.localX /= pull;
          c.localY /= pull;
        }
      }
    }
  }

  /**
   * Permanent k-nearest-neighbour graph over the anchors. Built once: rebuilding
   * per frame would let the structure re-wire and the blob would slowly fall
   * apart instead of behaving like one body. Links never cross blobs — that is
   * what keeps two merged blobs able to separate again.
   */
  buildLinks(k) {
    this.links = [];
    const seen = new Set();
    const n = this.circles.length;

    for (let i = 0; i < n; i++) {
      const a = this.circles[i];
      const others = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const b = this.circles[j];
        others.push({
          j,
          d: Math.hypot(b.localX - a.localX, b.localY - a.localY),
        });
      }
      others.sort((p, q) => p.d - q.d);

      for (let m = 0; m < Math.min(k, others.length); m++) {
        const { j, d } = others[m];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.links.push({ a: i, b: j, restLength: d });
      }
    }
  }

  /**
   * The blob's own frame of reference, measured once from the *rest* layout.
   * The video is fitted to this box and then travels with the blob, so the
   * imagery stays locked to the group while the circles tear it around. Taking
   * it from live positions instead would make the video swim and pulse.
   */
  measureRestFrame() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let symHalfW = 0;
    let symHalfH = 0;

    for (const c of this.circles) {
      const ext = c.baseRadius * VISIBLE_FRACTION;
      minX = Math.min(minX, c.localX - ext);
      maxX = Math.max(maxX, c.localX + ext);
      minY = Math.min(minY, c.localY - ext);
      maxY = Math.max(maxY, c.localY + ext);
      symHalfW = Math.max(symHalfW, Math.abs(c.localX) + ext);
      symHalfH = Math.max(symHalfH, Math.abs(c.localY) + ext);
    }

    if (!Number.isFinite(minX)) {
      minX = maxX = minY = maxY = 0;
    }

    this.restCenterX = (minX + maxX) * 0.5;
    this.restCenterY = (minY + maxY) * 0.5;

    // Symmetric extent — used for scatter, edge travel and cross-blob reach.
    // Must stay max(|local| + r), not the tight bbox half-width: an asymmetric
    // silhouette has a smaller bbox than its reach from the cluster origin,
    // which made blobs spawn too close and cross-repulsion kick in too late.
    this.halfW = symHalfW || 1;
    this.halfH = symHalfH || 1;

    const pad = PARAMS.videoFitPadding;
    this.fitHalfW = Math.max((maxX - minX) * 0.5, 1) * pad;
    this.fitHalfH = Math.max((maxY - minY) * 0.5, 1) * pad;
  }

  /** Drop every circle onto its rest position. */
  seat() {
    for (const c of this.circles) {
      c.x = c.anchorX = c.localX + this.centerX;
      c.y = c.anchorY = c.localY + this.centerY;
      c.vx = c.vy = 0;
      c.fx = 0;
      c.fy = 0;
    }
    this.updateCentroid();
    this.updateBounds();
  }

  placeAt(view, fx, fy) {
    const free = this.freeSpace(view);
    this.homeFx = clamp(fx, -1, 1);
    this.homeFy = clamp(fy, -1, 1);
    this.centerX = this.homeFx * free.x;
    this.centerY = this.homeFy * free.y;
    this.freeRef = free;
  }

  randomNudge() {
    const angle = this.rng() * Math.PI * 2;
    this.nudge(
      Math.cos(angle),
      Math.sin(angle),
      PARAMS.nudgeSpeed,
      PARAMS.nudgeSeconds,
    );
  }

  freeSpace(view) {
    const buffer =
      view.edgeBuffer != null
        ? view.edgeBuffer
        : PARAMS.edgeBuffer / Math.max(view.layoutScale || 1, 1e-6);
    return {
      x: Math.max(0, view.halfW - this.halfW - buffer),
      y: Math.max(0, view.halfH - this.halfH - buffer),
    };
  }

  /** Keep the scatter proportional when the viewport changes. */
  reposition(view) {
    const free = this.freeSpace(view);
    const ref = this.freeRef || free;
    const fx = ref.x > 0 ? this.centerX / ref.x : this.homeFx;
    const fy = ref.y > 0 ? this.centerY / ref.y : this.homeFy;
    this.centerX = clamp(fx, -1, 1) * free.x;
    this.centerY = clamp(fy, -1, 1) * free.y;
    this.freeRef = free;
  }

  bounceAxis(pos, vel, limit) {
    if (pos > limit) {
      return { pos: limit, vel: -Math.abs(vel) * 0.85 };
    }
    if (pos < -limit) {
      return { pos: -limit, vel: Math.abs(vel) * 0.85 };
    }
    return { pos, vel };
  }

  /**
   * Pick the next stretch of behaviour: either a long rest or a slow drift in a
   * new direction. Speeds are biased low (rng^2.6) so most of the time the blob
   * is barely moving, and every phase has its own random length, which is what
   * keeps the four out of sync.
   */
  nextPhase(view) {
    const rng = this.rng;
    this.velFromX = this.velX;
    this.velFromY = this.velY;
    this.phaseTime = 0;
    this.easeDur = lerp(
      PARAMS.easeSeconds * 0.7,
      PARAMS.easeSeconds * 1.6,
      rng(),
    );

    if (rng() < PARAMS.restChance) {
      this.velToX = 0;
      this.velToY = 0;
      this.phaseDur = lerp(PARAMS.restSecondsMin, PARAMS.restSecondsMax, rng());
      return;
    }

    const angle = rng() * Math.PI * 2;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);

    // Near an edge, bend the new direction back inward rather than reflecting
    // off it — a reflection would read as a bounce.
    const free = this.freeSpace(view);
    const pressX =
      free.x > 0 ? clamp(Math.abs(this.centerX) / free.x, 0, 1) : 0;
    const pressY =
      free.y > 0 ? clamp(Math.abs(this.centerY) / free.y, 0, 1) : 0;
    const bendX = smoothstep01(clamp((pressX - 0.7) / 0.3, 0, 1));
    const bendY = smoothstep01(clamp((pressY - 0.7) / 0.3, 0, 1));
    dx = lerp(dx, -Math.sign(this.centerX || 1), bendX);
    dy = lerp(dy, -Math.sign(this.centerY || 1), bendY);

    const len = Math.hypot(dx, dy) || 1;
    const speed = lerp(
      PARAMS.driftSpeedMin,
      PARAMS.driftSpeedMax,
      Math.pow(rng(), 2.6),
    );
    this.velToX = (dx / len) * speed;
    this.velToY = (dy / len) * speed;
    this.phaseDur = lerp(PARAMS.driftSecondsMin, PARAMS.driftSecondsMax, rng());
  }

  /** GUI hook: send the blob off in a direction so two can be forced together. */
  nudge(dx, dy, speed, seconds) {
    const len = Math.hypot(dx, dy) || 1;
    this.velFromX = this.velX;
    this.velFromY = this.velY;
    this.velToX = (dx / len) * speed;
    this.velToY = (dy / len) * speed;
    this.phaseTime = 0;
    this.easeDur = 1.2;
    this.phaseDur = seconds;
  }

  /**
   * Advance the drift. Approaching an edge the outward component of the
   * velocity is faded out over a slow zone, so the blob eases to a stop against
   * the boundary and lingers there instead of bouncing off it.
   */
  updateDrift(dt, view, others, survival = 1) {
    this.nudgeIn -= dt;
    if (this.nudgeIn <= 0) {
      this.randomNudge();
      this.nudgeIn = lerp(
        PARAMS.nudgeIntervalMin,
        PARAMS.nudgeIntervalMax,
        this.rng(),
      );
    }

    this.phaseTime += dt;
    const e = smoothstep01(clamp(this.phaseTime / this.easeDur, 0, 1));
    this.velX = lerp(this.velFromX, this.velToX, e);
    this.velY = lerp(this.velFromY, this.velToY, e);

    const free = this.freeSpace(view);
    this.centerX += this.velX * dt * survival;
    this.centerY += this.velY * dt * survival;

    let bx = this.bounceAxis(this.centerX, this.velX, free.x);
    let by = this.bounceAxis(this.centerY, this.velY, free.y);
    this.centerX = bx.pos;
    this.centerY = by.pos;
    if (bx.vel !== this.velX) {
      this.velX = bx.vel;
      this.velFromX = bx.vel;
      this.velToX = bx.vel;
    }
    if (by.vel !== this.velY) {
      this.velY = by.vel;
      this.velFromY = by.vel;
      this.velToY = by.vel;
    }

    if (this.phaseTime >= this.phaseDur) this.nextPhase(view);
  }

  updateCentroid() {
    let sx = 0;
    let sy = 0;
    for (const c of this.circles) {
      sx += c.x;
      sy += c.y;
    }
    const n = this.circles.length || 1;
    this.centroidX = sx / n;
    this.centroidY = sy / n;
  }

  /** Live AABB, so the shader can reject this whole group for most pixels. */
  updateBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.circles) {
      minX = Math.min(minX, c.x - c.radius);
      minY = Math.min(minY, c.y - c.radius);
      maxX = Math.max(maxX, c.x + c.radius);
      maxY = Math.max(maxY, c.y + c.radius);
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }
}

/**
 * The scene: every blob, and the forces between them. There is one field, so
 * this class exists mainly to keep the per-group bookkeeping straight and to
 * run the pairwise forces across the whole population.
 */
export class BlobSim {
  constructor() {
    this.time = 0;
    this.accumulator = 0;
    this.view = {
      halfW: 800,
      halfH: 450,
      layoutScale: 1,
      edgeBuffer: PARAMS.edgeBuffer,
    };
    this.blobs = [];
    this.allCircles = [];
    this.scattered = false;
    this.pairStride = 1;
    this.pairMix = new Float32Array(1);
    this.contactDuration = new Float32Array(1);
    this.debugPairFx = new Float32Array(1);
    this.debugPairFy = new Float32Array(1);

    this.selectedIndex = -1;
    this.paramTransitioning = false;
    this.paramT = 0;
    this.paramTargetIndex = -1;
    this.paramFrom = null;
    this.paramTo = null;
    this.restSnapshot = null;
    this.motionSnapshots = null;
    this.exitSlots = [];
    this.exitPhase = "idle";
    this.exitT = 0;
    this.returnWaitT = 0;
    this.onSelectionChange = null;

    this.focusZoom = 1;
    this.focusZoomFrom = 1;
    this.focusZoomTo = 1;
    this.focusRest = null;
    this.focusMorphFrom = null;
    this.focusTarget = null;
    this.focusActive = null;
    this.focusVideoReady = false;
    this.focusVideoW = 0;
    this.focusVideoH = 0;
    this.focusSettling = false;
    this.focusSettleT = 0;
    this.focusSettleIndex = -1;
    this.focusLinksReady = false;

    this.scrollTarget = 0;
    this.scrollProgress = 0;
    this.scrollCss = 0;
    this.breakerOpacity = 0;
    this.infoBoxCssW = 0;
    this.infoBoxCssH = 0;
    this.breaker = { x: 0, y: 0, radius: 1, halfW: 1, halfH: 1, active: 0 };

    this.build();
  }

  get selectionSettled() {
    return (
      this.selectedIndex >= 0 && !this.paramTransitioning && !this.focusSettling
    );
  }

  pairIndex(i, j) {
    return i * this.pairStride + j;
  }

  build() {
    this.blobs = [];
    for (let i = 0; i < PARAMS.blobs.length; i++) {
      const blob = new Blob(i, 0x1000 + i * 0x9e37);
      blob.build();
      this.blobs.push(blob);
    }
    this.pairStride = Math.max(1, this.blobs.length);
    const pairCount = this.pairStride * this.pairStride;
    this.pairMix = new Float32Array(pairCount);
    this.contactDuration = new Float32Array(pairCount);
    this.debugPairFx = new Float32Array(pairCount);
    this.debugPairFy = new Float32Array(pairCount);
    this.scattered = false;
    this.motionSnapshots = null;
    this.exitSlots = [];
    this.exitPhase = "idle";
    this.exitT = 0;
    this.returnWaitT = 0;
    this.collectCircles();
  }

  scatterBlobs(rng) {
    const placed = [];
    for (const blob of this.blobs) {
      let found = false;
      let bestFx = 0;
      let bestFy = 0;
      let bestSep = -Infinity;

      for (let attempt = 0; attempt < 80; attempt++) {
        const fx = (rng() * 2 - 1) * 0.95;
        const fy = (rng() * 2 - 1) * 0.95;
        blob.placeAt(this.view, fx, fy);

        let minSep = Infinity;
        for (const other of placed) {
          const dx = other.centerX - blob.centerX;
          const dy = other.centerY - blob.centerY;
          const sumW = Math.max(1, blob.halfW + other.halfW);
          const sumH = Math.max(1, blob.halfH + other.halfH);
          minSep = Math.min(minSep, Math.hypot(dx / sumW, dy / sumH));
        }

        if (placed.length === 0 || minSep >= 1.15) {
          found = true;
          break;
        }
        if (minSep > bestSep) {
          bestSep = minSep;
          bestFx = fx;
          bestFy = fy;
        }
      }

      if (!found) blob.placeAt(this.view, bestFx, bestFy);
      placed.push(blob);
    }
  }

  rebuildBlob(index) {
    const blob = this.blobs[index];
    if (!blob) return;
    blob.build();
    blob.reposition(this.view);
    blob.seat();
    this.collectCircles();
  }

  collectCircles() {
    this.allCircles = [];
    for (const blob of this.blobs) this.allCircles.push(...blob.circles);
  }

  setFocus(index) {
    if (index === -1) {
      if (this.paramTargetIndex < 0 && this.paramTransitioning) return;
      if (this.exitPhase === "waiting" || this.exitPhase === "returning")
        return;
      if (
        this.selectedIndex < 0 &&
        !this.paramTransitioning &&
        this.exitPhase === "idle"
      ) {
        return;
      }
      this.beginParamTransition(-1);
      return;
    }
    if (index < 0 || index >= this.blobs.length) return;
    if (index === this.selectedIndex && this.paramTargetIndex === index) return;
    this.beginParamTransition(index);
  }

  beginParamTransition(targetIndex) {
    const prev = this.selectedIndex;

    if (
      targetIndex >= 0 &&
      prev >= 0 &&
      prev !== targetIndex &&
      this.focusRest
    ) {
      const prevBlob = this.blobs[prev];
      if (prevBlob) {
        const from = this.focusActive?.pose ?? captureFocusPose(prevBlob);
        blendFocusPose(prevBlob, from, this.focusRest, 1);
      }
      resetFocus(this);
    }

    this.paramFrom = captureLiveParams(this);
    this.paramTo = computeBlendTarget(this, targetIndex);
    this.paramTargetIndex = targetIndex;
    this.paramT = 0;
    this.paramTransitioning = true;
    resetScroll(this);

    if (targetIndex >= 0) {
      const blob = this.blobs[targetIndex];
      blob.resolveRadii();
      blob.measureRestFrame();
      this.selectedIndex = targetIndex;
      beginFocusTransition(this, targetIndex);
      if (this.exitPhase === "returning" || this.exitPhase === "waiting") {
        this.exitPhase = "exiting";
      }
      beginExit(this, targetIndex);
      if (targetIndex !== prev) this.onSelectionChange?.(targetIndex, prev);
    } else if (prev >= 0 || this.exitPhase === "exiting") {
      if (prev >= 0) {
        const blob = this.blobs[prev];
        if (blob) {
          syncCircleLocalsFromWorld(blob);
          this.focusActive = {
            pose: captureFocusPose(blob),
            zoom: this.focusZoom,
          };
        }
        this.focusZoomFrom = 1;
      }
      if (this.exitPhase === "exiting") this.exitPhase = "away";
      this.onSelectionChange?.(-1, prev);
    }
  }

  /** @param {number} index @param {number} videoW @param {number} videoH */
  setFocusVideoAspect(index, videoW, videoH) {
    applyFocusVideoAspect(this, index, videoW, videoH);
  }

  updateSelection(dt) {
    const wasParam = this.paramTransitioning;
    const deselectIndex =
      wasParam && this.paramTargetIndex < 0 ? this.selectedIndex : -1;
    updateParamTransition(this, dt);
    updateFocusSettle(this, dt);
    if (wasParam && !this.paramTransitioning && this.paramTargetIndex < 0) {
      resetFocus(this);
      if (deselectIndex >= 0) beginFocusSettle(this, deselectIndex);
      beginReturnWait(this);
    }
    updateExitMotion(this, dt);
  }

  setViewport(halfW, halfH, layoutScale = 1) {
    this.view.halfW = halfW;
    this.view.halfH = halfH;
    this.view.layoutScale = layoutScale;
    this.view.edgeBuffer = PARAMS.edgeBuffer / Math.max(layoutScale, 1e-6);

    if (!this.scattered) {
      const scatterRng = mulberry32((Math.random() * 0xffffffff) >>> 0);
      this.scatterBlobs(scatterRng);
      for (const blob of this.blobs) blob.seat();
      this.scattered = true;
    } else {
      for (const blob of this.blobs) {
        if (isMotionLocked(this, blob.index)) continue;
        blob.reposition(this.view);
      }
      retargetAwayPositions(this);
    }
  }

  advance(frameDt) {
    this.accumulator += Math.min(frameDt, MAX_FRAME_DT);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 8) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 8) this.accumulator = 0;
  }

  warmup(n) {
    for (let i = 0; i < n; i++) this.step(FIXED_DT);
  }

  step(dt) {
    this.time += dt;
    const t = this.time;

    this.updateSelection(dt);
    this.view.edgeBuffer =
      PARAMS.edgeBuffer / Math.max(this.view.layoutScale || 1, 1e-6);

    updateScrollProgress(this, dt);
    updateBreaker(this, dt);

    for (const blob of this.blobs) {
      blob.resolveRadii();
      if (isMotionLocked(this, blob.index)) {
        // Keep breathing alive off-canvas so radius does not jump on return.
        const noise = blob.noise2D;
        for (const c of blob.circles) {
          const breath = noise(t * PARAMS.breathSpeed + c.seed * 3, 0);
          c.radius = c.baseRadius * (1 + PARAMS.breathAmount * breath);
        }
        blob.updateCentroid();
        continue;
      }
      if (blob.exitMotionBlend != null && blob.exitMotionBlend < 1) {
        const blendSec = Math.max(PARAMS.returnMotionBlendSeconds, 0.05);
        blob.exitMotionBlend = Math.min(1, blob.exitMotionBlend + dt / blendSec);
        if (blob.exitMotionBlend >= 1) blob.exitMotionBlend = null;
      }
      if (isFocusTransitioning(this, blob.index)) {
        blob.updateCentroid();
        continue;
      }
      if (
        isFocusSelected(this, blob.index) ||
        (isFocusSettling(this, blob.index) &&
          this.selectedIndex === blob.index &&
          this.paramTargetIndex >= 0)
      ) {
        blob.centerX = 0;
        blob.centerY = 0;
        blob.updateCentroid();
        continue;
      }
      const resume =
        blob.exitMotionBlend == null ? 1 : blob.exitMotionBlend;
      blob.updateDrift(dt, this.view, this.blobs, resume);
      blob.updateCentroid();
    }

    this.applyInternalForces(t, dt);
    applyBreakerForces(this);
    this.applyInterBlobForces(dt);
    this.integrate(dt);
    applyBreakerConstraints(this);

    const splitAmt = breakerOverlap(this);

    for (const blob of this.blobs) {
      const settling = isFocusSettling(this, blob.index);
      const settle = focusSettleEase(this);
      const selectedPinned =
        this.selectedIndex === blob.index && this.paramTargetIndex >= 0;

      if (isFocusSelected(this, blob.index) || (settling && selectedPinned)) {
        blob.centerX = 0;
        blob.centerY = 0;
        // Keep the original selected layout as rest so scrolling back springs
        // home instead of baking the split pose into a new rest.
        pinFocusAnchors(blob, this);
        const restAmt = settle * (1 - clamp(this.scrollProgress / 0.12, 0, 1));
        containFocusAspect(blob, restAmt * (1 - splitAmt * 0.85));
        if (restAmt > 0.01) {
          containFocusVideoFrame(blob, restAmt, false);
        }
      } else if (settling) {
        syncCircleLocalsFromWorld(blob);
      }
      blob.updateBounds();
    }
    this.updatePairMix(dt);
  }

  updatePairMix(dt) {
    const n = this.blobs.length;
    const rate = 1 / Math.max(PARAMS.flowMixSeconds, 0.05);
    const touch = PARAMS.contactOverlap + 0.15;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.blobs[i];
        const b = this.blobs[j];
        const dx = b.centerX - a.centerX;
        const dy = b.centerY - a.centerY;
        const sumW = Math.max(1, a.halfW + b.halfW);
        const sumH = Math.max(1, a.halfH + b.halfH);
        const sep = Math.hypot(dx / sumW, dy / sumH);
        const target = sep < touch ? 1 : 0;
        const idx = this.pairIndex(i, j);
        const cur = this.pairMix[idx];
        const next = cur + (target - cur) * Math.min(1, rate * dt);
        this.pairMix[idx] = next;
        this.pairMix[this.pairIndex(j, i)] = next;
      }
    }
  }

  /** Per-blob forces: wander, anchors, cohesion, links and self-repulsion. */
  applyInternalForces(t, dt) {
    for (const blob of this.blobs) {
      if (isMotionLocked(this, blob.index)) continue;

      const circles = blob.circles;
      const n = circles.length;
      const settling = isFocusSettling(this, blob.index);
      const settle = focusSettleEase(this);
      const selectedPinned =
        this.selectedIndex === blob.index && this.paramTargetIndex >= 0;
      const focused =
        isFocusSelected(this, blob.index) ||
        settling ||
        (this.selectedIndex === blob.index && this.selectionSettled);
      const splitting =
        focused && selectedPinned && this.breaker && this.breaker.active > 0.01;
      const splitAmt = splitting ? breakerOverlap(this) : 0;
      const motion =
        (focused
          ? PARAMS.focusMotionSurvival * (settling ? settle : 1)
          : 1) *
        (blob.exitMotionBlend == null ? 1 : blob.exitMotionBlend);
      const resume = blob.exitMotionBlend == null ? 1 : blob.exitMotionBlend;
      const selfOverlap = focused ? SELECTED_OVERLAP : PARAMS.overlapTarget;
      const selfRepulsion =
        (focused ? SELECTED_REPULSION : PARAMS.repulsion) *
        (settling ? settle : 1) *
        resume;
      const anchorK =
        (focused
          ? PARAMS.anchorStiffness * PARAMS.focusAnchorStiffness
          : PARAMS.anchorStiffness) *
        (1 - splitAmt * 0.4);
      const cohesionK =
        (focused ? PARAMS.cohesion * PARAMS.focusCohesion : PARAMS.cohesion) *
        (1 - splitAmt * 0.92) *
        resume;
      const linkK =
        PARAMS.linkStiffness *
        (settling ? settle : 1) *
        (1 - splitAmt * 0.55) *
        resume;

      if (isFocusTransitioning(this, blob.index)) {
        const noise = blob.noise2D;
        for (let i = 0; i < n; i++) {
          const c = circles[i];
          c.anchorX = c.localX + blob.centerX;
          c.anchorY = c.localY + blob.centerY;
          c.x = c.anchorX;
          c.y = c.anchorY;
          c.vx = 0;
          c.vy = 0;
          c.fx = 0;
          c.fy = 0;
          const breath = noise(t * PARAMS.breathSpeed + c.seed * 3, 0);
          c.radius = c.baseRadius * (1 + PARAMS.breathAmount * motion * breath);
        }
        continue;
      }

      const noise = blob.noise2D;

      for (let i = 0; i < n; i++) {
        const c = circles[i];
        c.anchorX = c.localX + blob.centerX;
        c.anchorY = c.localY + blob.centerY;
        c.fx = 0;
        c.fy = 0;

        // --- noise wander: two decorrelated walks through a 2D field --------
        const nt = t * PARAMS.noiseSpeed;
        c.fx += PARAMS.noiseStrength * motion * noise(nt + c.seed, 0);
        c.fy += PARAMS.noiseStrength * motion * noise(0, nt + c.seed + 100);

        // --- anchor spring: resting silhouette, and it carries the drift ----
        c.fx += -anchorK * (c.x - c.anchorX);
        c.fy += -anchorK * (c.y - c.anchorY);

        // --- cohesion: weak magnetism toward this blob's centre of mass -----
        c.fx += cohesionK * motion * (blob.centroidX - c.x);
        c.fy += cohesionK * motion * (blob.centroidY - c.y);

        // --- breathing -------------------------------------------------------
        const breath = noise(t * PARAMS.breathSpeed + c.seed * 3, 0);
        c.radius = c.baseRadius * (1 + PARAMS.breathAmount * motion * breath);

        // --- optional slow rotation / scale of this circle's video slice -----
        if (PARAMS.useFullTransform) {
          c.angle =
            PARAMS.transformAngle *
            noise(t * PARAMS.noiseSpeed * 0.5 + c.seed * 7, 3.7);
          c.scale =
            1 +
            PARAMS.transformScale *
              noise(t * PARAMS.noiseSpeed * 0.4 + c.seed * 11, -2.3);
        } else {
          c.angle = 0;
          c.scale = 1;
        }
      }

      // --- neighbour link springs -------------------------------------------
      const breaker = splitting ? this.breaker : null;
      for (const link of blob.links) {
        const a = circles[link.a];
        const b = circles[link.b];
        if (!a || !b) continue;
        if (breaker && splitAmt > 0.04 && linkCrossesBreaker(a, b, breaker)) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-4;
        const f = linkK * (dist - link.restLength);
        const ux = dx / dist;
        const uy = dy / dist;
        a.fx += f * ux;
        a.fy += f * uy;
        b.fx -= f * ux;
        b.fy -= f * uy;
      }

      // --- self-repulsion: keeps the silhouette lumpy, not a round mass ------
      for (let i = 0; i < n; i++) {
        const a = circles[i];
        for (let j = i + 1; j < n; j++) {
          const b = circles[j];
          pushApart(a, b, selfOverlap, selfRepulsion);
        }
      }
    }
  }

  /**
   * Cross-blob repulsion plus a separation bias that ramps while two blobs stay
   * merged, so contacts end on their own. Records net pair forces for debug.
   */
  applyInterBlobForces(dt) {
    this.debugPairFx.fill(0);
    this.debugPairFy.fill(0);

    const blobs = this.blobs;
    const touchNorm = PARAMS.contactOverlap + 0.15;

    for (let bi = 0; bi < blobs.length; bi++) {
      for (let bj = bi + 1; bj < blobs.length; bj++) {
        const a = blobs[bi];
        const b = blobs[bj];
        if (isMotionLocked(this, bi) || isMotionLocked(this, bj)) continue;
        const idx = this.pairIndex(bi, bj);
        const resumeA = a.exitMotionBlend == null ? 1 : a.exitMotionBlend;
        const resumeB = b.exitMotionBlend == null ? 1 : b.exitMotionBlend;
        const pairResume = Math.min(resumeA, resumeB);
        if (pairResume < 0.001) continue;

        const gdx = b.centerX - a.centerX;
        const gdy = b.centerY - a.centerY;
        const sumW = Math.max(1, a.halfW + b.halfW);
        const sumH = Math.max(1, a.halfH + b.halfH);
        const sepNorm = Math.hypot(gdx / sumW, gdy / sumH);
        const inContact = sepNorm < touchNorm;

        if (inContact) {
          this.contactDuration[idx] += dt;
        } else {
          this.contactDuration[idx] = 0;
        }

        let pairFx = 0;
        let pairFy = 0;

        const reach = (a.halfW + b.halfW) * 1.35;
        const reachY = (a.halfH + b.halfH) * 1.35;
        if (Math.abs(gdx) <= reach && Math.abs(gdy) <= reachY) {
          for (const ca of a.circles) {
            for (const cb of b.circles) {
              const bfx = ca.fx;
              const bfy = ca.fy;
              pushApart(
                ca,
                cb,
                PARAMS.crossOverlapTarget,
                PARAMS.crossRepulsion * pairResume,
              );
              pairFx += ca.fx - bfx;
              pairFy += ca.fy - bfy;
            }
          }
        }

        if (inContact && PARAMS.contactSeparationBias > 0) {
          const ramp = Math.min(
            1,
            this.contactDuration[idx] /
              Math.max(PARAMS.contactSeparationRamp, 0.05),
          );
          const bias = PARAMS.contactSeparationBias * ramp * pairResume;
          const dist = Math.hypot(gdx, gdy) || 1e-4;
          const ux = gdx / dist;
          const uy = gdy / dist;
          const sepFx = -bias * ux;
          const sepFy = -bias * uy;

          for (const c of a.circles) {
            c.fx += sepFx;
            c.fy += sepFy;
          }
          for (const c of b.circles) {
            c.fx -= sepFx;
            c.fy -= sepFy;
          }

          pairFx += sepFx * a.circles.length;
          pairFy += sepFy * a.circles.length;
        }

        const invN = 1 / Math.max(a.circles.length, 1);
        this.debugPairFx[idx] = pairFx * invN;
        this.debugPairFy[idx] = pairFy * invN;
        this.debugPairFx[this.pairIndex(bj, bi)] = -pairFx * invN;
        this.debugPairFy[this.pairIndex(bj, bi)] = -pairFy * invN;
      }
    }
  }

  integrate(dt) {
    const view = this.view;
    for (const blob of this.blobs) {
      if (
        isMotionLocked(this, blob.index) ||
        isFocusTransitioning(this, blob.index)
      ) {
        continue;
      }
      const overflowY = isFocusSelected(this, blob.index);
      const speedCap =
        overflowY && this.scrollProgress > 0.02
          ? PARAMS.maxSpeed * PARAMS.breakerMaxSpeedScale
          : PARAMS.maxSpeed;

      for (const c of blob.circles) {
        c.vx = (c.vx + c.fx * dt) * PARAMS.damping;
        c.vy = (c.vy + c.fy * dt) * PARAMS.damping;

        const speed = Math.hypot(c.vx, c.vy);
        if (speed > speedCap) {
          const s = speedCap / speed;
          c.vx *= s;
          c.vy *= s;
        }

        c.x += c.vx * dt;
        c.y += c.vy * dt;

        holdInside(c, view, overflowY);
      }

      if (isFocusSettling(this, blob.index)) {
        const settle = focusSettleEase(this);
        const pin = 1 - settle;
        if (pin > 0.001) {
          for (const c of blob.circles) {
            const ax = c.localX + blob.centerX;
            const ay = c.localY + blob.centerY;
            c.x = lerp(c.x, ax, pin * 0.6);
            c.y = lerp(c.y, ay, pin * 0.6);
            c.vx *= 1 - pin * 0.35;
            c.vy *= 1 - pin * 0.35;
          }
        }
        syncCircleLocalsFromWorld(blob);
      }
    }
  }
}

/** Soft one-sided repulsion between two circles, shared by both passes. */
function pushApart(a, b, overlapTarget, strength) {
  if (strength <= 0) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = (a.radius + b.radius) * overlapTarget;
  if (Math.abs(dx) > min || Math.abs(dy) > min) return;

  const dist = Math.hypot(dx, dy) || 1e-4;
  if (dist >= min) return;

  const f = strength * (min - dist);
  const ux = dx / dist;
  const uy = dy / dist;
  a.fx -= f * ux;
  a.fy -= f * uy;
  b.fx += f * ux;
  b.fy += f * uy;
}

/**
 * Hold a circle inside the canvas. This is a positional constraint with the
 * outward velocity dropped, not a spring: a spring would store the energy and
 * push back, which reads as a bounce. Holding the outermost circles while the
 * blob's cohesion keeps pulling is what flattens the silhouette against the
 * edge, and because nothing is stored it settles instead of oscillating.
 */
function holdInside(c, view, allowOverflowY = false) {
  const grip = PARAMS.edgeGrip;
  const buffer =
    view.edgeBuffer != null
      ? view.edgeBuffer
      : PARAMS.edgeBuffer / Math.max(view.layoutScale || 1, 1e-6);
  const r = c.radius * VISIBLE_FRACTION;

  const maxX = view.halfW - buffer - r;
  const maxY = view.halfH - buffer - r;

  if (c.x > maxX) {
    c.x += (maxX - c.x) * grip;
    if (c.vx > 0) c.vx = 0;
  } else if (c.x < -maxX) {
    c.x += (-maxX - c.x) * grip;
    if (c.vx < 0) c.vx = 0;
  }

  if (allowOverflowY) return;

  if (c.y > maxY) {
    c.y += (maxY - c.y) * grip;
    if (c.vy > 0) c.vy = 0;
  } else if (c.y < -maxY) {
    c.y += (-maxY - c.y) * grip;
    if (c.vy < 0) c.vy = 0;
  }
}
