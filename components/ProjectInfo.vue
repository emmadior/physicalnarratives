<template>
  <div v-if="hasContent" class="project-info">
    <div class="project-info__header">
      <p v-if="date" class="project-info__date">{{ date }}</p>
            <p v-if="category" class="project-info__category">{{ category }}</p>
            <p v-if="title" class="project-info__title">{{ title }}</p>
      <p v-if="location" class="project-info__location">{{ location }}</p>

    </div>
    <div class="project-info__content">
      <div v-if="groupedCredits.length" class="project-info__credits">
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
});

const hasContent = computed(
  () =>
    Boolean(props.title) ||
    (Array.isArray(props.blocks) && props.blocks.length > 0) ||
    (Array.isArray(props.credits) && props.credits.length > 0),
);


const date = computed(() => {
  if (!props.date) return null;
  const d = new Date(props.date);
  return Number.isNaN(d.getTime()) ? props.date : d.toLocaleDateString("en-GB", { year: "numeric" });
});

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

.project-info__header {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px;
  border-bottom: 1px solid #000;
}

.project-info__content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
} 

.project-info__title {

}

.project-info__p,
.project-info__quote {
}

.project-info__quote {
}

.project-info__list {
}

.project-info__list li + li {

}

.project-info__credits {

}

.project-info__credits .project-info__p:last-child,
.project-info__credits .project-info__list:last-child,
.project-info__credits .project-info__quote:last-child {
  margin-bottom: 0;
}

.project-info :deep(a) {
  pointer-events: auto;
  color: inherit;
  text-underline-offset: 2px;
}
</style>
