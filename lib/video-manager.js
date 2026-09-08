/**
 * Preview + full-video sources per blob. Previews are packed into one atlas
 * so the shader only binds two samplers regardless of blob count.
 *
 * Chrome / capable GPUs: loop the Sanity preview videos into the atlas.
 * Safari / iOS: use stills (thumbnail image, or the first video frame) so
 * idle decode stays cheap.
 */

import * as THREE from "three";
import { PARAMS } from "./uniforms.js";

const HIDDEN_MEDIA_STYLE =
  "position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1";

/** Preview atlas cells — large enough that idle blobs stay sharp on retina. */
const MAX_ATLAS_DIM = 8192;
const TARGET_CELL_W = 1280;
const TARGET_CELL_H = 720;

/** Safari / iOS WebKit — prefer stills over looping preview decode. */
export function prefersPreviewStills() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS =
    /iP(ad|hone|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari =
    /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
  return iOS || safari;
}

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
  /**
   * @typedef {{
   *   kind: 'image' | 'video',
   *   live: boolean,
   *   el: HTMLImageElement | HTMLVideoElement,
   *   ready: boolean,
   *   drawn: boolean,
   *   listeners: (() => void)[],
   * }} PreviewSource
   * @typedef {{
   *   el: HTMLVideoElement,
   *   texture: THREE.VideoTexture | null,
   *   ready: boolean,
   *   listeners: (() => void)[],
   * }} FullSource
   * @type {{
   *   preview: PreviewSource,
   *   full: FullSource | null,
   *   fullReady: boolean,
   *   fullTextureReady: boolean,
   * }[]}
   */
  const slots = [];
  let currentFullIndex = -1;
  const useStills = prefersPreviewStills();

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
  const atlasCtx = atlasCanvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
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

  function makeVideo(useCors = true, withTexture = false) {
    const el = document.createElement("video");
    el.playsInline = true;
    el.preload = "auto";
    if (useCors) el.crossOrigin = "anonymous";
    el.style.cssText = HIDDEN_MEDIA_STYLE;
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

  /** @param {PreviewSource | FullSource} source */
  function listen(source, type, handler) {
    source.el.addEventListener(type, handler);
    source.listeners.push(() => source.el.removeEventListener(type, handler));
  }

  function setPreviewSize(index, w, h) {
    if (!(w > 0 && h > 0)) return;
    uniforms.previewRes[index * 2] = w;
    uniforms.previewRes[index * 2 + 1] = h;
  }

  function markPreviewReady(index, preview) {
    preview.ready = true;
    preview.drawn = false;
    if (index < uniforms.hasPreview.length) {
      uniforms.hasPreview[index] = 1;
    }
  }

  function markPreviewError(index, preview) {
    preview.ready = false;
    preview.drawn = false;
    if (index < uniforms.hasPreview.length) {
      uniforms.hasPreview[index] = 0;
    }
  }

  /** Sanity CDN image — resized to atlas cell width. */
  function thumbnailSrc(url) {
    if (!url) return url;
    if (!/cdn\.sanity\.io\/images\//.test(url)) return url;
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}w=${TARGET_CELL_W}&fit=max&auto=format`;
  }

  function bindPreviewImage(index, src) {
    const el = document.createElement("img");
    el.decoding = "async";
    el.crossOrigin = "anonymous";
    el.style.cssText = HIDDEN_MEDIA_STYLE;
    container.appendChild(el);

    /** @type {PreviewSource} */
    const preview = {
      kind: "image",
      live: false,
      el,
      ready: false,
      drawn: false,
      listeners: [],
    };

    const onLoad = () => {
      setPreviewSize(index, el.naturalWidth, el.naturalHeight);
      markPreviewReady(index, preview);
    };
    const onErr = () => markPreviewError(index, preview);

    listen(preview, "load", onLoad);
    listen(preview, "error", onErr);
    el.src = thumbnailSrc(src);
    if (el.complete && el.naturalWidth > 0) onLoad();

    slots[index] = {
      preview,
      full: null,
      fullReady: false,
      fullTextureReady: false,
    };
    if (index < uniforms.hasPreview.length) {
      uniforms.hasPreview[index] = 0;
      uniforms.hasFull[index] = 0;
    }
  }

  /** Capture the first decoded frame of the preview video, then keep it paused. */
  function bindPreviewVideoStill(index, src) {
    const made = makeVideo(true, false);
    /** @type {PreviewSource} */
    const preview = {
      kind: "video",
      live: false,
      el: made.el,
      ready: false,
      drawn: false,
      listeners: made.listeners,
    };

    preview.el.src = src.includes("#") ? src : `${src}#t=0.001`;
    preview.el.muted = true;
    preview.el.loop = false;
    preview.el.playsInline = true;

    const readSize = () => {
      setPreviewSize(index, preview.el.videoWidth, preview.el.videoHeight);
    };

    const captureFrame = () => {
      const el = /** @type {HTMLVideoElement} */ (preview.el);
      if (!(el.videoWidth > 0)) return;
      readSize();
      el.pause();
      markPreviewReady(index, preview);
    };

    listen(preview, "loadedmetadata", readSize);
    listen(preview, "loadeddata", captureFrame);
    listen(preview, "seeked", captureFrame);
    listen(preview, "error", () => markPreviewError(index, preview));

    if (preview.el.readyState >= 1) readSize();
    if (preview.el.readyState >= 2) captureFrame();

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

  /** Looping preview video — used on Chrome and other capable browsers. */
  function bindPreviewVideoLive(index, src) {
    const made = makeVideo(true, false);
    /** @type {PreviewSource} */
    const preview = {
      kind: "video",
      live: true,
      el: made.el,
      ready: false,
      drawn: false,
      listeners: made.listeners,
    };

    preview.el.src = src;
    preview.el.muted = true;
    preview.el.loop = true;
    preview.el.playsInline = true;

    const readSize = () => {
      setPreviewSize(index, preview.el.videoWidth, preview.el.videoHeight);
    };

    const markReady = () => {
      markPreviewReady(index, preview);
      preview.el.play().catch(() => {});
    };

    listen(preview, "loadedmetadata", readSize);
    listen(preview, "loadeddata", markReady);
    listen(preview, "error", () => markPreviewError(index, preview));

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

  function bindPreview(index) {
    const bp = PARAMS.blobs[index];
    if (!bp) return;
    if (useStills) {
      if (bp.thumbnail) bindPreviewImage(index, bp.thumbnail);
      else if (bp.video) bindPreviewVideoStill(index, bp.video);
    } else if (bp.video) {
      bindPreviewVideoLive(index, bp.video);
    }
  }

  function bindAllPreviews() {
    for (let i = 0; i < PARAMS.blobs.length; i++) {
      bindPreview(i);
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
    const preview = slots[index]?.preview;
    if (!preview?.live || preview.kind !== "video") return;
    /** @type {HTMLVideoElement} */ (preview.el).play().catch(() => {});
  }

  function getActiveVideo(index) {
    const slot = slots[index];
    if (!slot) return null;
    if (slot.fullReady) return slot.full.el;
    if (slot.preview.live && slot.preview.kind === "video") {
      return /** @type {HTMLVideoElement} */ (slot.preview.el);
    }
    return null;
  }

  function getPreviewVideo(index) {
    const preview = slots[index]?.preview;
    if (!preview || preview.kind !== "video") return null;
    return /** @type {HTMLVideoElement} */ (preview.el);
  }

  function getFullRes(index) {
    return {
      w: uniforms.fullRes[index * 2],
      h: uniforms.fullRes[index * 2 + 1],
    };
  }

  function canDrawPreview(preview) {
    if (!preview?.ready) return false;
    if (!preview.live && preview.drawn) return false;
    if (preview.kind === "image") {
      const img = /** @type {HTMLImageElement} */ (preview.el);
      return img.complete && img.naturalWidth > 0;
    }
    const video = /** @type {HTMLVideoElement} */ (preview.el);
    if (preview.live && video.paused) return false;
    return video.readyState >= 2 && video.videoWidth > 0;
  }

  function updateAtlas() {
    if (!atlasCtx) return;

    let drew = false;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot || !canDrawPreview(slot.preview)) continue;
      const col = i % atlasCols;
      const row = Math.floor(i / atlasCols);
      atlasCtx.drawImage(slot.preview.el, col * cellW, row * cellH, cellW, cellH);
      if (!slot.preview.live) slot.preview.drawn = true;
      drew = true;
    }
    if (drew) atlasTexture.needsUpdate = true;
  }

  let playbackKey = "";

  /**
   * Keep decoding only the live previews that are still on-screen.
   * @param {number} selectedIndex -1 = all idle
   * @param {boolean} keepSelectedPreview
   */
  function syncPreviewPlayback(selectedIndex, keepSelectedPreview) {
    if (useStills) return;
    const key = `${selectedIndex}:${keepSelectedPreview ? 1 : 0}`;
    if (key === playbackKey) return;
    playbackKey = key;
    for (let i = 0; i < slots.length; i++) {
      const preview = slots[i]?.preview;
      if (!preview?.live || preview.kind !== "video") continue;
      const el = /** @type {HTMLVideoElement} */ (preview.el);
      const play =
        selectedIndex < 0 || (i === selectedIndex && keepSelectedPreview);
      if (play) el.play().catch(() => {});
      else el.pause();
    }
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
      if (slot?.preview.kind === "video") {
        /** @type {HTMLVideoElement} */ (slot.preview.el).pause();
      }
    }
  }

  function playPreviews() {
    if (useStills) return;
    for (const slot of slots) {
      if (slot?.preview.live && slot.preview.kind === "video") {
        /** @type {HTMLVideoElement} */ (slot.preview.el).play().catch(() => {});
      }
    }
  }

  function destroy() {
    for (let i = 0; i < slots.length; i++) {
      releaseFull(i);
      const slot = slots[i];
      if (!slot) continue;
      if (slot.preview.kind === "video") {
        /** @type {HTMLVideoElement} */ (slot.preview.el).pause();
        slot.preview.el.removeAttribute("src");
        /** @type {HTMLVideoElement} */ (slot.preview.el).load();
      } else {
        /** @type {HTMLImageElement} */ (slot.preview.el).removeAttribute("src");
      }
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
    syncPreviewPlayback,
    slowGpu: useStills,
    atlasTexture,
    atlasCols,
    atlasRows,
    getFullTexture: () => {
      const slot = currentFullIndex >= 0 ? slots[currentFullIndex] : null;
      if (slot?.fullTextureReady && slot.full?.texture)
        return slot.full.texture;
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
