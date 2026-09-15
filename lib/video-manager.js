/**
 * Preview + full-video sources per blob. Previews are packed into one atlas
 * so the shader only binds two samplers regardless of blob count.
 *
 * Chrome / capable GPUs: loop the Sanity preview video when present; otherwise
 * fall back to the thumbnail still, then the first frame of the full video.
 * Safari / iOS: prefer stills (thumbnail, else first frame of preview/full)
 * so idle decode stays cheap.
 */

import * as THREE from "three";
import { PARAMS } from "./uniforms.js";
import { mediaPlayUrl } from "./media-url.js";

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
      // Safari / iOS: stills only.
      if (bp.thumbnail) bindPreviewImage(index, bp.thumbnail);
      else if (bp.video) bindPreviewVideoStill(index, bp.video);
      else if (bp.videoFull) bindPreviewVideoStill(index, bp.videoFull);
    } else if (bp.video) {
      // Chrome: prefer looping preview when available.
      bindPreviewVideoLive(index, bp.video);
    } else if (bp.thumbnail) {
      bindPreviewImage(index, bp.thumbnail);
    } else if (bp.videoFull) {
      // Same still capture Safari uses, but from the full video.
      bindPreviewVideoStill(index, bp.videoFull);
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

  /**
   * Wait until a video has enough data to show a frame (or fail / time out).
   * First-select after page load often misses a single `loadeddata` under
   * decode contention — so we also accept canplay and poll readyState.
   *
   * @param {HTMLVideoElement} el
   * @param {{ timeoutMs?: number }} [opts]
   */
  function waitForMediaReady(el, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 45000;
    return new Promise((resolve, reject) => {
      if (el.readyState >= 2 && el.videoWidth > 0) {
        resolve();
        return;
      }

      let settled = false;
      const finish = (fn) => () => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onReady = finish(() => resolve());
      const onErr = finish(() => reject(new Error("video error")));
      const onTimeout = finish(() =>
        reject(new Error(`video load timeout (${timeoutMs}ms)`)),
      );

      const tryReady = () => {
        if (el.readyState >= 2 && el.videoWidth > 0) onReady();
      };

      const poll = window.setInterval(tryReady, 100);
      const timer = window.setTimeout(onTimeout, timeoutMs);

      const cleanup = () => {
        window.clearInterval(poll);
        window.clearTimeout(timer);
        el.removeEventListener("loadeddata", tryReady);
        el.removeEventListener("canplay", tryReady);
        el.removeEventListener("canplaythrough", tryReady);
        el.removeEventListener("error", onErr);
      };

      el.addEventListener("loadeddata", tryReady);
      el.addEventListener("canplay", tryReady);
      el.addEventListener("canplaythrough", tryReady);
      el.addEventListener("error", onErr);
    });
  }

  /** True when the decoded frame can be uploaded to WebGL / canvas. */
  function canUseAsWebGLTexture(video) {
    if (!video || !(video.videoWidth > 0)) return false;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, 2, 2);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  }

  /** @type {Map<number, Promise<HTMLVideoElement>>} */
  const fullLoadPromises = new Map();
  const loadingFull = new Set();

  /**
   * @param {number} index
   * @param {string} src
   * @returns {Promise<HTMLVideoElement>}
   */
  function loadFullFromSrc(index, src) {
    const slot = slots[index];
    const full = makeVideo(true, true);
    slot.full = full;
    slot.fullTextureReady = false;
    slot.fullReady = false;

    const playUrl = mediaPlayUrl(src) || src;
    // Same-origin proxy (and Sanity) are WebGL-safe; keep anonymous so a
    // future CDN host with ACAO still works if the proxy is skipped.
    full.el.crossOrigin = "anonymous";
    full.el.preload = "auto";
    full.el.loop = false;
    full.el.muted = true;
    // Assign src once — do not call load()/play() afterwards. Reloading or
    // play+pause races abort Vimeo's 206 range responses (ERR_CONNECTION_CLOSED).
    full.el.src = playUrl;

    return waitForMediaReady(full.el).then(() => {
      if (slots[index]?.full !== full) {
        throw new Error("full video replaced during load");
      }
      full.el.pause();
      full.ready = true;
      slot.fullReady = true;
      const textureOk = canUseAsWebGLTexture(full.el);
      slot.fullTextureReady = textureOk;
      if (full.el.videoWidth && full.el.videoHeight) {
        uniforms.fullRes[index * 2] = full.el.videoWidth;
        uniforms.fullRes[index * 2 + 1] = full.el.videoHeight;
      }
      if (textureOk) bindFullTextures(index);
      else {
        console.warn(
          "[video] full file plays but is not WebGL-safe (CORS). Blob stays on preview.",
          playUrl,
        );
      }
      return full.el;
    });
  }

  /** @returns {Promise<HTMLVideoElement>} */
  function loadFull(index) {
    const slot = slots[index];
    if (!slot) return Promise.reject(new Error("invalid index"));

    if (slot.full?.ready) return Promise.resolve(slot.full.el);

    const existing = fullLoadPromises.get(index);
    if (existing) return existing;

    const fullSrc = PARAMS.blobs[index]?.videoFull;
    if (!fullSrc) return Promise.reject(new Error("no full video url"));

    const promise = loadFullFromSrc(index, fullSrc)
      .catch((err) => {
        if (
          err instanceof Error &&
          /replaced during load/i.test(err.message)
        ) {
          throw err;
        }
        // Drop the broken element, then one clean retry (new element — never
        // re-src mid-download, which aborts 206 streams).
        if (slots[index]?.full) {
          const broken = slots[index].full;
          for (const off of broken.listeners) off();
          broken.listeners.length = 0;
          broken.el.removeAttribute("src");
          try {
            broken.el.load();
          } catch {
            /* ignore */
          }
          broken.texture?.dispose();
          broken.el.remove();
          slots[index].full = null;
          slots[index].fullReady = false;
          slots[index].fullTextureReady = false;
        }
        if (!loadingFull.has(index)) throw err;
        console.warn("[video] full load retry", fullSrc, err);
        return loadFullFromSrc(index, fullSrc);
      })
      .finally(() => {
        fullLoadPromises.delete(index);
      });

    fullLoadPromises.set(index, promise);
    return promise;
  }

  function releaseFull(index) {
    const slot = slots[index];
    if (!slot?.full) {
      loadingFull.delete(index);
      return;
    }
    const full = slot.full;
    full.el.pause();
    full.el.muted = true;
    try {
      full.el.currentTime = 0.01;
    } catch {
      /* ignore */
    }
    for (const off of full.listeners) off();
    full.listeners.length = 0;
    full.el.removeAttribute("src");
    full.el.load();
    full.texture?.dispose();
    full.el.remove();
    slot.full = null;
    slot.fullReady = false;
    slot.fullTextureReady = false;
    loadingFull.delete(index);
    if (index < uniforms.hasFull.length) uniforms.hasFull[index] = 0;
    if (currentFullIndex === index) currentFullIndex = -1;
  }

  /** Pause full playback immediately; release happens after the blend fade. */
  function stopFull(index) {
    if (index < 0) return;
    const full = slots[index]?.full;
    if (!full?.el) return;
    full.el.pause();
    full.el.muted = true;
    try {
      full.el.currentTime = 0.01;
    } catch {
      /* ignore */
    }
  }

  /** @returns {Promise<{ video: HTMLVideoElement, index: number }>} */
  async function select(index) {
    loadingFull.add(index);
    try {
      const video = await loadFull(index);
      return { video, index };
    } finally {
      loadingFull.delete(index);
    }
  }

  function deselect(index) {
    if (index < 0) return;
    stopFull(index);
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
    isFullLoading: (i) => loadingFull.has(i),
    destroy,
  };
}
