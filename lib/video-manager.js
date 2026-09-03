/**
 * Preview + full-video sources per blob. Previews are packed into one atlas
 * so the shader only binds two samplers regardless of blob count.
 */

import * as THREE from "three";
import { PARAMS } from "./uniforms.js";

const HIDDEN_VIDEO_STYLE =
  "position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1";

/** Preview atlas cells — large enough that idle blobs stay sharp on retina. */
const MAX_ATLAS_DIM = 8192;
const TARGET_CELL_W = 1280;
const TARGET_CELL_H = 720;

/**
 * @param {HTMLElement} container
 * @param {THREE.DataTexture} fallbackTexture
 * @param {{
 *   previewRes: Float32Array,
 *   fullRes: Float32Array,
 *   hasPreview: Float32Array,
 *   hasFull: Float32Array,
 * }} uniforms
 */
export function createVideoManager(container, fallbackTexture, uniforms) {
  /** @type {{ preview: Source, full: Source | null, fullReady: boolean, fullTextureReady: boolean }[]} */
  const slots = [];
  let currentFullIndex = -1;

  const blobN = Math.max(1, PARAMS.blobs.length);
  const atlasCols = Math.max(1, Math.ceil(Math.sqrt(blobN)));
  const atlasRows = Math.max(1, Math.ceil(blobN / atlasCols));
  const cellScale = Math.min(
    1,
    MAX_ATLAS_DIM / (atlasCols * TARGET_CELL_W),
    MAX_ATLAS_DIM / (atlasRows * TARGET_CELL_H),
  );
  const cellW = Math.max(1, Math.round(TARGET_CELL_W * cellScale));
  const cellH = Math.max(1, Math.round(TARGET_CELL_H * cellScale));
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = atlasCols * cellW;
  atlasCanvas.height = atlasRows * cellH;
  const atlasCtx = atlasCanvas.getContext("2d", { alpha: false });
  atlasCtx.imageSmoothingEnabled = true;
  atlasCtx.imageSmoothingQuality = "high";
  atlasCtx.fillStyle = "#b2b2b2";
  atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);

  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.minFilter = THREE.LinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.NoColorSpace;
  atlasTexture.flipY = true;

  /** @typedef {{ el: HTMLVideoElement, texture: THREE.VideoTexture | null, ready: boolean, listeners: (() => void)[] }} Source */

  function makeVideo(useCors = true, withTexture = false) {
    const el = document.createElement("video");
    el.playsInline = true;
    el.preload = "auto";
    if (useCors) el.crossOrigin = "anonymous";
    el.style.cssText = HIDDEN_VIDEO_STYLE;
    container.appendChild(el);

    /** @type {THREE.VideoTexture | null} */
    let texture = null;
    if (withTexture) {
      texture = new THREE.VideoTexture(el);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.NoColorSpace;
    }

    return { el, texture, ready: false, listeners: [] };
  }

  function listen(source, type, handler) {
    source.el.addEventListener(type, handler);
    source.listeners.push(() => source.el.removeEventListener(type, handler));
  }

  function bindPreview(index, src) {
    const preview = makeVideo(true, false);
    preview.el.src = src;
    preview.el.muted = true;
    preview.el.loop = true;

    const readSize = () => {
      if (preview.el.videoWidth && preview.el.videoHeight) {
        uniforms.previewRes[index * 2] = preview.el.videoWidth;
        uniforms.previewRes[index * 2 + 1] = preview.el.videoHeight;
      }
    };

    const markReady = () => {
      preview.ready = true;
      if (index < uniforms.hasPreview.length) {
        uniforms.hasPreview[index] = 1;
      }
    };

    listen(preview, "loadedmetadata", readSize);
    listen(preview, "loadeddata", markReady);
    listen(preview, "error", () => {
      preview.ready = false;
      if (index < uniforms.hasPreview.length) {
        uniforms.hasPreview[index] = 0;
      }
    });

    if (preview.el.readyState >= 1) readSize();
    if (preview.el.readyState >= 2) markReady();

    slots[index] = {
      preview,
      full: null,
      fullReady: false,
      fullTextureReady: false,
    };
    if (index < uniforms.hasPreview.length) {
      uniforms.hasPreview[index] = preview.ready ? 1 : 0;
      uniforms.hasFull[index] = 0;
    }
  }

  function bindAllPreviews() {
    for (let i = 0; i < PARAMS.blobs.length; i++) {
      const src = PARAMS.blobs[i]?.video;
      if (!src) continue;
      if (slots[i]) {
        slots[i].preview.el.src = src;
        slots[i].preview.ready = false;
        slots[i].preview.el.load();
      } else {
        bindPreview(i, src);
      }
    }
  }

  bindAllPreviews();

  function bindFullTextures(index) {
    const slot = slots[index];
    const full = slot?.full;
    if (!full?.ready) return;
    currentFullIndex = index;
    if (index < uniforms.hasFull.length) {
      uniforms.hasFull[index] = 1;
    }
    if (full.el.videoWidth && full.el.videoHeight) {
      uniforms.fullRes[index * 2] = full.el.videoWidth;
      uniforms.fullRes[index * 2 + 1] = full.el.videoHeight;
    }
  }

  /** @returns {Promise<HTMLVideoElement>} */
  function loadFull(index) {
    const slot = slots[index];
    if (!slot) return Promise.reject(new Error("invalid index"));

    if (slot.full?.ready) return Promise.resolve(slot.full.el);

    if (slot.full) {
      return new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve(slot.full.el);
        };
        const onErr = () => {
          cleanup();
          reject(new Error("full video failed"));
        };
        const cleanup = () => {
          slot.full.el.removeEventListener("loadeddata", onReady);
          slot.full.el.removeEventListener("error", onErr);
        };
        slot.full.el.addEventListener("loadeddata", onReady);
        slot.full.el.addEventListener("error", onErr);
      });
    }

    const full = makeVideo(true, true);
    const fullSrc = PARAMS.blobs[index]?.videoFull;
    if (!fullSrc) return Promise.reject(new Error("no full video url"));

    slot.full = full;
    slot.fullTextureReady = false;

    const applySrc = (useCors) => {
      if (useCors) full.el.crossOrigin = "anonymous";
      else full.el.removeAttribute("crossorigin");
      full.el.removeAttribute("src");
      full.el.src = fullSrc.includes("#") ? fullSrc : `${fullSrc}#t=0.01`;
      full.el.loop = false;
      full.el.muted = true;
      full.el.load();
    };

    return new Promise((resolve, reject) => {
      let triedNoCors = false;

      const onMeta = () => {
        if (full.el.videoWidth && full.el.videoHeight) {
          uniforms.fullRes[index * 2] = full.el.videoWidth;
          uniforms.fullRes[index * 2 + 1] = full.el.videoHeight;
        }
      };

      const onReady = () => {
        full.el.currentTime = 0.01;
        full.el.pause();
        full.ready = true;
        slot.fullReady = true;
        slot.fullTextureReady = !triedNoCors;
        if (slot.fullTextureReady) bindFullTextures(index);
        cleanup();
        resolve(full.el);
      };

      const onErr = () => {
        // Vimeo progressive URLs are signed for the browser and often have
        // no CORS. Retry without crossOrigin so the HTML player can still
        // play; the shader keeps the Sanity preview in that case.
        if (!triedNoCors) {
          triedNoCors = true;
          applySrc(false);
          return;
        }
        cleanup();
        reject(new Error("full video failed"));
      };

      const cleanup = () => {
        full.el.removeEventListener("loadedmetadata", onMeta);
        full.el.removeEventListener("loadeddata", onReady);
        full.el.removeEventListener("error", onErr);
      };

      full.el.addEventListener("loadedmetadata", onMeta);
      full.el.addEventListener("loadeddata", onReady);
      full.el.addEventListener("error", onErr);
      applySrc(true);
    });
  }

  function releaseFull(index) {
    const slot = slots[index];
    if (!slot?.full) return;
    slot.full.el.pause();
    slot.full.el.removeAttribute("src");
    slot.full.el.load();
    for (const off of slot.full.listeners) off();
    slot.full.texture?.dispose();
    slot.full.el.remove();
    slot.full = null;
    slot.fullReady = false;
    slot.fullTextureReady = false;
    if (currentFullIndex === index) currentFullIndex = -1;
    if (index < uniforms.hasFull.length) {
      uniforms.hasFull[index] = 0;
    }
    if (index * 2 + 1 < uniforms.fullRes.length) {
      uniforms.fullRes[index * 2] = 1;
      uniforms.fullRes[index * 2 + 1] = 1;
    }
  }

  /** @returns {Promise<{ video: HTMLVideoElement, index: number }>} */
  async function select(index) {
    const video = await loadFull(index);
    return { video, index };
  }

  function deselect(index) {
    if (index < 0) return;
    slotPreviewPlay(index);
  }

  function finalizeDeselect(index) {
    if (index < 0) return;
    releaseFull(index);
    slotPreviewPlay(index);
  }

  function slotPreviewPlay(index) {
    slots[index]?.preview.el.play().catch(() => {});
  }

  function getActiveVideo(index) {
    const slot = slots[index];
    if (!slot) return null;
    return slot.fullReady ? slot.full.el : slot.preview.el;
  }

  function getPreviewVideo(index) {
    return slots[index]?.preview.el ?? null;
  }

  function getFullRes(index) {
    return {
      w: uniforms.fullRes[index * 2],
      h: uniforms.fullRes[index * 2 + 1],
    };
  }

  function updateAtlas() {
    if (!atlasCtx) return;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const col = i % atlasCols;
      const row = Math.floor(i / atlasCols);
      const x = col * cellW;
      const y = row * cellH;
      const el = slot.preview.el;
      if (slot.preview.ready && el.readyState >= 2 && el.videoWidth > 0) {
        atlasCtx.drawImage(el, x, y, cellW, cellH);
      }
    }
    atlasTexture.needsUpdate = true;
  }

  function tickTexture(index) {
    const slot = slots[index];
    if (!slot) return;
    if (slot.full?.ready && slot.full.el.readyState >= 2 && slot.full.texture) {
      slot.full.texture.needsUpdate = true;
    }
  }

  function pausePreviews() {
    for (const slot of slots) {
      slot.preview.el.pause();
    }
  }

  function playPreviews() {
    for (const slot of slots) {
      slot.preview.el.play().catch(() => {});
    }
  }

  function destroy() {
    for (let i = 0; i < slots.length; i++) {
      releaseFull(i);
      const slot = slots[i];
      if (!slot) continue;
      slot.preview.el.pause();
      slot.preview.el.removeAttribute("src");
      slot.preview.el.load();
      for (const off of slot.preview.listeners) off();
      slot.preview.el.remove();
    }
    slots.length = 0;
    atlasTexture.dispose();
  }

  return {
    select,
    deselect,
    finalizeDeselect,
    getActiveVideo,
    getPreviewVideo,
    getFullRes,
    updateAtlas,
    tickTexture,
    pausePreviews,
    playPreviews,
    atlasTexture,
    atlasCols,
    atlasRows,
    getFullTexture: () => {
      const slot = currentFullIndex >= 0 ? slots[currentFullIndex] : null;
      if (slot?.fullTextureReady && slot.full?.texture) return slot.full.texture;
      return fallbackTexture;
    },
    getFullIndex: () => {
      const slot = currentFullIndex >= 0 ? slots[currentFullIndex] : null;
      return slot?.fullTextureReady ? currentFullIndex : -1;
    },
    isFullReady: (i) => slots[i]?.fullReady ?? false,
    isFullTextureReady: (i) => slots[i]?.fullTextureReady ?? false,
    destroy,
  };
}
