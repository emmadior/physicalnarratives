export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: false },

  modules: ["@pinia/nuxt"],

  runtimeConfig: {
    public: {
      sanityProjectId: "24nn5cnq",
      sanityDataset: "production",
      /** Set NUXT_PUBLIC_SITE_URL in production for absolute OG/canonical URLs. */
      siteUrl: "",
    },
  },

  nitro: {
    preset: "static",
  },

  app: {
    head: {
      htmlAttrs: {
        lang: "en",
      },
      title: "Islands",
      titleTemplate: "Emma Portner - %s",
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          name: "description",
          content: "Physical Narratives",
        },
        {
          name: "author",
          content: "Emma Portner",
        },
        {
          name: "theme-color",
          content: "#b2b2b2",
        },
        {
          name: "robots",
          content: "index, follow",
        },
        // Open Graph
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Emma Portner" },
        { property: "og:title", content: "Emma Portner - Islands" },
        { property: "og:description", content: "Physical Narratives" },
        { property: "og:image", content: "/share.png" },
        { property: "og:image:alt", content: "Emma Portner — Physical Narratives" },
        // Twitter / X
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "Emma Portner - Islands" },
        { name: "twitter:description", content: "Physical Narratives" },
        { name: "twitter:image", content: "/share.png" },
      ],
      link: [
        { rel: "icon", href: "/favicon.ico", sizes: "any" },
        { rel: "apple-touch-icon", href: "/share.png" },
      ],
    },
  },

  vite: {
    resolve: {
      dedupe: ["pinia", "vue"],
    },
    optimizeDeps: {
      include: ["three"],
    },
  },
});
