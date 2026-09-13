<template>
  <div class="index-page">
    <p v-if="indexStore.error" class="index-page__error">{{ indexStore.error }}</p>

    <div class="index-table">
      <div class="index-table__head">
        <button type="button" class="index-table__sort" @click="toggleYearSort" aria-label="Sort by year">
          Year
          <span class="index-table__arrows" aria-hidden="true">↑↓</span>
        </button>
        <span class="index-table__col index-table__col--category">Category</span>
        <span class="index-table__col index-table__col--title">Title</span>
        <span class="index-table__col index-table__col--place">Place</span>
      </div>

      <div v-for="entry in sortedEntries" :key="entry._id" class="index-row"
        :class="{ 'index-row--open': openId === entry._id }">
        <button type="button" class="index-row__main" @click="toggleRow(entry._id)">
          <span class="index-row__year">{{ yearOf(entry.date) }}</span>
          <span class="index-row__category">{{ labelCategory(entry.category) }}</span>
          <span class="index-row__title">{{ entry.title }}</span>
          <span class="index-row__place">{{ entry.location }}</span>
        </button>

        <div class="index-row__detail-wrap">
          <div class="index-row__detail">
            <div class="index-row__detail-grid">
              <div v-if="hasBlocks(entry.credits)" class="index-row__credits">
                <PortableTextBlocks :blocks="entry.credits" />
              </div>
              <div v-if="hasBlocks(entry.info)" class="index-row__info">
                <PortableTextBlocks :blocks="entry.info" />
              </div>
            </div>
            <a v-if="entry.link" class="index-row__more" :href="entry.link" target="_blank" rel="noopener noreferrer"
              @click.stop>
              more info
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useNuxtApp } from "#app";
import { useIndexStore } from "~/stores/index";
import PortableTextBlocks from "~/components/PortableTextBlocks.vue";

definePageMeta({
  path: "/index",
  key: "index-list",
});

const indexStore = useIndexStore(useNuxtApp().$pinia);
const openId = ref(null);
const yearSort = ref("desc");

const sortedEntries = computed(() => {
  const list = [...(indexStore.entries || [])];
  const dir = yearSort.value === "asc" ? 1 : -1;
  list.sort((a, b) => {
    const ay = a.date || "";
    const by = b.date || "";
    if (ay === by) return 0;
    return ay < by ? -dir : dir;
  });
  return list;
});

function yearOf(date) {
  if (!date) return "";
  const match = /^(\d{4})/.exec(date);
  if (match) return match[1];
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

function labelCategory(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasBlocks(blocks) {
  return Array.isArray(blocks) && blocks.length > 0;
}

function toggleYearSort() {
  yearSort.value = yearSort.value === "desc" ? "asc" : "desc";
}

function toggleRow(id) {
  openId.value = openId.value === id ? null : id;
}

onMounted(async () => {
  document.documentElement.classList.add("index-route");
  document.body.classList.add("index-route");
  try {
    await indexStore.fetchAll();
  } catch {
    /* error shown via store */
  }
});

onUnmounted(() => {
  document.documentElement.classList.remove("index-route");
  document.body.classList.remove("index-route");
});
</script>

<style scoped>
.index-page {
  min-height: 100%;
  padding: 72px 20px 48px;
  background: var(--background-color, #dbdbdb);
  color: #000;
}

.index-page__error {
  margin-bottom: 1rem;
}

.index-table__head {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  padding-bottom: 0.35em;
  border-bottom: 1px solid #000;
}

.index-table__sort {
  display: inline-flex;
  align-items: baseline;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.index-table__arrows {
  font-size: 0.75em;
  letter-spacing: -0.05em;
}

.index-row {
  color: #000;
  transition: color 0.3s ease, border-color 0.3s ease;
}

.index-row--open {
  color: #9749e5;

}

.index-row__main {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;

  align-items: center;
  width: 100%;
  height: 18.5px;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  line-height: 18.5px;
  text-align: left;
  cursor: pointer;
}

.index-row__main:focus {
  outline: none;
}

.index-row__detail-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.4s ease;
}

.index-row--open .index-row__detail-wrap {
  grid-template-rows: 1fr;
}

.index-row__detail {
  overflow: hidden;
  min-height: 0;
  padding: 0;
  border-top: 1px solid transparent;
  opacity: 0;
  transition:
    padding 0.4s ease,
    border-color 0.3s ease,
    opacity 0.3s ease;
}

.index-row--open .index-row__detail {
  padding: 0.55em 0 0.9em;
  border-top-color: currentColor;
  opacity: 1;
}

.index-row__detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;

}

.index-row__more {
  display: inline-block;
  margin-top: 0.75em;
  color: inherit;
  text-underline-offset: 2px;
}

@media (max-width: 768px) {
  .index-page {
    padding: 72px 20px 40px;
  }

  .index-row {
    border-bottom: 1px solid rgba(0, 0, 0, 1);
  }

  .index-table__head {
    grid-template-columns: 1fr 1fr;
  }

  .index-table__col--category,
  .index-table__col--place {
    display: none;
  }

  .index-row__main {
    grid-template-columns: 1fr 1fr;
  }

  .index-row__category,
  .index-row__place {
    display: none;
  }

  .index-row__detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
html.index-route,
body.index-route {
  overflow: auto;
  height: auto;
  min-height: 100%;
}

body.index-route .app {
  height: auto;
  min-height: 100%;
}
</style>
