<template>
  <div class="app">
    <div class="logo">Emma Portner</div>
    <div class="description">Physical narratives</div>
    <NuxtPage />
  </div>
</template>

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
  height: 100%;
  overflow: hidden;
  font-family: "Century", "Century Gothic", Georgia, serif;
  /* fonst smoothing */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --background-color: #dbdbdb;
  font-size: 14px;
}

button {
  font-size: 13px;
  font-family: "Century", "Century Gothic", Georgia, serif;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}

.app {
  width: 100%;
  height: 100%;
}

.logo {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 10;
}

.description {
  position: fixed;
  top: 20px;
  left: 50%;
  z-index: 10;
}
</style>
