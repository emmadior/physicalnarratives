<template>
  <div class="contact-page">
    <p v-if="error" class="contact-page__error">{{ error }}</p>

    <div class="contact-page__top">
      <div class="contact-page__label">Contact</div>
      <h1 class="contact-page__heading">Contact</h1>
    </div>

    <div class="contact-page__body">
      <div class="contact-page__spacer" aria-hidden="true" />
      <div class="contact-page__text">
        <PortableTextBlocks v-if="blocks.length" :blocks="blocks" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { createSanityClient } from "~/lib/sanity/client";
import { contactQuery } from "~/queries/contact";
import PortableTextBlocks from "~/components/PortableTextBlocks.vue";

definePageMeta({
  path: "/contact",
  key: "contact-page",
});

useSeoMeta({
  title: "Contact",
  ogTitle: "Emma Portner - Contact",
  twitterTitle: "Emma Portner - Contact",
});

const blocks = ref([]);
const error = ref(null);

onMounted(async () => {
  document.documentElement.classList.add("contact-route");
  document.body.classList.add("contact-route");

  try {
    const config = useRuntimeConfig();
    const client = createSanityClient({
      projectId: config.public.sanityProjectId,
      dataset: config.public.sanityDataset,
    });
    const doc = await client.fetch(contactQuery);
    blocks.value = Array.isArray(doc?.text) ? doc.text : [];
  } catch (err) {
    console.error("[contact] fetch failed", err);
    error.value =
      err instanceof Error ? err.message : "Failed to load contact";
  }
});

onUnmounted(() => {
  document.documentElement.classList.remove("contact-route");
  document.body.classList.remove("contact-route");
});
</script>

<style scoped>
.contact-page {
  min-height: 100%;
  padding: 76px 20px 64px;

  color: #000;
}

.contact-page__error {
  margin-bottom: 10px;
}

.contact-page__top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: end;
  padding-bottom: 5px;
  margin-bottom: 5px;
  border-bottom: 1px solid #000;
}

.contact-page__heading {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.contact-page__body {
  display: grid;
  grid-template-columns: 1fr 1fr;

}

.contact-page__text {
  min-width: 0;
}

.contact-page__text :deep(.pt-blocks__p) {
  margin: 0 0 10px;
}

@media (max-width: 768px) {
  .contact-page {
    padding: 75px 20px 48px;
  }

  .contact-page__top {
    grid-template-columns: auto 1fr;
    column-gap: 10px;
  }

  .contact-page__body {
    grid-template-columns: 1fr;
  }

  .contact-page__spacer {
    display: none;
  }
}
</style>

<style>
html.contact-route,
body.contact-route {
  overflow: auto;
  height: auto;
  min-height: 100%;
}

body.contact-route .app {
  height: auto;
  min-height: 100%;
}
</style>
