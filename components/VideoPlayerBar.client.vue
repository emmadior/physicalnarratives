<template>
  <div ref="playerContainer" class="player-root" :class="{
    'player-root--visible': visible,
    'player-root--fullscreen': isFullscreen,
    'player-root--hide-cursor': isFullscreen && !showControls,
  }">
    <div class="player-fs-backdrop" :class="{ 'player-fs-backdrop--active': isFullscreen }">
      <video ref="displayVideoRef" class="player-fs-video" playsinline preload="auto" @click="togglePlay"
        @mousemove="handleMouseMove" />
      <div v-if="isLoading" class="player-loading">…</div>
    </div>

    <div class="player-controls" :class="{ 'player-controls--hidden': !controlsVisible }" @mouseover="handleMouseMove"
      @mouseleave="handleMouseLeave">
      <div class="player-controls__inner">
        <div ref="timelineRef" class="player-timeline" @click="seek" @mousemove="handleTimelineHover"
          @mouseleave="handleTimelineLeave" @touchstart.prevent="handleTouchStart" @touchmove.prevent="handleTouchMove"
          @touchend="handleTouchEnd">
          <div class="player-timeline__track">
            <div class="player-timeline__progress" :style="{ width: `${progress}%` }" />
            <div class="player-timeline__knob" :style="{ left: `${progress}%` }" />
          </div>
        </div>

        <div class="player-controls__row">
          <div class="player-time">{{ displayTime }}</div>

          <div class="player-transport">
            <button type="button" class="player-btn" :class="{ 'player-btn--active': isPlaying }" @click="togglePlay"
              aria-label="Play">
              Play
            </button>
            <button type="button" class="player-btn" :class="{ 'player-btn--active': !isPlaying }" @click="togglePlay"
              aria-label="Pause">
              Pause
            </button>
          </div>

          <button type="button" class="player-btn player-btn--fs" @click="toggleFullscreen"
            :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'">
            <div v-if="!isFullscreen" class="player-fs-icon" viewBox="0 0 32 32" width="24" height="24"
              aria-hidden="true">
              Fullscreen
            </div>

            <div v-else class="player-fs-icon" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
              Exit
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";

const props = defineProps({
  /** Off-screen video feeding the shader. */
  sourceVideo: { type: Object, default: null },
  visible: { type: Boolean, default: false },
});

const emit = defineEmits(["fullscreen-change", "playing-change"]);

const playerContainer = ref(null);
const displayVideoRef = ref(null);
const timelineRef = ref(null);

const isPlaying = ref(false);
const progress = ref(0);
const duration = ref(0);
const currentTime = ref(0);
const hoverTime = ref(0);
const isHovering = ref(false);
const isFullscreen = ref(false);
const isScrubbing = ref(false);
const isLoading = ref(false);
const showControls = ref(true);
const isMobile = ref(false);

let controlsTimeout = 0;
let loadingTimeout = 0;
let progressRaf = 0;
/** @type {(() => void) | null} */
let sourceListeners = null;

const controlsVisible = computed(() => props.visible && (!isFullscreen.value || showControls.value));

const displayTime = computed(() =>
  formatTime(isHovering.value ? hoverTime.value : currentTime.value)
);

function formatTime(timeInSeconds) {
  if (!Number.isFinite(timeInSeconds)) return "00:00";
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getActiveVideo() {
  return isFullscreen.value ? displayVideoRef.value : props.sourceVideo;
}

/** Keep the fullscreen element warm so entering FS does not reload the URL. */
function prepareDisplayVideo(src = props.sourceVideo) {
  const dst = displayVideoRef.value;
  if (!dst || !src?.src) return;
  if (dst.src !== src.src) {
    dst.src = src.src;
    dst.load();
  }
}

function updateProgress() {
  const video = getActiveVideo();
  if (!video || !Number.isFinite(video.duration)) return;
  currentTime.value = video.currentTime;
  duration.value = video.duration;
  progress.value = Math.min(100, Math.max(0, (video.currentTime / video.duration) * 100));
  if (!video.paused) progressRaf = requestAnimationFrame(updateProgress);
}

function togglePlay() {
  const video = getActiveVideo();
  const source = props.sourceVideo;
  if (!video || !source) return;

  if (video.paused) {
    video.muted = false;
    video
      .play()
      .then(() => {
        isPlaying.value = true;
        emit("playing-change", true);
        if (isFullscreen.value) {
          source.currentTime = video.currentTime;
        } else if (displayVideoRef.value) {
          displayVideoRef.value.currentTime = video.currentTime;
        }
        resetControlsTimeout();
        progressRaf = requestAnimationFrame(updateProgress);
      })
      .catch(() => { });
  } else {
    video.pause();
    if (isFullscreen.value) {
      source.currentTime = video.currentTime;
    } else if (displayVideoRef.value) {
      displayVideoRef.value.currentTime = video.currentTime;
    }
    isPlaying.value = false;
    emit("playing-change", false);
    showControls.value = true;
    clearTimeout(controlsTimeout);
    cancelAnimationFrame(progressRaf);
  }
}

function seek(event) {
  const video = props.sourceVideo;
  const timeline = timelineRef.value;
  if (!video || !timeline || !Number.isFinite(video.duration)) return;
  const rect = timeline.getBoundingClientRect();
  const pos = Math.max(0, Math.min((event.clientX - rect.left) / rect.width, 1));
  const time = pos * video.duration;
  video.currentTime = time;
  if (displayVideoRef.value) displayVideoRef.value.currentTime = time;
  updateProgress();
}

function handleTimelineHover(event) {
  const video = props.sourceVideo;
  const timeline = timelineRef.value;
  if (!video || !timeline || !Number.isFinite(video.duration)) return;
  const rect = timeline.getBoundingClientRect();
  const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
  hoverTime.value = (x / rect.width) * video.duration;
  isHovering.value = true;
  timeline.style.setProperty("--x-position", `${x}px`);
  timeline.style.setProperty("--hover-time", `"${formatTime(hoverTime.value)}"`);
}

function handleTimelineLeave() {
  isHovering.value = false;
}

function handleTouchStart(event) {
  isScrubbing.value = true;
  handleTouchMove(event);
}

function handleTouchMove(event) {
  const video = props.sourceVideo;
  const timeline = timelineRef.value;
  if (!isScrubbing.value || !video || !timeline) return;
  const touch = event.touches[0];
  const rect = timeline.getBoundingClientRect();
  const pos = Math.max(0, Math.min((touch.clientX - rect.left) / rect.width, 1));
  if (Number.isFinite(video.duration)) {
    const time = pos * video.duration;
    video.currentTime = time;
    if (displayVideoRef.value) displayVideoRef.value.currentTime = time;
  }
}

function handleTouchEnd() {
  isScrubbing.value = false;
}

function resetControlsTimeout() {
  clearTimeout(controlsTimeout);
  if (isPlaying.value && isFullscreen.value) {
    controlsTimeout = window.setTimeout(() => {
      showControls.value = false;
    }, 2000);
  }
}

function handleMouseMove() {
  showControls.value = true;
  resetControlsTimeout();
}

function handleMouseLeave() {
  if (isPlaying.value && isFullscreen.value) {
    clearTimeout(controlsTimeout);
    showControls.value = false;
  }
}

function toggleFullscreen() {
  if (isMobile.value) {
    const video = displayVideoRef.value || props.sourceVideo;
    if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else if (video?.requestFullscreen) video.requestFullscreen();
    return;
  }

  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    playerContainer.value?.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

async function enterFullscreenState() {
  const src = props.sourceVideo;
  const dst = displayVideoRef.value;
  if (!src || !dst) return;

  const wasPlaying = !src.paused;
  const time = src.currentTime;

  prepareDisplayVideo(src);
  dst.currentTime = time;
  dst.muted = false;

  src.pause();

  isFullscreen.value = true;
  document.body.style.overflow = "hidden";
  showControls.value = true;
  emit("fullscreen-change", true);

  if (wasPlaying) {
    try {
      await dst.play();
      isPlaying.value = true;
      emit("playing-change", true);
      progressRaf = requestAnimationFrame(updateProgress);
    } catch {
      isPlaying.value = false;
    }
  } else {
    isPlaying.value = false;
  }

  clearLoading();
  updateProgress();
  resetControlsTimeout();
}

function exitFullscreenState() {
  const src = props.sourceVideo;
  const dst = displayVideoRef.value;

  if (src && dst) {
    const wasPlaying = !dst.paused;
    src.currentTime = dst.currentTime;
    dst.pause();

    if (wasPlaying) {
      src.play().catch(() => { });
      isPlaying.value = true;
      emit("playing-change", true);
      progressRaf = requestAnimationFrame(updateProgress);
    } else {
      isPlaying.value = false;
      emit("playing-change", false);
    }
  }

  isFullscreen.value = false;
  document.body.style.overflow = "";
  showControls.value = true;
  clearTimeout(controlsTimeout);
  clearLoading();
  emit("fullscreen-change", false);
  updateProgress();
}

function handleFullscreenChange() {
  const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (active) enterFullscreenState();
  else exitFullscreenState();
}

function handleVideoEnd() {
  const video = props.sourceVideo;
  if (!video) return;
  video.currentTime = 0.01;
  video.pause();
  isPlaying.value = false;
  emit("playing-change", false);
}

function scheduleLoading() {
  if (isFullscreen.value && displayVideoRef.value?.readyState >= 2) return;
  clearTimeout(loadingTimeout);
  loadingTimeout = window.setTimeout(() => {
    isLoading.value = true;
  }, 150);
}

function clearLoading() {
  clearTimeout(loadingTimeout);
  isLoading.value = false;
}

function bindSource(video) {
  unbindSource();
  if (!video) return;

  const onTimeUpdate = () => updateProgress();
  const onPlay = () => {
    isPlaying.value = true;
    emit("playing-change", true);
    progressRaf = requestAnimationFrame(updateProgress);
    clearLoading();
  };
  const onPause = () => {
    if (isFullscreen.value) return;
    isPlaying.value = false;
    emit("playing-change", false);
    cancelAnimationFrame(progressRaf);
  };
  const onLoaded = () => {
    duration.value = video.duration || 0;
    updateProgress();
  };
  const onEnded = () => handleVideoEnd();
  const onWaiting = () => scheduleLoading();
  const onPlaying = () => clearLoading();
  const onCanPlay = () => clearLoading();
  const onSeeking = () => scheduleLoading();
  const onSeeked = () => clearLoading();
  const onWebkitBegin = () => enterFullscreenState();
  const onWebkitEnd = () => {
    exitFullscreenState();
    isPlaying.value = false;
    emit("playing-change", false);
  };

  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("loadedmetadata", onLoaded);
  video.addEventListener("ended", onEnded);
  video.addEventListener("waiting", onWaiting);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("canplay", onCanPlay);
  video.addEventListener("seeking", onSeeking);
  video.addEventListener("seeked", onSeeked);
  video.addEventListener("webkitbeginfullscreen", onWebkitBegin);
  video.addEventListener("webkitendfullscreen", onWebkitEnd);

  sourceListeners = () => {
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("play", onPlay);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("loadedmetadata", onLoaded);
    video.removeEventListener("ended", onEnded);
    video.removeEventListener("waiting", onWaiting);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("canplay", onCanPlay);
    video.removeEventListener("seeking", onSeeking);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("webkitbeginfullscreen", onWebkitBegin);
    video.removeEventListener("webkitendfullscreen", onWebkitEnd);
  };

  if (video.readyState >= 1) onLoaded();
  isPlaying.value = !video.paused;
  nextTick(() => prepareDisplayVideo(video));
}

function unbindSource() {
  sourceListeners?.();
  sourceListeners = null;
}

function handleKeydown(event) {
  if (!props.visible || !props.sourceVideo) return;
  if (event.target?.tagName === "INPUT" || event.target?.tagName === "TEXTAREA") return;

  switch (event.code) {
    case "Space":
      event.preventDefault();
      togglePlay();
      break;
    case "KeyM":
      if (props.sourceVideo) props.sourceVideo.muted = !props.sourceVideo.muted;
      break;
    case "ArrowLeft": {
      const video = props.sourceVideo;
      if (!video) break;
      const time = Math.max(0, video.currentTime - 5);
      video.currentTime = time;
      if (displayVideoRef.value) displayVideoRef.value.currentTime = time;
      updateProgress();
      break;
    }
    case "ArrowRight": {
      const video = props.sourceVideo;
      if (!video) break;
      const time = Math.min(video.duration, video.currentTime + 5);
      video.currentTime = time;
      if (displayVideoRef.value) displayVideoRef.value.currentTime = time;
      updateProgress();
      break;
    }
    default:
      break;
  }
}

watch(
  () => props.sourceVideo,
  (video) => {
    bindSource(video);
  },
  { immediate: true }
);

watch(
  () => props.visible,
  (visible) => {
    if (visible) nextTick(() => prepareDisplayVideo());
  }
);

onMounted(() => {
  isMobile.value = window.innerWidth < 768;
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  window.addEventListener("keydown", handleKeydown);
  nextTick(() => prepareDisplayVideo());
});

onUnmounted(() => {
  unbindSource();
  cancelAnimationFrame(progressRaf);
  clearTimeout(controlsTimeout);
  clearTimeout(loadingTimeout);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
  window.removeEventListener("keydown", handleKeydown);
  document.body.style.overflow = "";
});

defineExpose({ togglePlay, toggleFullscreen });
</script>

<style scoped>
.player-root {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.player-root--visible {
  opacity: 1;
  pointer-events: auto;
}

.player-root--fullscreen {
  inset: 0;
  background: black;
}

.player-root--hide-cursor,
.player-root--hide-cursor * {
  cursor: none !important;
}

.player-fs-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  visibility: hidden;
  pointer-events: none;
}

.player-fs-backdrop--active {
  visibility: visible;
  pointer-events: auto;
}

.player-fs-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: black;
}

.player-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 24px;
  pointer-events: none;
}

.player-controls {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 24px;
  width: min(720px, calc(100% - 40px));
  padding: 0;
  font-family: "Century", "Century Gothic", Georgia, serif;
  font-size: 13px;
  color: #000;
  transition: opacity 0.2s ease;
}

.player-root--fullscreen .player-controls {
  bottom: 25px;
  width: min(720px, 60%);
  z-index: 2;
  padding: 10px 12px;
  background: var(--background-color, #dbdbdb);
}

.player-controls--hidden {
  opacity: 0;
  pointer-events: none;
}

.player-controls__inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.player-controls__row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  width: 100%;
}

.player-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  line-height: 1;
}

.player-btn:focus {
  outline: none;
}

.player-btn--active {
  opacity: 0.3;
}

.player-transport {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65em;
}

.player-btn--fs {
  justify-self: end;

}

.player-fs-icon {
  display: block;
}

.player-time {
  justify-self: start;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.player-timeline {
  width: 100%;
  height: 16px;
  display: flex;
  align-items: center;
  position: relative;
  cursor: pointer;
  touch-action: none;
}

.player-timeline__track {
  position: relative;
  width: 100%;
  height: 1px;
  background: rgba(0, 0, 0, 0.22);
}

.player-timeline__progress {
  height: 100%;
  background: #000;
}

.player-timeline__knob {
  position: absolute;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #000;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.player-timeline::before {
  content: "";
  position: absolute;
  height: 7px;
  width: 1px;
  background: rgba(0, 0, 0, 0.8);
  top: 5px;
  left: var(--x-position, -100px);
  pointer-events: none;
  opacity: 0;

  transition: opacity 0.2s;
  border-radius: 10px;
}

.player-timeline::after {
  content: var(--hover-time, "");
  position: absolute;
  top: -12px;
  font-size: 10px;
  left: var(--x-position, -100px);
  transform: translateX(-50%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.player-timeline:hover::before,
.player-timeline:hover::after {
  opacity: 1;
}

@media (max-width: 768px) {

  .player-timeline::before,
  .player-timeline::after {
    display: none;
  }

  .player-timeline__track {
    height: 2px;
  }

  .player-timeline__knob {
    width: 7px;
    height: 7px;
  }
}
</style>
