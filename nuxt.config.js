export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },

  modules: ["@pinia/nuxt"],

  runtimeConfig: {
    public: {
      sanityProjectId: "24nn5cnq",
      sanityDataset: "production",
    },
  },

  nitro: {
    preset: "static",
  },

  app: {
    head: {
      title: "Emma Portner",
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
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
