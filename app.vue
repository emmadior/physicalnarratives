<template>
  <div class="app">
    <div class="header-left">
      <NuxtLink to="/" class="logo" @click="onLogoClick">Emma Portner</NuxtLink>
      <button type="button" class="back-arrow" :class="{ 'back-arrow--visible': showBackArrow }"
        :tabindex="showBackArrow ? 0 : -1" aria-label="Close selection" @click="onBackClick">
        ←
      </button>
    </div>

    <div class="header-right">
      <div class="description">Physical Narratives</div>
      <div class="menu" :class="{ 'menu--open': menuOpen }">
        <button type="button" class="menu__toggle" :aria-expanded="menuOpen" @click="toggleMenu">
          Menu
        </button>
        <div class="menu__panel">
          <div class="menu__links">
            <NuxtLink class="menu__link" to="/" @click="closeMenu">Islands</NuxtLink>
            <NuxtLink class="menu__link" to="/index" @click="closeMenu">Index</NuxtLink>
            <NuxtLink class="menu__link" to="/info" @click="closeMenu">Info</NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <NuxtPage />
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useNuxtApp } from "#app";
import { useSelectionUiStore } from "~/stores/selectionUi";

const menuOpen = ref(false);
const route = useRoute();
const selectionUi = useSelectionUiStore(useNuxtApp().$pinia);
const config = useRuntimeConfig();
const requestURL = useRequestURL();

const siteOrigin = computed(() => {
  const configured = String(config.public.siteUrl || "").replace(/\/$/, "");
  return configured || requestURL.origin || "";
});

const shareImage = computed(() => {
  const origin = siteOrigin.value;
  return origin ? `${origin}/share.png` : "/share.png";
});

useHead({
  titleTemplate: (title) =>
    title ? `Emma Portner - ${title}` : "Emma Portner",
});

useSeoMeta({
  description: "Physical Narratives",
  ogSiteName: "Emma Portner",
  ogType: "website",
  ogDescription: "Physical Narratives",
  ogImage: shareImage,
  ogImageAlt: "Emma Portner — Physical Narratives",
  twitterCard: "summary_large_image",
  twitterDescription: "Physical Narratives",
  twitterImage: shareImage,
  themeColor: "#b2b2b2",
  robots: "index, follow",
});

const showBackArrow = computed(
  () => selectionUi.selected && (route.path === "/" || route.path === ""),
);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onBackClick() {
  if (!showBackArrow.value) return;
  window.dispatchEvent(new CustomEvent("emma:clear-selection"));
}

function onLogoClick(event) {
  if (!showBackArrow.value) return;
  event.preventDefault();
  onBackClick();
}

function onDocPointerDown(event) {
  if (!menuOpen.value) return;
  const menu = event.target?.closest?.(".menu");
  if (!menu) closeMenu();
}

watch(
  () => route.fullPath,
  () => closeMenu(),
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
});
</script>

<style>
@font-face {
  font-family: "Century";
  src: url("/fonts/century.otf") format("opentype");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  font-family: "Century", "Century Gothic", Georgia, serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: #f5f5f5;
  font-size: 14px;
}

button {
  font-size: 13px;
  font-family: "Century", "Century Gothic", Georgia, serif;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

a {
  color: inherit;
}

strong {
  font-weight: normal !important;
}

.app {
  width: 100%;
  height: 100%;
}

.header-left {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 20;
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: flex-start;
}

.logo {
  display: block;
  text-decoration: none;
  color: inherit;
}

.back-arrow {
  margin: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: 500ms ease;
  transform: translateX(50px);
  margin-top: 1px;
  display: inline-block;

}

.back-arrow--visible {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.back-arrow:focus {
  outline: none;
}

.header-right {
  flex-direction: column;
  align-items: flex-end;
}

.description {
  position: fixed;
  top: 20px;
  left: 50%;
  right: auto;
  text-align: center;
  z-index: 20;
}

.menu {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: fixed;
  z-index: 20;
  top: 20px;
  right: 20px;
  width: fit-content;
}

.menu__toggle {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;

  cursor: pointer;
}

.menu__toggle:focus {
  outline: none;
}

.menu__panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s ease;
}

.menu--open .menu__panel {
  grid-template-rows: 1fr;
}

.menu__links {
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;

  padding-top: 0;
  opacity: 0;
  transition: opacity 0.25s ease, padding-top 0.35s ease;

}

.menu--open .menu__links {

  opacity: 1;
}

.menu__link {
  text-decoration: none;
  color: inherit;
  opacity: 0;
  transition: opacity 1s ease;
}

.menu--open .menu__link {
  opacity: 1;
}

.menu__link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.3s;
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}

@media (min-width: 769px) {
  .description {
    position: fixed;
    top: 20px;
    left: 50%;
    right: auto;

    text-align: center;
  }

  .header-right {
    flex-direction: column;
    align-items: flex-end;
  }

  /* Keep Physical Narratives centered; Menu alone on the right */
  .header-right .description {
    position: fixed;
  }
}
</style>
