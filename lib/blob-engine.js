/**
 * WebGL blob renderer. Plain JS — no Vue. Create on mount, destroy on unmount.
 */

import * as THREE from "three";
import { BlobSim } from "./blob.js";
import { PARAMS, MAX_PER_BLOB, LAYOUT_REFERENCE } from "./uniforms.js";
import vertexShader from "~/assets/shaders/blob.vert.glsl?raw";
import fragmentShader from "~/assets/shaders/blob.frag.glsl?raw";

import { createVideoManager } from "./video-manager.js";
import { initSelectionInput } from "./input.js";
import { hitTest } from "./selection.js";
import { getBlendedVideoFrame } from "./selection-focus.js";
import { applyProjectsToParams } from "./apply-projects.js";
import { addScrollDelta, setInfoBoxCss } from "./scroll-breaker.js";

THREE.ColorManagement.enabled = false;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 * @param {{
 *   onSelectionState?: (state: SelectionState) => void,
 *   onFullscreenChange?: (active: boolean) => void,
 *   projects?: import('~/stores/project').Project[],
 * }} [callbacks]
 */
export function createBlobEngine(canvas, container, callbacks = {}) {
  let disposed = false;
  let rafId = 0;
  let renderPaused = false;
  let fullVideoPlaying = false;
  let pendingSelectIndex = -1;
  let layoutScale = 1;
  let playButtonOpacity = 0;
  /** @type {{ destroy: () => void } | null} */
  let guiController = null;

  /** @typedef {{ selectedIndex: number, fullVideoReady: boolean, fullVideo: HTMLVideoElement | null, playing: boolean, playButton: { visible: boolean, x: number, y: number, opacity: number } }} SelectionState */

  /** @type {ReturnType<typeof import('./force-debug.js').createForceDebugOverlay> | null} */
  let forceDebug = null;

  const disposers = [];

  /** @param {EventTarget} target @param {string} type @param {EventListener} handler @param {AddEventListenerOptions} [options] */
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const STATIC_POSE_STEPS = 240;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdbdbdb);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const fallbackTexture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
  );
  fallbackTexture.needsUpdate = true;

  if (callbacks.projects?.length) {
    const count = applyProjectsToParams(callbacks.projects);
    console.log("[blob] applied CMS projects to blobs", { count });
  } else {
    console.log(
      "[blob] no CMS projects — using default PARAMS.blobs",
      PARAMS.blobs,
    );
  }

  const shaderBlobCount = Math.max(1, PARAMS.blobs.length);
  const compiledFragmentShader = fragmentShader.replace(
    /#define MAX_BLOBS \d+/,
    `#define MAX_BLOBS ${shaderBlobCount}`,
  );

  function makeFloatTex(width, height) {
    const data = new Float32Array(width * height * 4);
    const tex = new THREE.DataTexture(
      data,
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return { data, tex };
  }

  const circleTex = makeFloatTex(MAX_PER_BLOB, shaderBlobCount);
  const circleMetaTex = makeFloatTex(MAX_PER_BLOB, shaderBlobCount);
  const blobCenterArray = new Float32Array(shaderBlobCount * 2);
  const blobFitArray = new Float32Array(shaderBlobCount * 2).fill(1);
  const boundsMinArray = new Float32Array(shaderBlobCount * 2);
  const boundsMaxArray = new Float32Array(shaderBlobCount * 2);
  const displaceArray = new Float32Array(shaderBlobCount).fill(1);
  const videoContainArray = new Float32Array(shaderBlobCount);
  const videoOpacityArray = new Float32Array(shaderBlobCount);
  const videoFadeT = new Float32Array(shaderBlobCount);
  const hasVideoArray = new Float32Array(shaderBlobCount);
  const hasVideoFullArray = new Float32Array(shaderBlobCount);
  const videoResArray = new Float32Array(shaderBlobCount * 2).fill(1);
  const videoResFullArray = new Float32Array(shaderBlobCount * 2).fill(1);
  const videoBlendArray = new Float32Array(shaderBlobCount);
  const videoBlendTarget = new Float32Array(shaderBlobCount);
  /** 0 = base colour, 1 = video. Used only when exiting selected state. */
  const exitRevealT = new Float32Array(shaderBlobCount).fill(1);
  const exitRevealTarget = new Float32Array(shaderBlobCount).fill(1);
  const exitRevealPending = new Set();
  /** <0 idle; else elapsed seconds through the select colour flash. */
  const selectBlinkElapsed = new Float32Array(shaderBlobCount).fill(-1);
  const pendingVideoRelease = new Set();
  const countsArray = new Int32Array(shaderBlobCount);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVideoAtlas: { value: fallbackTexture },
    uVideoFull: { value: fallbackTexture },
    uAtlasCols: { value: 1 },
    uAtlasRows: { value: 1 },
    uFullIndex: { value: -1 },
    uVideoRes: { value: videoResArray },
    uVideoResFull: { value: videoResFullArray },
    uHasVideo: { value: hasVideoArray },
    uHasVideoFull: { value: hasVideoFullArray },
    uVideoBlend: { value: videoBlendArray },
    uBlobCount: { value: 0 },
    uCounts: { value: countsArray },
    uBlobCenter: { value: blobCenterArray },
    uBlobFit: { value: blobFitArray },
    uBoundsMin: { value: boundsMinArray },
    uBoundsMax: { value: boundsMaxArray },
    uDisplace: { value: displaceArray },
    uVideoContain: { value: videoContainArray },
    uVideoOpacity: { value: videoOpacityArray },
    uCircleTex: { value: circleTex.tex },
    uCircleMetaTex: { value: circleMetaTex.tex },
    uThreshold: { value: PARAMS.threshold },
    uEdgeSoftness: { value: PARAMS.edgeSoftness },
    uFalloff: { value: PARAMS.falloff },
    uUvSharpness: { value: PARAMS.uvSharpness },
    uInterfaceWidth: { value: PARAMS.interfaceWidth },
    uVideoStretch: { value: PARAMS.videoStretch },
    uUseFullTransform: { value: PARAMS.useFullTransform },
    uBlobColor: { value: new THREE.Color(PARAMS.blobColor) },
    uMeniscus: { value: PARAMS.meniscus ? PARAMS.meniscusBrightness : 0 },
    uMeniscusWidth: { value: PARAMS.meniscusWidth },
    uMeniscusEdgeFade: { value: PARAMS.meniscusEdgeFade },
    uMeniscusColor: { value: new THREE.Color(PARAMS.meniscusColor) },
    uLayoutScale: { value: 1 },
    uPairMix: { value: new Float32Array(shaderBlobCount * shaderBlobCount) },
    uFlowMaster: { value: PARAMS.flowMaster },
    uFlowScale: { value: PARAMS.flowScale },
    uFlowStrength: { value: PARAMS.flowStrength },
    uFlowSpeed: { value: PARAMS.flowSpeed },
    uFlowEdgeFade: { value: PARAMS.flowEdgeFade },
    uShowOutlines: { value: 0 },
    uFocusZoom: { value: 1 },
    uBreaker: { value: new THREE.Vector3(0, 0, 0) },
    uBreakerSize: { value: new THREE.Vector2(0, 0) },
    uBreakerOn: { value: 0 },
    uBreakerCut: { value: 1.28 },
  };

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: compiledFragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    extensions: { derivatives: true },
  });

  scene.add(new THREE.Mesh(geometry, material));

  const videoManager = createVideoManager(container, fallbackTexture, {
    previewRes: videoResArray,
    fullRes: videoResFullArray,
    hasPreview: hasVideoArray,
    hasFull: hasVideoFullArray,
  });
  uniforms.uVideoAtlas.value = videoManager.atlasTexture;
  uniforms.uAtlasCols.value = videoManager.atlasCols;
  uniforms.uAtlasRows.value = videoManager.atlasRows;

  const sim = new BlobSim();

  async function handleSelectionChange(index, prev) {
    if (prev >= 0) {
      videoBlendTarget[prev] = 0;
      pendingVideoRelease.add(prev);
      videoManager.deselect(prev);
      // Fade to base colour only when leaving selected state entirely.
      if (index < 0) {
        exitRevealTarget[prev] = 0;
        exitRevealPending.add(prev);
      }
    }
    fullVideoPlaying = false;
    playButtonOpacity = 0;

    if (index < 0) {
      emitSelectionState();
      return;
    }

    pendingSelectIndex = index;
    exitRevealT[index] = 1;
    exitRevealTarget[index] = 1;
    selectBlinkElapsed[index] = 0;
    const previewW = videoResArray[index * 2];
    const previewH = videoResArray[index * 2 + 1];
    if (previewW > 0 && previewH > 0) {
      sim.setFocusVideoAspect(index, previewW, previewH);
    }
    try {
      await videoManager.select(index);
      if (pendingSelectIndex === index && sim.selectedIndex === index) {
        const { w: fullW, h: fullH } = videoManager.getFullRes(index);
        if (fullW > 0 && fullH > 0) {
          sim.setFocusVideoAspect(index, fullW, fullH);
        }
        videoBlendTarget[index] = videoManager.isFullTextureReady(index)
          ? 1
          : 0;
        emitSelectionState();
      }
    } catch (err) {
      console.warn(
        "[blob] full video failed to load",
        PARAMS.blobs[index]?.videoFull,
        err,
      );
      emitSelectionState();
    }
  }

  sim.onSelectionChange = handleSelectionChange;

  /**
   * Layout → overlay CSS. Inverse of toLayout in input.js:
   * shader p = cssOffset / focusZoom, circles at layout * layoutScale.
   */
  function layoutToScreen(lx, ly, rect, zoom) {
    const z = Math.max(zoom || 1, 1);
    return {
      x: rect.width / 2 + lx * layoutScale * z,
      y: rect.height / 2 - ly * layoutScale * z,
    };
  }

  function emitSelectionState() {
    // Hide player while deselecting (paramTargetIndex < 0) even if selectedIndex
    // is still held for shrink physics.
    const idx = sim.paramTargetIndex >= 0 ? sim.selectedIndex : -1;
    const blob = idx >= 0 ? sim.blobs[idx] : null;
    const rect = container.getBoundingClientRect();
    const settled =
      idx >= 0 &&
      !sim.paramTransitioning &&
      !sim.focusSettling &&
      sim.paramTargetIndex >= 0;
    const canShowPlay =
      settled &&
      blob &&
      videoManager.isFullReady(idx) &&
      videoBlendArray[idx] > 0.95 &&
      !fullVideoPlaying &&
      (sim.scrollProgress || 0) < 0.05;
    let playButton = { visible: false, x: 0, y: 0, opacity: 0 };

    if (canShowPlay) {
      const zoom = Math.max(sim.focusZoom || 1, 1);
      const pos = layoutToScreen(
        blob.videoFrameCenterX,
        blob.videoFrameCenterY,
        rect,
        zoom,
      );
      playButton = {
        visible: playButtonOpacity > 0.01,
        x: pos.x,
        y: pos.y,
        opacity: playButtonOpacity,
      };
    }

    callbacks.onSelectionState?.({
      selectedIndex: idx,
      fullVideoReady:
        idx >= 0 &&
        videoManager.isFullReady(idx) &&
        videoBlendArray[idx] > 0.95,
      fullVideo: idx >= 0 ? videoManager.getActiveVideo(idx) : null,
      playing: fullVideoPlaying,
      playButton,
      info: projectInfoState(idx, rect),
    });
  }

  function projectInfoState(idx, rect) {
    const empty = {
      visible: false,
      x: rect.width / 2,
      y: rect.height,
      opacity: 0,
      title: "",
      date: null,
      location: "",
      category: "",
      blocks: [],
      credits: [],
      upcoming: [],
    };
    if (idx < 0) return empty;
    const bp = PARAMS.blobs[idx];
    const breaker = sim.breaker;
    const zoom = Math.max(sim.focusZoom || 1, 1);
    const opacity = breaker?.active || 0;
    const pos = layoutToScreen(breaker?.x || 0, breaker?.y || 0, rect, zoom);
    return {
      visible: opacity > 0.01,
      x: pos.x,
      y: pos.y,
      opacity,
      title: bp?.title || "",
      date: bp?.date || null,
      location: bp?.location || "",
      category: bp?.category || "",
      blocks: Array.isArray(bp?.info) ? bp.info : [],
      credits: Array.isArray(bp?.credits) ? bp.credits : [],
      upcoming: Array.isArray(bp?.upcoming) ? bp.upcoming : [],
    };
  }

  function updateVideoCrossfade(dt) {
    const fadeSec = Math.max(PARAMS.videoCrossfadeSeconds, 0.05);
    const step = dt / fadeSec;

    for (let i = 0; i < shaderBlobCount; i++) {
      const current = videoBlendArray[i];
      const target = videoBlendTarget[i];
      if (Math.abs(current - target) < 0.002) {
        videoBlendArray[i] = target;
      } else {
        const delta =
          Math.sign(target - current) *
          Math.min(step, Math.abs(target - current));
        videoBlendArray[i] = current + delta;
      }

      if (
        pendingVideoRelease.has(i) &&
        videoBlendTarget[i] === 0 &&
        videoBlendArray[i] <= 0.002
      ) {
        pendingVideoRelease.delete(i);
        videoManager.finalizeDeselect(i);
      }
    }
  }

  function updateExitVideoReveal(dt) {
    const fadeOutSec = Math.max(PARAMS.exitVideoFadeOutSeconds, 0.05);
    const fadeInSec = Math.max(PARAMS.exitVideoFadeInSeconds, 0.05);

    for (let i = 0; i < shaderBlobCount; i++) {
      if (exitRevealPending.has(i)) {
        exitRevealTarget[i] = 0;
        const morphDone =
          !sim.paramTransitioning &&
          !sim.focusSettling &&
          sim.paramTargetIndex < 0;
        // Hold base colour through the exit morph, then fade preview back in.
        if (morphDone && exitRevealT[i] <= 0.002) {
          exitRevealPending.delete(i);
          exitRevealTarget[i] = 1;
        }
      } else {
        exitRevealTarget[i] = 1;
      }

      const target = exitRevealTarget[i];
      const current = exitRevealT[i];
      if (Math.abs(current - target) < 0.002) {
        exitRevealT[i] = target;
        continue;
      }
      const step = dt / (target < current ? fadeOutSec : fadeInSec);
      exitRevealT[i] =
        current +
        Math.sign(target - current) *
          Math.min(step, Math.abs(target - current));
    }
  }

  /**
   * Video opacity during select flash: fast dip to base colour, then slower
   * return. Colour opacity is the inverse (0→1 in selectBlinkOutSeconds).
   */
  function selectBlinkFactor(i) {
    const t = selectBlinkElapsed[i];
    if (t < 0) return 1;
    const outSec = Math.max(PARAMS.selectBlinkOutSeconds, 0.0);
    const inSec = Math.max(PARAMS.selectBlinkInSeconds, 0.05);
    if (t < outSec) {
      const u = t / outSec;
      const eased = u * u * (3 - 2 * u);
      return 1 - eased;
    }
    const u = Math.min(1, (t - outSec) / inSec);
    return u * u * (3 - 2 * u);
  }

  function updateSelectBlink(dt) {
    const outSec = Math.max(PARAMS.selectBlinkOutSeconds, 0.01);
    const inSec = Math.max(PARAMS.selectBlinkInSeconds, 0.05);
    const total = outSec + inSec;
    for (let i = 0; i < shaderBlobCount; i++) {
      if (selectBlinkElapsed[i] < 0) continue;
      selectBlinkElapsed[i] += dt;
      if (selectBlinkElapsed[i] >= total) selectBlinkElapsed[i] = -1;
    }
  }

  function updateVideoFadeIn(dt) {
    const fadeSec = Math.max(PARAMS.videoFadeInSeconds, 0.05);
    const step = dt / fadeSec;

    for (let i = 0; i < shaderBlobCount; i++) {
      const bp = PARAMS.blobs[i];
      if (!bp || hasVideoArray[i] < 0.5) {
        videoFadeT[i] = 0;
        videoOpacityArray[i] = 0;
        continue;
      }

      if (videoFadeT[i] < 1) {
        videoFadeT[i] = Math.min(1, videoFadeT[i] + step);
      }

      const eased = videoFadeT[i] * videoFadeT[i] * (3 - 2 * videoFadeT[i]);
      videoOpacityArray[i] =
        bp.videoOpacity * eased * exitRevealT[i] * selectBlinkFactor(i);
    }
  }

  function updatePlayButtonFade(dt) {
    const idx = sim.paramTargetIndex >= 0 ? sim.selectedIndex : -1;
    const settled =
      idx >= 0 &&
      !sim.paramTransitioning &&
      !sim.focusSettling &&
      sim.paramTargetIndex >= 0;
    const canShow =
      settled &&
      videoManager.isFullReady(idx) &&
      videoBlendArray[idx] > 0.95 &&
      !fullVideoPlaying &&
      (sim.scrollProgress || 0) < 0.05;
    const fadeSec = Math.max(PARAMS.playButtonFadeSeconds, 0.05);
    const step = dt / fadeSec;
    if (canShow) playButtonOpacity = Math.min(1, playButtonOpacity + step);
    else playButtonOpacity = 0;
  }

  function canControlPlayback() {
    const idx = sim.paramTargetIndex >= 0 ? sim.selectedIndex : -1;
    if (idx < 0) return false;
    const settled =
      !sim.paramTransitioning &&
      !sim.focusSettling &&
      sim.paramTargetIndex >= 0;
    return (
      settled && videoManager.isFullReady(idx) && videoBlendArray[idx] > 0.95
    );
  }

  function toggleSelectedVideo() {
    if (!canControlPlayback()) return;
    const idx = sim.selectedIndex;
    const video = videoManager.getActiveVideo(idx);
    if (!video) return;

    if (video.paused) {
      video.muted = false;
      video
        .play()
        .then(() => {
          fullVideoPlaying = true;
          emitSelectionState();
        })
        .catch(() => {});
    } else {
      video.pause();
      fullVideoPlaying = false;
      emitSelectionState();
    }
  }

  const selectionInput = initSelectionInput({
    sim,
    canvas,
    getLayoutScale: () => layoutScale,
    getFocusZoom: () => Math.max(sim.focusZoom || 1, 1),
    hitTest: (x, y) => hitTest(sim, x, y),
    onSelectedBlobClick: toggleSelectedVideo,
  });
  disposers.push(() => selectionInput.destroy());

  const onWheel = (e) => {
    if (renderPaused) return;
    if (sim.paramTargetIndex < 0 || sim.selectedIndex < 0) return;
    if (sim.paramTransitioning || sim.focusSettling) return;
    if (e.target?.closest?.(".lil-gui")) return;
    e.preventDefault();
    addScrollDelta(sim, e.deltaY);
  };
  listen(window, "wheel", onWheel, { passive: false });

  let touchY = 0;
  let touching = false;
  const onTouchStart = (e) => {
    if (!e.touches[0]) return;
    touching = true;
    touchY = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    if (!touching || !e.touches[0]) return;
    if (renderPaused) return;
    if (sim.paramTargetIndex < 0 || sim.selectedIndex < 0) return;
    if (sim.paramTransitioning || sim.focusSettling) return;
    const y = e.touches[0].clientY;
    const dy = touchY - y;
    touchY = y;
    if (Math.abs(dy) < 0.5) return;
    e.preventDefault();
    addScrollDelta(sim, dy);
  };
  const onTouchEnd = () => {
    touching = false;
  };
  listen(window, "touchstart", onTouchStart, { passive: true });
  listen(window, "touchmove", onTouchMove, { passive: false });
  listen(window, "touchend", onTouchEnd, { passive: true });
  listen(window, "touchcancel", onTouchEnd, { passive: true });

  function rebuildBlob(index) {
    sim.rebuildBlob(index);
    if (prefersReducedMotion) sim.warmup(STATIC_POSE_STEPS);
  }

  function resize(width, height) {
    if (width <= 0 || height <= 0) return;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);

    uniforms.uResolution.value.set(width, height);
    layoutScale = Math.min(width, height) / LAYOUT_REFERENCE;
    sim.setViewport(
      width / 2 / layoutScale,
      height / 2 / layoutScale,
      layoutScale,
    );
    forceDebug?.resize(width, height);

    // Refresh portrait/landscape focus frame when crossing the mobile breakpoint.
    const focusIdx =
      sim.paramTargetIndex >= 0 ? sim.paramTargetIndex : sim.selectedIndex;
    if (focusIdx >= 0 && sim.focusVideoW > 0 && sim.focusVideoH > 0) {
      sim.setFocusVideoAspect(focusIdx, sim.focusVideoW, sim.focusVideoH);
    }
  }

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    resize(width, height);
  });
  resizeObserver.observe(container);
  disposers.push(() => resizeObserver.disconnect());

  const rect = container.getBoundingClientRect();
  resize(rect.width, rect.height);

  let gestureHooked = false;

  function hookGesture() {
    if (gestureHooked) return;
    gestureHooked = true;
    const resume = () => videoManager.playPreviews();
    listen(window, "pointerdown", resume, { once: true });
    listen(window, "touchstart", resume, { once: true });
  }

  function playAll() {
    videoManager.playPreviews();
  }

  function pauseAll() {
    videoManager.pausePreviews();
  }

  if (prefersReducedMotion) pauseAll();
  else playAll();

  function syncUniforms() {
    const blobs = sim.blobs;
    const blobCount = blobs.length;

    for (let b = 0; b < blobCount; b++) {
      const blob = blobs[b];
      const bp = PARAMS.blobs[b];
      const circles = blob.circles;
      const count = Math.min(circles.length, MAX_PER_BLOB);

      for (let j = 0; j < count; j++) {
        const c = circles[j];
        const slot = (b * MAX_PER_BLOB + j) * 4;
        circleTex.data[slot] = c.x * layoutScale;
        circleTex.data[slot + 1] = c.y * layoutScale;
        circleTex.data[slot + 2] = c.anchorX * layoutScale;
        circleTex.data[slot + 3] = c.anchorY * layoutScale;
        circleMetaTex.data[slot] = c.radius * layoutScale;
        circleMetaTex.data[slot + 1] = c.angle;
        circleMetaTex.data[slot + 2] = c.scale;
      }

      countsArray[b] = count;
      const videoFrame = getBlendedVideoFrame(blob, sim, b);
      if (videoFrame) {
        blobCenterArray[b * 2] = videoFrame.centerX * layoutScale;
        blobCenterArray[b * 2 + 1] = videoFrame.centerY * layoutScale;
        blobFitArray[b * 2] = videoFrame.halfW * layoutScale;
        blobFitArray[b * 2 + 1] = videoFrame.halfH * layoutScale;
        videoContainArray[b] = videoFrame.contain;
      } else {
        blobCenterArray[b * 2] = blob.videoFrameCenterX * layoutScale;
        blobCenterArray[b * 2 + 1] = blob.videoFrameCenterY * layoutScale;
        blobFitArray[b * 2] = blob.videoFrameHalfW * layoutScale;
        blobFitArray[b * 2 + 1] = blob.videoFrameHalfH * layoutScale;
        videoContainArray[b] = 0;
      }
      boundsMinArray[b * 2] = blob.minX * layoutScale;
      boundsMinArray[b * 2 + 1] = blob.minY * layoutScale;
      boundsMaxArray[b * 2] = blob.maxX * layoutScale;
      boundsMaxArray[b * 2 + 1] = blob.maxY * layoutScale;
      displaceArray[b] = PARAMS.displaceAmount;
    }

    uniforms.uBlobCount.value = blobCount;
    circleTex.tex.needsUpdate = true;
    circleMetaTex.tex.needsUpdate = true;
    uniforms.uThreshold.value = PARAMS.threshold;
    uniforms.uEdgeSoftness.value = PARAMS.edgeSoftness;
    uniforms.uFalloff.value = PARAMS.falloff;
    uniforms.uUvSharpness.value = PARAMS.uvSharpness;
    uniforms.uInterfaceWidth.value = PARAMS.interfaceWidth;
    uniforms.uVideoStretch.value = PARAMS.videoStretch;
    uniforms.uUseFullTransform.value = PARAMS.useFullTransform;
    uniforms.uShowOutlines.value = PARAMS.showCircleOutlines ? 1 : 0;
    uniforms.uBlobColor.value.set(PARAMS.blobColor);
    uniforms.uMeniscus.value = PARAMS.meniscus ? PARAMS.meniscusBrightness : 0;
    uniforms.uMeniscusWidth.value = PARAMS.meniscusWidth;
    uniforms.uMeniscusEdgeFade.value = PARAMS.meniscusEdgeFade;
    uniforms.uMeniscusColor.value.set(PARAMS.meniscusColor);
    uniforms.uLayoutScale.value = layoutScale;
    const pairDest = uniforms.uPairMix.value;
    for (let i = 0; i < blobCount; i++) {
      for (let j = 0; j < blobCount; j++) {
        pairDest[i * shaderBlobCount + j] =
          sim.pairMix[sim.pairIndex(i, j)] || 0;
      }
    }
    uniforms.uVideoFull.value = videoManager.getFullTexture();
    uniforms.uFullIndex.value = videoManager.getFullIndex();
    uniforms.uFlowMaster.value = PARAMS.flowMaster;
    uniforms.uFlowScale.value = PARAMS.flowScale;
    uniforms.uFlowStrength.value = PARAMS.flowStrength;
    uniforms.uFlowSpeed.value = PARAMS.flowSpeed;
    uniforms.uFlowEdgeFade.value = PARAMS.flowEdgeFade;
    uniforms.uFocusZoom.value = Math.max(sim.focusZoom || 1, 1);

    const breaker = sim.breaker;
    const breakerOn = breaker?.active || 0;
    uniforms.uBreakerOn.value = breakerOn;
    uniforms.uBreakerCut.value = PARAMS.breakerCut;
    if (breakerOn > 0.001) {
      uniforms.uBreaker.value.set(
        breaker.x * layoutScale,
        breaker.y * layoutScale,
        0,
      );
      uniforms.uBreakerSize.value.set(
        (breaker.halfW || breaker.radius || 0) * layoutScale,
        (breaker.halfH || breaker.radius || 0) * layoutScale,
      );
    } else {
      uniforms.uBreaker.value.set(0, 0, 0);
      uniforms.uBreakerSize.value.set(0, 0);
    }
  }

  let running = true;
  let onScreen = true;
  let lastTime = performance.now();

  if (prefersReducedMotion) sim.warmup(STATIC_POSE_STEPS);

  function frame(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);

    if (!running || !onScreen) {
      lastTime = now;
      return;
    }

    if (renderPaused) {
      lastTime = now;
      const idx = sim.selectedIndex;
      if (idx >= 0) videoManager.tickTexture(idx);
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.25);
    lastTime = now;

    if (!prefersReducedMotion && !renderPaused) {
      sim.advance(dt);
      uniforms.uTime.value = sim.time;
    }

    const selectedIdx = sim.selectedIndex;
    videoManager.syncPreviewPlayback(
      selectedIdx,
      selectedIdx >= 0 && !videoManager.isFullTextureReady(selectedIdx),
    );
    videoManager.updateAtlas(now);
    if (selectedIdx >= 0) videoManager.tickTexture(selectedIdx);
    if (
      selectedIdx >= 0 &&
      sim.paramTargetIndex === selectedIdx &&
      videoManager.isFullTextureReady(selectedIdx)
    ) {
      videoBlendTarget[selectedIdx] = 1;
    }

    updateVideoCrossfade(dt);
    updateExitVideoReveal(dt);
    updateSelectBlink(dt);
    updateVideoFadeIn(dt);
    updatePlayButtonFade(dt);
    syncUniforms();
    forceDebug?.draw(sim, layoutScale);
    emitSelectionState();

    if (!renderPaused) renderer.render(scene, camera);
  }

  function updateRunState() {
    const active = running && onScreen && !disposed;
    if (active) {
      lastTime = performance.now();
      if (!prefersReducedMotion) playAll();
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else {
      pauseAll();
    }
  }

  listen(document, "visibilitychange", () => {
    running = document.visibilityState === "visible";
    updateRunState();
  });

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      updateRunState();
    },
    { threshold: 0 },
  );
  intersectionObserver.observe(canvas);
  disposers.push(() => intersectionObserver.disconnect());

  updateRunState();

  if (import.meta.dev) {
    import("./force-debug.js").then(({ createForceDebugOverlay }) => {
      if (disposed) return;
      forceDebug = createForceDebugOverlay(container);
      const { width, height } = container.getBoundingClientRect();
      forceDebug.resize(width, height);
    });

    import("./gui.js").then(({ initGUI }) => {
      if (disposed) return;
      guiController = initGUI({ sim, onRebuildBlob: rebuildBlob });
    });

    window.__BLOB = {
      PARAMS,
      sim,
      rebuildBlob,
      uniforms,
      material,
      renderer,
      tick: (dt = 1 / 60) => {
        sim.advance(dt);
        videoManager.updateAtlas();
        if (sim.selectedIndex >= 0) videoManager.tickTexture(sim.selectedIndex);
        syncUniforms();
        renderer.render(scene, camera);
      },
    };
  }

  function destroy() {
    if (disposed) return;
    disposed = true;

    cancelAnimationFrame(rafId);
    rafId = 0;

    guiController?.destroy();
    guiController = null;

    forceDebug?.destroy();
    forceDebug = null;

    for (const dispose of disposers) dispose();

    pauseAll();
    videoManager.destroy();

    material.dispose();
    geometry.dispose();
    circleTex.tex.dispose();
    circleMetaTex.tex.dispose();
    fallbackTexture.dispose();

    renderer.dispose();

    const gl = renderer.getContext();
    const loseExt = gl.getExtension("WEBGL_lose_context");
    loseExt?.loseContext();

    if (import.meta.dev && typeof window !== "undefined") {
      delete window.__BLOB;
    }
  }

  return {
    destroy,
    playSelectedVideo() {
      if (!canControlPlayback()) return;
      const idx = sim.selectedIndex;
      const video = idx >= 0 ? videoManager.getActiveVideo(idx) : null;
      if (!video || !video.paused) return;
      video.muted = false;
      video
        .play()
        .then(() => {
          fullVideoPlaying = true;
          emitSelectionState();
        })
        .catch(() => {});
    },
    toggleSelectedVideo,
    setFullscreenActive(active) {
      renderPaused = active;
      const idx = sim.selectedIndex;
      if (idx >= 0 && active) {
        const video = videoManager.getActiveVideo(idx);
        if (video && !video.paused) {
          video.pause();
          fullVideoPlaying = false;
        }
      }
      callbacks.onFullscreenChange?.(active);
      emitSelectionState();
    },
    setPlaying(active) {
      fullVideoPlaying = active;
      emitSelectionState();
    },
    setInfoBox(widthCss, heightCss) {
      setInfoBoxCss(sim, widthCss, heightCss);
    },
    clearSelection() {
      if (sim.paramTargetIndex < 0 && sim.selectedIndex < 0) return;
      sim.setFocus(-1);
      emitSelectionState();
    },
  };
}
