/**
 * Canvas narrative text as a field of soft circles with anchor physics.
 * Particles are sampled from rendered glyphs and mutually repel blob circles.
 */

import { PARAMS } from "./uniforms.js";

/**
 * @typedef {{
 *   x: number, y: number, vx: number, vy: number, fx: number, fy: number,
 *   anchorX: number, anchorY: number, restLocalX: number, restLocalY: number,
 *   radius: number,
 * }} TextParticle
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 */
function wrapParagraph(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {string[]} paragraphs
 * @param {number} blockWidthCss
 */
function sampleTextParticles(paragraphs, blockWidthCss) {
  const fontSize = PARAMS.scrollTextFontSize;
  const lineHeight = fontSize * PARAMS.scrollTextLineHeight;
  const padX = PARAMS.scrollTextPadX;
  const padY = PARAMS.scrollTextPadY;
  const step = Math.max(PARAMS.scrollTextSampleStep, 2);
  const radius = PARAMS.scrollTextParticleRadius;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return [];
  measure.font = `${fontSize}px ${PARAMS.scrollTextFontFamily}`;

  const innerW = blockWidthCss - padX * 2;
  const allLines = [];
  for (const para of paragraphs) {
    const lines = wrapParagraph(measure, para, innerW);
    if (lines.length) allLines.push(...lines);
    allLines.push("");
  }
  while (allLines.length && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }

  const blockH = padY * 2 + allLines.length * lineHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(blockWidthCss);
  canvas.height = Math.ceil(blockH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  ctx.font = `${fontSize}px ${PARAMS.scrollTextFontFamily}`;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  let y = padY;
  for (const line of allLines) {
    if (line) ctx.fillText(line, padX, y);
    y += lineHeight;
  }

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cx = width * 0.5;
  const cy = height * 0.5;
  /** @type {TextParticle[]} */
  const particles = [];

  for (let py = 0; py < height; py += step) {
    for (let px = 0; px < width; px += step) {
      const i = (py * width + px) * 4;
      if (data[i + 3] < 48) continue;
      const localX = px - cx;
      const localY = cy - py;
      particles.push({
        x: localX,
        y: localY,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        anchorX: localX,
        anchorY: localY,
        restLocalX: localX,
        restLocalY: localY,
        radius,
      });
    }
  }

  return particles;
}

/**
 * Block centre in layout space (origin canvas centre, +y up).
 *
 * @param {import('./blob.js').BlobSim['view']} view
 * @param {number} scrollProgress
 * @param {number} layoutScale
 */
export function computeTextBlockCenter(view, scrollProgress, layoutScale) {
  const scale = Math.max(layoutScale, 1e-6);
  const textH = PARAMS.scrollTextHeight / scale;
  const rise = scrollProgress * (view.halfH * 2 + textH);
  const bottom = -view.halfH - textH + rise;
  return { centerX: 0, centerY: bottom + textH * 0.5, textH };
}

/**
 * @param {string[]} paragraphs
 */
export function createNarrativeText(paragraphs) {
  /** @type {string[]} */
  const copy = [...paragraphs];
  /** @type {TextParticle[]} */
  let particles = [];
  let blockWidthCss = 608;
  let layoutScale = 1;
  let visible = false;
  let opacity = 0;

  function rebuild(blockWidth, scale) {
    blockWidthCss = blockWidth;
    layoutScale = Math.max(scale, 1e-6);
    const sampled = sampleTextParticles(copy, blockWidthCss);
    particles = sampled.map((p) => {
      const restLocalX = p.restLocalX / layoutScale;
      const restLocalY = p.restLocalY / layoutScale;
      const radius = PARAMS.scrollTextParticleRadius / layoutScale;
      return {
        x: restLocalX,
        y: restLocalY,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        anchorX: restLocalX,
        anchorY: restLocalY,
        restLocalX,
        restLocalY,
        radius,
      };
    });
  }

  rebuild(blockWidthCss, 1);

  return {
    get particles() {
      return particles;
    },
    get opacity() {
      return opacity;
    },
    setVisible(active) {
      visible = active;
      if (!active) opacity = 0;
    },
    setOpacity(value) {
      opacity = Math.max(0, Math.min(1, value));
    },
    rebuildForViewport(view, scale) {
      const cssW = Math.min(
        PARAMS.scrollTextMaxWidthCss,
        view.halfW * 2 * scale * PARAMS.scrollTextWidthFraction,
      );
      if (Math.abs(cssW - blockWidthCss) > 2 || Math.abs(scale - layoutScale) > 0.01) {
        rebuild(cssW, scale);
      }
    },
    reset() {
      for (const p of particles) {
        p.x = p.restLocalX;
        p.y = p.restLocalY;
        p.vx = p.vy = p.fx = p.fy = 0;
      }
      opacity = 0;
      visible = false;
    },
    /**
     * @param {import('./blob.js').BlobSim} sim
     */
    updateAnchors(sim) {
      const { centerX, centerY } = computeTextBlockCenter(
        sim.view,
        sim.scrollProgress,
        sim.view.layoutScale,
      );
      const snap = sim.scrollProgress < 0.001 && sim.scrollTarget < 0.001;
      for (const p of particles) {
        p.anchorX = centerX + p.restLocalX;
        p.anchorY = centerY + p.restLocalY;
        if (snap) {
          p.x = p.anchorX;
          p.y = p.anchorY;
          p.vx = 0;
          p.vy = 0;
        }
      }
    },
    /** Anchor springs before mutual forces. */
    applyAnchorForces() {
      for (const p of particles) {
        p.fx = 0;
        p.fy = 0;
      }
      const k = PARAMS.scrollTextAnchorStiffness;
      for (const p of particles) {
        p.fx += -k * (p.x - p.anchorX);
        p.fy += -k * (p.y - p.anchorY);
      }
    },
    applySelfRepulsion() {
      const overlap = PARAMS.scrollTextSelfOverlap;
      const strength = PARAMS.scrollTextSelfRepulsion;
      const n = particles.length;
      for (let i = 0; i < n; i++) {
        const a = particles[i];
        for (let j = i + 1; j < n; j++) {
          const b = particles[j];
          pushMutual(a, b, overlap, strength);
        }
      }
    },
    /**
     * @param {import('./blob.js').BlobSim['view']} view
     * @param {number} dt
     */
    integrate(view, dt) {
      const damping = PARAMS.scrollTextDamping;
      const maxSpeed = PARAMS.scrollTextMaxSpeed;
      for (const p of particles) {
        p.vx = (p.vx + p.fx * dt) * damping;
        p.vy = (p.vy + p.fy * dt) * damping;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > maxSpeed) {
          const s = maxSpeed / speed;
          p.vx *= s;
          p.vy *= s;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.fx = 0;
        p.fy = 0;
      }
    },
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {DOMRect} containerRect
     * @param {import('./blob.js').BlobSim['view']} view
     * @param {number} scale
     * @param {number} focusZoom
     * @param {number} scrollProgress
     */
    draw(canvas, containerRect, view, scale, focusZoom, scrollProgress) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = containerRect.width;
      const h = containerRect.height;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!visible || opacity < 0.01 || particles.length === 0) return;

      const zoom = Math.max(focusZoom, 1);
      const cx = w * 0.5;
      const cy = h * 0.5;
      const toScreen = (lx, ly) => ({
        x: cx + (lx / zoom) * scale,
        y: cy - (ly / zoom) * scale,
      });

      const { centerX, centerY, textH } = computeTextBlockCenter(
        view,
        scrollProgress,
        scale,
      );
      const halfW = (blockWidthCss / scale) * 0.5;
      const halfH = textH * 0.5;
      const pad = 10 / scale;

      const tl = toScreen(centerX - halfW - pad, centerY + halfH + pad * 0.5);
      const br = toScreen(centerX + halfW + pad, centerY - halfH - pad * 0.25);
      const panelW = br.x - tl.x;
      const panelH = br.y - tl.y;

      ctx.save();
      ctx.globalAlpha = opacity * 0.94;
      ctx.fillStyle = "rgba(219, 219, 219, 0.94)";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(tl.x, tl.y, panelW, panelH, [2, 2, 0, 0]);
      } else {
        ctx.rect(tl.x, tl.y, panelW, panelH);
      }
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = PARAMS.scrollTextColor;
      for (const p of particles) {
        const { x: px, y: py } = toScreen(p.x, p.y);
        const r = (p.radius / zoom) * scale;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(r, 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/**
 * @param {{ x: number, y: number, radius: number, fx: number, fy: number }} a
 * @param {{ x: number, y: number, radius: number, fx: number, fy: number }} b
 */
export function pushMutual(a, b, overlapTarget, strength) {
  if (strength <= 0) return;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-4) {
    dx = (Math.random() - 0.5) * 1e-2;
    dy = (Math.random() - 0.5) * 1e-2;
    dist = Math.hypot(dx, dy) || 1e-4;
  }
  const min = (a.radius + b.radius) * overlapTarget;
  if (dist >= min) return;
  const push = strength * (min - dist);
  const ux = dx / dist;
  const uy = dy / dist;
  a.fx -= push * ux;
  a.fy -= push * uy;
  b.fx += push * ux;
  b.fy += push * uy;
}
