<template>
  <div v-if="hasContent" class="project-info">
    <div class="project-info__header">
      <p class="project-info__date">{{ date }}</p>
      <p class="project-info__category">{{ category }}</p>
      <p class="project-info__title">{{ title }}</p>
      <p class="project-info__location">{{ location }}</p>
    </div>

    <div class="project-info__content">
      <div v-if="groupedCredits.length || category" class="project-info__aside">
        <div v-if="category" class="project-info__category-block">
          <p class="project-info__category-value">{{ category }}</p>
        </div>

        <div v-if="groupedCredits.length" class="project-info__credits">
          <h2 class="project-info__section-label">Credits</h2>
          <template v-for="(item, i) in groupedCredits" :key="item._key || i">
            <ul v-if="item._type === 'list' && item.listItem === 'bullet'" class="project-info__list">
              <li v-for="(li, j) in item.items" :key="li._key || j">
                <PortableTextSpans :spans="li.children" :mark-defs="li.markDefs" />
              </li>
            </ul>
            <ol v-else-if="item._type === 'list' && item.listItem === 'number'" class="project-info__list">
              <li v-for="(li, j) in item.items" :key="li._key || j">
                <PortableTextSpans :spans="li.children" :mark-defs="li.markDefs" />
              </li>
            </ol>
            <blockquote v-else-if="item.style === 'blockquote'" class="project-info__quote">
              <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
            </blockquote>
            <h3 v-else-if="item.style === 'h2'" class="project-info__h2">
              <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
            </h3>
            <h4 v-else-if="item.style === 'h3'" class="project-info__h3">
              <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
            </h4>
            <p v-else class="project-info__p">
              <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
            </p>
          </template>
        </div>
      </div>

      <div v-if="groupedBody.length" class="project-info__body">
        <template v-for="(item, i) in groupedBody" :key="item._key || i">
          <ul v-if="item._type === 'list' && item.listItem === 'bullet'" class="project-info__list">
            <li v-for="(li, j) in item.items" :key="li._key || j">
              <PortableTextSpans :spans="li.children" :mark-defs="li.markDefs" />
            </li>
          </ul>
          <ol v-else-if="item._type === 'list' && item.listItem === 'number'" class="project-info__list">
            <li v-for="(li, j) in item.items" :key="li._key || j">
              <PortableTextSpans :spans="li.children" :mark-defs="li.markDefs" />
            </li>
          </ol>
          <blockquote v-else-if="item.style === 'blockquote'" class="project-info__quote">
            <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
          </blockquote>
          <h3 v-else-if="item.style === 'h2'" class="project-info__h2">
            <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
          </h3>
          <h4 v-else-if="item.style === 'h3'" class="project-info__h3">
            <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
          </h4>
          <p v-else class="project-info__p">
            <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
          </p>
        </template>
      </div>

      <div v-if="upcomingEntries.length" class="project-info__upcoming">
        <h2 class="project-info__upcoming-label">Upcoming:</h2>
        <div v-for="(entry, i) in upcomingEntries" :key="entry._key || i" class="project-info__upcoming-entry">
          <p v-if="entry.location" class="project-info__upcoming-location">
            {{ entry.location }}
          </p>
          <p v-for="(d, j) in entry.dates" :key="`${entry._key || i}-${j}`" class="project-info__upcoming-date">
            {{ d }}
          </p>
          <a v-if="entry.link" class="project-info__upcoming-more" :href="entry.link" target="_blank"
            rel="noopener noreferrer">
            more info
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import PortableTextSpans from "./PortableTextSpans.vue";

const props = defineProps({
  title: { type: String, default: "" },
  date: { type: String, default: null },
  location: { type: String, default: "" },
  category: { type: String, default: "" },
  credits: { type: Array, default: () => [] },
  blocks: { type: Array, default: () => [] },
  upcoming: { type: Array, default: () => [] },
});

const hasContent = computed(
  () =>
    Boolean(props.title) ||
    (Array.isArray(props.blocks) && props.blocks.length > 0) ||
    (Array.isArray(props.credits) && props.credits.length > 0) ||
    (Array.isArray(props.upcoming) && props.upcoming.length > 0),
);

const date = computed(() => {
  if (!props.date) return null;
  const d = new Date(props.date);
  return Number.isNaN(d.getTime())
    ? props.date
    : d.toLocaleDateString("en-GB", { year: "numeric" });
});

function formatDayMonthYear(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

const upcomingEntries = computed(() =>
  (props.upcoming || [])
    .map((entry) => ({
      _key: entry?._key,
      location: entry?.location || "",
      dates: (entry?.dates || []).map(formatDayMonthYear).filter(Boolean),
      link: entry?.link || "",
    }))
    .filter((entry) => entry.location || entry.dates.length || entry.link),
);

function groupBlocks(blocks) {
  const out = [];
  let list = null;
  for (const block of blocks || []) {
    if (!block || block._type !== "block") continue;
    if (block.listItem) {
      if (!list || list.listItem !== block.listItem) {
        list = {
          _type: "list",
          _key: block._key,
          listItem: block.listItem,
          items: [],
        };
        out.push(list);
      }
      list.items.push(block);
    } else {
      list = null;
      out.push(block);
    }
  }
  return out;
}

const groupedBody = computed(() => groupBlocks(props.blocks));
const groupedCredits = computed(() => groupBlocks(props.credits));
</script>

<style scoped>
.project-info {
  width: 100%;
  text-align: left;
  padding-top: 100px;
}

.project-info__category {
  text-transform: capitalize;
}

.project-info__header {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px;
  border-bottom: 1px solid #000;
  padding-bottom: 5px;
  margin-bottom: 5px;
  align-items: end;
}

.project-info__content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.project-info__upcoming {
  grid-column: 1;
}

.project-info__section-label {
  display: none;
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.project-info__upcoming-label {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.project-info__upcoming-entry {
  margin-top: 0.75em;
}

.project-info__upcoming-entry:first-of-type {
  margin-top: 0.35em;
}

.project-info__upcoming-location,
.project-info__upcoming-date,
.project-info__upcoming-more {
  margin: 0;
}

.project-info__upcoming-more {
  display: inline-block;
  color: inherit;
  text-underline-offset: 2px;
}

.project-info__credits+.project-info__upcoming {
  margin-top: 1em;
}

.project-info__body+.project-info__upcoming {
  margin-top: 0;
}

.project-info__category-block {
  display: none;
}

.project-info__credits .project-info__p:last-child,
.project-info__credits .project-info__list:last-child,
.project-info__credits .project-info__quote:last-child {
  margin-bottom: 0;
}

.project-info :deep(a) {
  color: inherit;
  text-underline-offset: 2px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .project-info {
    padding-top: 0;
  }

  .project-info__header {
    grid-template-columns: 1fr 1fr;
    border-bottom: none;
  }

  .project-info__date,
  .project-info__category {
    display: none;
  }

  .project-info__content {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .project-info__section-label {
    display: block;
    border-top: 1px solid #000;
    padding-top: 0.35em;
    margin-top: 0.75em;
    max-width: 100%;
    box-sizing: border-box;
  }

  .project-info__upcoming-label {
    border-top: 1px solid #000;
    padding-top: 0.35em;
    margin-top: 0.75em;
  }

  .project-info__header,
  .project-info__content,
  .project-info__aside,
  .project-info__credits,
  .project-info__upcoming,
  .project-info__body,
  .project-info__category-block {
    max-width: 100%;
    box-sizing: border-box;
  }

  .project-info__category-block {
    display: block;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    padding-top: 0.35em;
    padding-bottom: 0.35em;
    margin-bottom: 0.75em;
  }

  .project-info__category-block .project-info__section-label {
    border-top: none;
    padding-top: 0;
    margin-top: 0;
  }

  .project-info__category-block+.project-info__credits .project-info__section-label {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }

  .project-info__credits .project-info__section-label {
    margin-top: 0.5em;
  }

  .project-info__credits {
    border-bottom: 1px solid #000;
    padding-bottom: 0.35em;
    margin-bottom: 0.75em;
  }

  .project-info__upcoming {
    grid-column: auto;
  }

  .project-info__body+.project-info__upcoming {
    margin-top: 0;
  }

  .project-info__category-value {
    margin: 0;
    text-transform: capitalize;
  }
}
</style>
