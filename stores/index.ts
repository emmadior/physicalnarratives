import { defineStore } from "pinia";
// @ts-ignore
import { createSanityClient } from "~/lib/sanity/client";
// @ts-ignore
import { indexQuery } from "~/queries/index";

export interface IndexEntry {
  _id: string;
  title: string;
  date: string | null;
  location: string | null;
  category: string | null;
  credits: unknown[] | null;
  info: unknown[] | null;
  link: string | null;
}

export const useIndexStore = defineStore("index", {
  state: () => ({
    entries: [] as IndexEntry[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    ready: (state) => state.entries.length > 0 && !state.loading,
  },

  actions: {
    async fetchAll() {
      if (this.loading) return;

      this.loading = true;
      this.error = null;

      try {
        // @ts-ignore
        const config = useRuntimeConfig();
        const client = createSanityClient({
          projectId: config.public.sanityProjectId,
          dataset: config.public.sanityDataset,
        });
        this.entries = await client.fetch<IndexEntry[]>(indexQuery);
      } catch (err) {
        console.error("[index] fetch failed", err);
        this.error =
          err instanceof Error ? err.message : "Failed to load index";
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
