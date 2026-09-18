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

    <div
      v-show="loadingDots.visible"
      class="blob-loading-dots"
      aria-hidden="true"
      :style="{ left: `${loadingDots.x}px`, top: `${loadingDots.y}px` }"
    >
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

    <VideoPlayerBar :source-video="playerVideo" :visible="playerVisible" :dimmed="playerDimmed"
      @fullscreen-change="onFullscreenChange" @playing-change="onPlayingChange" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useNuxtApp } from "#app";
import { useProjectStore } from "~/stores/project";
import { useSelectionUiStore } from "~/stores/selectionUi";

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
  selectionUi.setSelected(state.selectedIndex >= 0);
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

@media (max-width: 768px) {
  .blob-info {
    left: 50% !important;
    width: 100%;
    max-width: 100%;
    padding: 0 50px;
    overflow-x: clip;
    box-sizing: border-box;
  }
}
</style>
