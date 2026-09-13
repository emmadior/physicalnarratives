<template>
  <div class="info-page">
    <p v-if="error" class="info-page__error">{{ error }}</p>

    <div class="info-page__top">
      <div class="info-page__label">Info</div>
      <h1 class="info-page__heading">About Emma Portner</h1>
    </div>

    <div class="info-page__body">
      <div class="info-page__spacer" aria-hidden="true" />
      <div class="info-page__text">
        <PortableTextBlocks v-if="blocks.length" :blocks="blocks" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { createSanityClient } from "~/lib/sanity/client";
import { infoQuery } from "~/queries/info";
import PortableTextBlocks from "~/components/PortableTextBlocks.vue";

definePageMeta({
  path: "/info",
  key: "info-page",
});

const blocks = ref([]);
const error = ref(null);

onMounted(async () => {
  document.documentElement.classList.add("info-route");
  document.body.classList.add("info-route");

  try {
    const config = useRuntimeConfig();
    const client = createSanityClient({
      projectId: config.public.sanityProjectId,
      dataset: config.public.sanityDataset,
    });
    const doc = await client.fetch(infoQuery);
    blocks.value = Array.isArray(doc?.text) ? doc.text : [];
  } catch (err) {
    console.error("[info] fetch failed", err);
    error.value = err instanceof Error ? err.message : "Failed to load info";
  }
});

onUnmounted(() => {
  document.documentElement.classList.remove("info-route");
  document.body.classList.remove("info-route");
});
</script>

<style scoped>
.info-page {
  min-height: 100%;
  padding: 72px 20px 64px;
  background: var(--background-color, #dbdbdb);
  color: #000;
}

.info-page__error {
  margin-bottom: 1rem;
}

.info-page__top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: end;
  padding-bottom: 0.35em;
  border-bottom: 1px solid #000;
}

.info-page__heading {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.info-page__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding-top: 0.85em;
}

.info-page__text {
  min-width: 0;
}

.info-page__text :deep(.pt-blocks__p) {
  margin: 0 0 0.85em;
}

.info-page__text :deep(.pt-blocks__p + .pt-blocks__p) {
  text-indent: 1.5em;
}

@media (max-width: 768px) {
  .info-page {
    padding: 88px 20px 48px;
  }

  .info-page__top {
    grid-template-columns: auto 1fr;
    column-gap: 1.5rem;
  }

  .info-page__body {
    grid-template-columns: 1fr;
  }

  .info-page__spacer {
    display: none;
  }
}
</style>

<style>
html.info-route,
body.info-route {
  overflow: auto;
  height: auto;
  min-height: 100%;
}

body.info-route .app {
  height: auto;
  min-height: 100%;
}
</style>
