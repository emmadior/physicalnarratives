<template>
  <div ref="containerRef" class="blob-scene">
    <canvas ref="canvasRef" class="blob-scene__canvas" aria-hidden="true" />

    <p v-if="projectStore.error" class="blob-scene__error">
      {{ projectStore.error }}
    </p>

    <button v-if="playButton.visible" type="button" class="blob-play-btn" :style="{
      left: `${playButton.x}px`,
      top: `${playButton.y}px`,
      opacity: playButton.opacity,
    }" aria-label="Play video" @click.stop="onPlayClick">
      <div aria-hidden="true" class="blob-play-btn__text">
        (PLAY)
      </div>
    </button>

    <div v-show="loadingDots.visible" class="blob-loading-dots" aria-hidden="true"
      :style="{ left: `${loadingDots.x}px`, top: `${loadingDots.y}px` }">
      <span class="blob-loading-dots__dot" />
      <span class="blob-loading-dots__dot" />
      <span class="blob-loading-dots__dot" />
    </div>

    <div v-show="hasInfo" ref="infoRef" class="blob-info" :class="{ 'blob-info--interactive': infoInteractive }" :style="{
      left: `${infoPanel.x}px`,
      top: `${infoPanel.y}px`,
      opacity: infoPanel.opacity,
    }" @pointerdown.stop @click.stop>
      <ProjectInfo :title="infoPanel.title" :date="infoPanel.date" :location="infoPanel.location"
        :category="infoPanel.category" :blocks="infoPanel.blocks" :credits="infoPanel.credits"
        :upcoming="infoPanel.upcoming" />
    </div>

    <div class="blob-scroll-hint" :class="{
      'blob-scroll-hint--visible': scrollHintVisible,
      'blob-scroll-hint--blink': scrollHintBlinking,
    }" role="status" aria-live="polite" :aria-hidden="scrollHintVisible ? 'false' : 'true'">
      <span class="blob-scroll-hint__dots" aria-hidden="true">
        <span class="blob-scroll-hint__dot" />
        <span class="blob-scroll-hint__dot" />
        <span class="blob-scroll-hint__dot" />
      </span>
      <p class="blob-scroll-hint__text">Scroll to read more</p>
    </div>

    <VideoPlayerBar :source-video="playerVideo" :visible="playerVisible" :dimmed="playerDimmed"
      @fullscreen-change="onFullscreenChange" @playing-change="onPlayingChange" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useNuxtApp } from "#app";
import { useProjectStore } from "~/stores/project";
import { useSelectionUiStore } from "~/stores/selectionUi";

const SCROLL_HINT_KEY = "emma:details-hint-seen";
const SCROLL_HINT_DELAY_MS = 3000;
const SCROLL_HINT_BLINK_AFTER_MS = 6000;
const SCROLL_HINT_BLINK_DURATION_MS = 3000;
/** Pause between blink cycles after the first one. */
const SCROLL_HINT_BLINK_GAP_MS = 3000;

const projectStore = useProjectStore(useNuxtApp().$pinia);
const selectionUi = useSelectionUiStore(useNuxtApp().$pinia);

const containerRef = ref(null);
const canvasRef = ref(null);
const infoRef = ref(null);

/** @type {ReturnType<import('~/lib/blob-engine.js').createBlobEngine> | null} */
let engine = null;
/** @type {ResizeObserver | null} */
let infoObserver = null;
/** Avoid restarting the engine more than once when FPS stays low. */
let perfAdapted = false;
/** @type {typeof import('~/lib/blob-engine.js').createBlobEngine | null} */
let createBlobEngine = null;

const playButton = ref({ visible: false, x: 0, y: 0, opacity: 0 });
const loadingDots = ref({ visible: false, x: 0, y: 0 });
const playerVideo = ref(null);
const playerVisible = ref(false);
const playerDimmed = ref(false);
const infoPanel = ref({
  visible: false,
  x: 0,
  y: 0,
  opacity: 0,
  title: "",
  date: null,
  location: "",
  category: "",
  blocks: [],
  credits: [],
  upcoming: [],
});

const scrollHintVisible = ref(false);
const scrollHintBlinking = ref(false);
/** Only the first blob click after load can schedule the hint. */
let scrollHintArmed = true;
/** @type {ReturnType<typeof setTimeout> | null} */
let scrollHintTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let scrollHintBlinkDelayTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let scrollHintBlinkEndTimer = null;
let scrollHintTouchY = 0;

function hasSeenScrollHint() {
  try {
    return localStorage.getItem(SCROLL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markScrollHintSeen() {
  try {
    localStorage.setItem(SCROLL_HINT_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

function clearScrollHintTimers() {
  if (scrollHintTimer != null) {
    clearTimeout(scrollHintTimer);
    scrollHintTimer = null;
  }
  if (scrollHintBlinkDelayTimer != null) {
    clearTimeout(scrollHintBlinkDelayTimer);
    scrollHintBlinkDelayTimer = null;
  }
  if (scrollHintBlinkEndTimer != null) {
    clearTimeout(scrollHintBlinkEndTimer);
    scrollHintBlinkEndTimer = null;
  }
}

function stopScrollHintBlink() {
  if (scrollHintBlinkDelayTimer != null) {
    clearTimeout(scrollHintBlinkDelayTimer);
    scrollHintBlinkDelayTimer = null;
  }
  if (scrollHintBlinkEndTimer != null) {
    clearTimeout(scrollHintBlinkEndTimer);
    scrollHintBlinkEndTimer = null;
  }
  scrollHintBlinking.value = false;
}

function runScrollHintBlinkCycle() {
  if (!scrollHintVisible.value) return;
  // Retrigger CSS animation if it already ran.
  scrollHintBlinking.value = false;
  requestAnimationFrame(() => {
    if (!scrollHintVisible.value) return;
    scrollHintBlinking.value = true;
    scrollHintBlinkEndTimer = setTimeout(() => {
      scrollHintBlinkEndTimer = null;
      scrollHintBlinking.value = false;
      if (!scrollHintVisible.value) return;
      scrollHintBlinkDelayTimer = setTimeout(() => {
        scrollHintBlinkDelayTimer = null;
        runScrollHintBlinkCycle();
      }, SCROLL_HINT_BLINK_GAP_MS);
    }, SCROLL_HINT_BLINK_DURATION_MS);
  });
}

function scheduleScrollHintBlink() {
  stopScrollHintBlink();
  scrollHintBlinkDelayTimer = setTimeout(() => {
    scrollHintBlinkDelayTimer = null;
    runScrollHintBlinkCycle();
  }, SCROLL_HINT_BLINK_AFTER_MS);
}

function dismissScrollHint() {
  if (!scrollHintVisible.value && !scrollHintBlinking.value) return;
  stopScrollHintBlink();
  scrollHintVisible.value = false;
  markScrollHintSeen();
  scrollHintArmed = false;
}

function scheduleScrollHint() {
  if (!scrollHintArmed || hasSeenScrollHint()) return;
  scrollHintArmed = false;
  clearScrollHintTimers();
  scrollHintBlinking.value = false;
  scrollHintTimer = setTimeout(() => {
    scrollHintTimer = null;
    if (!selectionUi.selected || hasSeenScrollHint()) {
      if (!hasSeenScrollHint()) scrollHintArmed = true;
      return;
    }
    scrollHintVisible.value = true;
    scheduleScrollHintBlink();
  }, SCROLL_HINT_DELAY_MS);
}

function onScrollHintWheel() {
  if (!scrollHintVisible.value) return;
  dismissScrollHint();
}

function onScrollHintTouchStart(e) {
  if (!scrollHintVisible.value || !e.touches?.[0]) return;
  scrollHintTouchY = e.touches[0].clientY;
}

function onScrollHintTouchMove(e) {
  if (!scrollHintVisible.value || !e.touches?.[0]) return;
  if (Math.abs(e.touches[0].clientY - scrollHintTouchY) < 8) return;
  dismissScrollHint();
}

const hasInfo = computed(
  () =>
    Boolean(infoPanel.value.title) ||
    (Array.isArray(infoPanel.value.blocks) && infoPanel.value.blocks.length > 0) ||
    (Array.isArray(infoPanel.value.credits) && infoPanel.value.credits.length > 0) ||
    (Array.isArray(infoPanel.value.upcoming) && infoPanel.value.upcoming.length > 0),
);

/** Receive clicks/selection once the rising info is mostly on screen. */
const infoInteractive = computed(() => (infoPanel.value.opacity || 0) > 0.4);

function reportInfoBox() {
  const el = infoRef.value;
  if (!el || !engine) return;
  const rect = el.getBoundingClientRect();
  engine.setInfoBox(rect.width, rect.height);
  updatePlayerOverlap();
}

/** Fade player controls while the rising info box intersects them. */
function updatePlayerOverlap() {
  if (!playerVisible.value || (infoPanel.value.opacity || 0) < 0.02) {
    playerDimmed.value = false;
    return;
  }
  const infoEl = infoRef.value;
  const controlsEl = containerRef.value?.querySelector(".player-controls");
  if (!infoEl || !controlsEl) {
    playerDimmed.value = false;
    return;
  }
  const a = infoEl.getBoundingClientRect();
  const b = controlsEl.getBoundingClientRect();
  if (b.height < 1) {
    playerDimmed.value = false;
    return;
  }
  const pad = 10;
  playerDimmed.value =
    a.bottom > b.top - pad && a.top < b.bottom + pad;
}

function onSelectionState(state) {
  playButton.value = state.playButton;
  loadingDots.value = state.loadingDots || { visible: false, x: 0, y: 0 };
  playerVideo.value = state.fullVideo;
  playerVisible.value = state.selectedIndex >= 0 && state.fullVideoReady;
  if (state.info) infoPanel.value = state.info;
  const wasSelected = selectionUi.selected;
  selectionUi.setSelected(state.selectedIndex >= 0);
  if (!wasSelected && state.selectedIndex >= 0) {
    scheduleScrollHint();
  }
  if (state.selectedIndex < 0) {
    clearScrollHintTimers();
    stopScrollHintBlink();
    // Tip never appeared — allow another attempt this session.
    if (!scrollHintVisible.value && !hasSeenScrollHint()) {
      scrollHintArmed = true;
    }
    scrollHintVisible.value = false;
  }
  updatePlayerOverlap();
}

function onPlayClick() {
  engine?.playSelectedVideo();
}

function onFullscreenChange(active) {
  engine?.setFullscreenActive(active);
}

function onPlayingChange(active) {
  engine?.setPlaying(active);
}

function onClearSelection() {
  engine?.clearSelection();
}

function bindInfoObserver() {
  infoObserver?.disconnect();
  infoObserver = null;
  if (infoRef.value && typeof ResizeObserver !== "undefined") {
    infoObserver = new ResizeObserver(() => reportInfoBox());
    infoObserver.observe(infoRef.value);
    reportInfoBox();
  }
}

/**
 * @param {{ lowPower?: boolean, maxBlobs?: number }} [opts]
 */
function startEngine(opts = {}) {
  if (!createBlobEngine || !canvasRef.value || !containerRef.value) return;

  engine?.destroy();
  engine = null;
  selectionUi.setSelected(false);

  engine = createBlobEngine(canvasRef.value, containerRef.value, {
    onSelectionState,
    onPerfDegrade: handlePerfDegrade,
    projects: projectStore.projects,
    lowPower: Boolean(opts.lowPower),
    maxBlobs: opts.maxBlobs,
  });
}

function handlePerfDegrade(info) {
  if (perfAdapted) return;
  perfAdapted = true;
  // Engine already culled blobs in-place (no WebGL recreate — that blanked
  // older Safari). This flag just prevents repeat work.
  console.warn("[blob] low-power adapt complete", info);
  engine?.adaptToLowPower?.();
}

watch(
  () => [
    infoPanel.value.title,
    infoPanel.value.blocks,
    infoPanel.value.credits,
    infoPanel.value.upcoming,
    hasInfo.value,
  ],
  async () => {
    await nextTick();
    reportInfoBox();
  },
);

onMounted(async () => {
  console.log("[blob] BlobScene mounted");
  window.addEventListener("emma:clear-selection", onClearSelection);
  window.addEventListener("wheel", onScrollHintWheel, { passive: true });
  window.addEventListener("touchstart", onScrollHintTouchStart, {
    passive: true,
  });
  window.addEventListener("touchmove", onScrollHintTouchMove, {
    passive: true,
  });

  if (hasSeenScrollHint()) scrollHintArmed = false;

  try {
    await projectStore.fetchAll();
    console.log("[blob] store projects after fetch", projectStore.projects);
  } catch (err) {
    console.warn("[blob] failed to load projects from Sanity", err);
  }

  try {
    const mod = await import("~/lib/blob-engine.js");
    createBlobEngine = mod.createBlobEngine;
    if (!canvasRef.value || !containerRef.value) {
      console.warn("[blob] canvas/container refs missing, engine not started");
      return;
    }

    console.log("[blob] creating engine with projects", projectStore.projects);
    const { readPerfDebugFlags, LOW_POWER_MAX_BLOBS } = await import(
      "~/lib/perf-adapt.js"
    );
    const flags = readPerfDebugFlags();
    if (flags.lowPower) {
      perfAdapted = true;
      startEngine({ lowPower: true, maxBlobs: LOW_POWER_MAX_BLOBS });
      console.log("[blob] engine created in lowPower mode (?lowPower=1)");
    } else {
      startEngine();
      console.log("[blob] engine created", flags.simLag ? "(simLag=1)" : "");
    }
    await nextTick();
    bindInfoObserver();
  } catch (err) {
    console.error("[blob] engine init failed", err);
  }
});

onUnmounted(() => {
  window.removeEventListener("emma:clear-selection", onClearSelection);
  window.removeEventListener("wheel", onScrollHintWheel);
  window.removeEventListener("touchstart", onScrollHintTouchStart);
  window.removeEventListener("touchmove", onScrollHintTouchMove);
  clearScrollHintTimers();
  stopScrollHintBlink();
  selectionUi.setSelected(false);
  infoObserver?.disconnect();
  infoObserver = null;
  engine?.destroy();
  engine = null;
});
</script>

<style scoped>
.blob-scene {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.blob-scene__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.blob-scene__error {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  font-size: 0.75rem;
  color: #333;
  pointer-events: none;
}

.blob-play-btn {
  position: fixed;
  z-index: 15;
  transform: translate(-50%, -50%);
  border: none;
  padding: 0;
  background: none;
  cursor: pointer;
  pointer-events: auto;
  will-change: opacity;
  display: none;
}

.blob-play-btn:focus {
  outline: none;
}

.blob-play-btn__text {
  color: #fff;
}

.blob-loading-dots {
  position: fixed;
  z-index: 14;
  display: flex;
  align-items: center;
  gap: 3px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.blob-loading-dots__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #fff;
  opacity: 0.25;
  animation: blob-loading-blink 1.2s ease-in-out infinite;
}

.blob-loading-dots__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.blob-loading-dots__dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blob-loading-blink {

  0%,
  100% {
    opacity: 0.2;
  }

  50% {
    opacity: 1;
  }
}

.blob-info {
  position: fixed;
  z-index: 100000;
  transform: translate(-50%, -50%);
  pointer-events: none;
  will-change: left, top, opacity;
  width: 70%;
  box-sizing: border-box;
}

.blob-info--interactive :deep(.project-info) {
  pointer-events: auto;
  user-select: text;
  cursor: auto;
}

.blob-scroll-hint {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(280px, calc(100vw - 40px));
  color: #000;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.6s ease, visibility 0.6s ease;
}

.blob-scroll-hint--visible {
  opacity: 1;
  visibility: visible;
}

.blob-scroll-hint__dots {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: none;
}

.blob-scroll-hint__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #000;
  opacity: 0.15;
  animation: blob-scroll-hint-dot-blink 1.2s ease-in-out infinite;
}

.blob-scroll-hint__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.blob-scroll-hint__dot:nth-child(3) {
  animation-delay: 0.4s;
}

.blob-scroll-hint--blink {
  animation: blob-scroll-hint-lift 1s ease-in-out 3;
}

@keyframes blob-scroll-hint-dot-blink {

  0%,
  100% {
    opacity: 0.15;
  }

  50% {
    opacity: 1;
  }
}

@keyframes blob-scroll-hint-lift {

  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-20px);
  }
}

.blob-scroll-hint__text {
  margin: 0;
  line-height: 1.35;
}

@media (max-width: 768px) {
  .blob-info {
    left: 50% !important;
    width: 100%;
    max-width: 100%;
    padding: 0 50px;
    overflow-x: clip;
    box-sizing: border-box;
  }

  .blob-scroll-hint {
    bottom: 70px;
    right: 50px;
  }
}
</style>
