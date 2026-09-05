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

    <div v-show="hasInfo" ref="infoRef" class="blob-info" :class="{ 'blob-info--interactive': infoInteractive }" :style="{
      left: `${infoPanel.x}px`,
      top: `${infoPanel.y}px`,
      opacity: infoPanel.opacity,
    }" @pointerdown.stop @click.stop>
      <ProjectInfo :title="infoPanel.title" :date="infoPanel.date" :location="infoPanel.location"
        :category="infoPanel.category" :blocks="infoPanel.blocks" :credits="infoPanel.credits" />
    </div>

    <VideoPlayerBar :source-video="playerVideo" :visible="playerVisible" @fullscreen-change="onFullscreenChange"
      @playing-change="onPlayingChange" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useNuxtApp } from "#app";
import { useProjectStore } from "~/stores/project";

const projectStore = useProjectStore(useNuxtApp().$pinia);

const containerRef = ref(null);
const canvasRef = ref(null);
const infoRef = ref(null);

/** @type {ReturnType<import('~/lib/blob-engine.js').createBlobEngine> | null} */
let engine = null;
/** @type {ResizeObserver | null} */
let infoObserver = null;

const playButton = ref({ visible: false, x: 0, y: 0, opacity: 0 });
const playerVideo = ref(null);
const playerVisible = ref(false);
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
});

const hasInfo = computed(
  () =>
    Boolean(infoPanel.value.title) ||
    (Array.isArray(infoPanel.value.blocks) && infoPanel.value.blocks.length > 0) ||
    (Array.isArray(infoPanel.value.credits) && infoPanel.value.credits.length > 0),
);

/** Receive clicks/selection once the rising info is mostly on screen. */
const infoInteractive = computed(() => (infoPanel.value.opacity || 0) > 0.4);

function reportInfoBox() {
  const el = infoRef.value;
  if (!el || !engine) return;
  const rect = el.getBoundingClientRect();
  engine.setInfoBox(rect.width, rect.height);
}

function onSelectionState(state) {
  playButton.value = state.playButton;
  playerVideo.value = state.fullVideo;
  playerVisible.value = state.selectedIndex >= 0 && state.fullVideoReady;
  if (state.info) infoPanel.value = state.info;
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

watch(
  () => [infoPanel.value.title, infoPanel.value.blocks, infoPanel.value.credits, hasInfo.value],
  async () => {
    await nextTick();
    reportInfoBox();
  },
);

onMounted(async () => {
  console.log("[blob] BlobScene mounted");

  try {
    await projectStore.fetchAll();
    console.log("[blob] store projects after fetch", projectStore.projects);
  } catch (err) {
    console.warn("[blob] failed to load projects from Sanity", err);
  }

  try {
    const { createBlobEngine } = await import("~/lib/blob-engine.js");
    if (!canvasRef.value || !containerRef.value) {
      console.warn("[blob] canvas/container refs missing, engine not started");
      return;
    }

    console.log("[blob] creating engine with projects", projectStore.projects);
    engine = createBlobEngine(canvasRef.value, containerRef.value, {
      onSelectionState,
      projects: projectStore.projects,
    });
    console.log("[blob] engine created");

    await nextTick();
    if (infoRef.value && typeof ResizeObserver !== "undefined") {
      infoObserver = new ResizeObserver(() => reportInfoBox());
      infoObserver.observe(infoRef.value);
      reportInfoBox();
    }
  } catch (err) {
    console.error("[blob] engine init failed", err);
  }
});

onUnmounted(() => {
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

.blob-info {
  position: fixed;
  z-index: 100000;
  transform: translate(-50%, -50%);
  pointer-events: none;
  will-change: left, top, opacity;
  width: 70%;
}

.blob-info--interactive :deep(.project-info) {
  pointer-events: auto;
  user-select: text;
  cursor: auto;
}
</style>
