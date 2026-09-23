<template>
  <template v-for="(span, i) in spans" :key="span._key || i">
    <template v-if="span._type === 'span'">
      <a
        v-if="linkHref(span)"
        :href="linkHref(span)"
        :class="{ 'pt-link--mailto': isMailto(span) }"
        :target="isMailto(span) ? undefined : '_blank'"
        :rel="isMailto(span) ? undefined : 'noreferrer noopener'"
      ><component :is="innerTag(span)">{{ span.text }}</component></a>
      <component v-else :is="innerTag(span)">{{ span.text }}</component>
    </template>
  </template>
</template>

<script setup>
const props = defineProps({
  spans: { type: Array, default: () => [] },
  markDefs: { type: Array, default: () => [] },
});

function innerTag(span) {
  const marks = span.marks || [];
  if (marks.includes("em") && marks.includes("strong")) return "strong";
  if (marks.includes("em")) return "em";
  if (marks.includes("strong")) return "strong";
  return "span";
}

function linkHref(span) {
  const marks = span.marks || [];
  for (const key of marks) {
    const def = props.markDefs.find((d) => d._key === key && d._type === "link");
    if (def?.href) return def.href;
  }
  return "";
}

function isMailto(span) {
  return String(linkHref(span) || "").toLowerCase().startsWith("mailto:");
}
</script>
