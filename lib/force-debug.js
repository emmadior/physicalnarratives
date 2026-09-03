/**
 * Dev overlay: inter-blob force vectors between blob centres.
 * Green = repulsive (pushing apart), red = attractive (pulling together).
 */

import { PARAMS } from "./uniforms.js";

/**
 * @param {HTMLElement} container
 */
export function createForceDebugOverlay(container) {
  const canvas = document.createElement("canvas");
  canvas.className = "blob-force-debug";
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  /** @param {number} w @param {number} h */
  function resize(w, h) {
    if (w <= 0 || h <= 0) return;
    canvas.width = w;
    canvas.height = h;
  }

  /**
   * @param {import('./blob.js').BlobSim} sim
   * @param {number} layoutScale
   */
  function draw(sim, layoutScale) {
    if (!PARAMS.showForceDebug) {
      canvas.style.visibility = "hidden";
      return;
    }
    canvas.style.visibility = "visible";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.5;
    const blobs = sim.blobs;
    const n = blobs.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const idx = sim.pairIndex(i, j);
        const fx = sim.debugPairFx[idx];
        const fy = sim.debugPairFy[idx];
        const mag = Math.hypot(fx, fy);
        if (mag < 0.05) continue;

        const a = blobs[i];
        const b = blobs[j];
        const ax = cx + a.centerX * layoutScale;
        const ay = cy - a.centerY * layoutScale;
        const bx = cx + b.centerX * layoutScale;
        const by = cy - b.centerY * layoutScale;
        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;

        const dx = bx - ax;
        const dy = by - ay;
        const sepLen = Math.hypot(dx, dy) || 1;
        const along = (fx * dx + fy * dy) / sepLen;
        const hue = along > 0 ? 4 : 138;

        const scale = 0.35;
        const len = Math.min(140, mag * scale);
        const angle = Math.atan2(-fy, fx);

        ctx.strokeStyle = `hsla(${hue}, 88%, 52%, 0.9)`;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1 + Math.min(5, mag / 35);

        const ex = mx + Math.cos(angle) * len;
        const ey = my + Math.sin(angle) * len;

        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const head = 6;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - head * Math.cos(angle - 0.45),
          ey - head * Math.sin(angle - 0.45),
        );
        ctx.lineTo(
          ex - head * Math.cos(angle + 0.45),
          ey - head * Math.sin(angle + 0.45),
        );
        ctx.closePath();
        ctx.fill();

        ctx.font = "10px monospace";
        ctx.fillText(`${mag.toFixed(0)}`, ex + 4, ey - 4);
      }
    }
  }

  function destroy() {
    canvas.remove();
  }

  return { resize, draw, destroy };
}
