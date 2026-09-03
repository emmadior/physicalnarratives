/**
 * Pointer and keyboard input for blob selection.
 */

import { isInsideFocusedBlob } from "./selection.js";

export function toLayout(
  clientX,
  clientY,
  canvas,
  layoutScale,
  out,
  focusZoom = 1,
) {
  const rect = canvas.getBoundingClientRect();
  const zoom = Math.max(focusZoom, 1);
  // Match blob.frag.glsl: p = cssOffset / focusZoom, circles at layout * layoutScale.
  const cssX = clientX - rect.left - rect.width / 2;
  const cssY = -(clientY - rect.top - rect.height / 2);
  out.x = cssX / (layoutScale * zoom);
  out.y = cssY / (layoutScale * zoom);
  return out;
}

/**
 * @param {{ sim: import('./blob.js').BlobSim, canvas: HTMLCanvasElement, getLayoutScale: () => number, getFocusZoom?: () => number, hitTest: (x: number, y: number) => number, onFocusChange?: (index: number) => void, onSelectedBlobClick?: () => void }} ctx
 * @returns {{ destroy: () => void }}
 */
export function initSelectionInput({
  sim,
  canvas,
  getLayoutScale,
  getFocusZoom,
  hitTest,
  onFocusChange,
  onSelectedBlobClick,
}) {
  const pointer = { x: 0, y: 0 };
  let pressX = 0;
  let pressY = 0;
  let pressed = false;

  const updateCursor = () => {
    if (sim.selectedIndex >= 0 && !sim.selectionSettled) {
      canvas.style.cursor = "default";
      return;
    }
    if (
      sim.selectedIndex >= 0 &&
      sim.paramTargetIndex >= 0 &&
      isInsideFocusedBlob(sim, sim.selectedIndex, pointer.x, pointer.y)
    ) {
      canvas.style.cursor = "pointer";
      return;
    }
    const hit = hitTest(pointer.x, pointer.y);
    canvas.style.cursor = hit >= 0 ? "pointer" : "default";
  };

  const layoutPoint = (clientX, clientY) =>
    toLayout(
      clientX,
      clientY,
      canvas,
      getLayoutScale(),
      pointer,
      getFocusZoom?.() ?? 1,
    );

  const onPointerMove = (e) => {
    layoutPoint(e.clientX, e.clientY);
    updateCursor();
  };

  const onPointerLeave = () => {
    canvas.style.cursor = "default";
  };

  const onPointerDown = (e) => {
    pressed = true;
    pressX = e.clientX;
    pressY = e.clientY;
  };

  const onPointerUp = (e) => {
    if (!pressed) return;
    pressed = false;
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 12) return;

    layoutPoint(e.clientX, e.clientY);
    const hit = hitTest(pointer.x, pointer.y);

    const focused =
      sim.selectedIndex >= 0
        ? sim.selectedIndex
        : sim.paramTargetIndex >= 0
          ? sim.paramTargetIndex
          : -1;

    if (focused >= 0) {
      if (isInsideFocusedBlob(sim, focused, pointer.x, pointer.y)) {
        onSelectedBlobClick?.();
        return;
      }
      if (hit >= 0 && hit !== focused) {
        sim.setFocus(hit);
        onFocusChange?.(hit);
      } else {
        sim.setFocus(-1);
        onFocusChange?.(-1);
      }
    } else if (hit >= 0) {
      sim.setFocus(hit);
      onFocusChange?.(hit);
    }
  };

  const onPointerCancel = () => {
    pressed = false;
  };

  const onKeydown = (e) => {
    if (e.key !== "Escape") return;
    if (
      sim.selectedIndex < 0 &&
      !sim.paramTransitioning &&
      sim.exitPhase === "idle"
    ) {
      return;
    }
    sim.setFocus(-1);
    onFocusChange?.(-1);
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeydown);

  return {
    destroy() {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeydown);
      canvas.style.cursor = "default";
    },
  };
}
