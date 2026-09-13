<template>
  <div v-if="grouped.length" class="pt-blocks">
    <template v-for="(item, i) in grouped" :key="item._key || i">
      <ul
        v-if="item._type === 'list' && item.listItem === 'bullet'"
        class="pt-blocks__list"
      >
        <li v-for="(li, j) in item.items" :key="li._key || j">
          <PortableTextSpans :spans="li.children" :mark-defs="li.markDefs" />
        </li>
      </ul>
      <ol
        v-else-if="item._type === 'list' && item.listItem === 'number'"
        class="pt-blocks__list"
      >
        <li v-for="(li, j) in item.items" :key="li._key || j">
          <PortableTextSpans :spans="li.children" :mark-defs="li.markDefs" />
        </li>
      </ol>
      <blockquote
        v-else-if="item.style === 'blockquote'"
        class="pt-blocks__quote"
      >
        <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
      </blockquote>
      <h3 v-else-if="item.style === 'h2'" class="pt-blocks__h2">
        <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
      </h3>
      <h4 v-else-if="item.style === 'h3'" class="pt-blocks__h3">
        <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
      </h4>
      <p v-else class="pt-blocks__p">
        <PortableTextSpans :spans="item.children" :mark-defs="item.markDefs" />
      </p>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import PortableTextSpans from "./PortableTextSpans.vue";

const props = defineProps({
  blocks: { type: Array, default: () => [] },
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

const grouped = computed(() => groupBlocks(props.blocks));
</script>

<style scoped>
.pt-blocks__p,
.pt-blocks__quote,
.pt-blocks__h2,
.pt-blocks__h3,
.pt-blocks__list {
  margin: 0 0 0.75em;
}

.pt-blocks__p:last-child,
.pt-blocks__quote:last-child,
.pt-blocks__h2:last-child,
.pt-blocks__h3:last-child,
.pt-blocks__list:last-child {
  margin-bottom: 0;
}

.pt-blocks__list {
  padding-left: 1.1em;
}

.pt-blocks :deep(a) {
  color: inherit;
  text-underline-offset: 2px;
}
</style>
