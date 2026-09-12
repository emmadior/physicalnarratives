import { defineStore } from "pinia";
// @ts-ignore
import { createSanityClient } from "~/lib/sanity/client";
// @ts-ignore
import { projectsQuery } from "~/queries/project";

export interface UpcomingEntry {
  location: string | null;
  dates: string[] | null;
  link: string | null;
}

export interface Project {
  _id: string;
  title: string;
  slug: string;
  date: string | null;
  location: string | null;
  category: string | null;
  upcoming: UpcomingEntry[] | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  vimeoLink: string | null;
  info: unknown[] | null;
  credits: unknown[] | null;
}

export const useProjectStore = defineStore("project", {
  state: () => ({
    projects: [] as Project[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    ready: (state) => state.projects.length > 0 && !state.loading,
  },

  actions: {
    async fetchAll() {
      if (this.loading) return;

      this.loading = true;
      this.error = null;

      try {
        // @ts-ignore
        const config = useRuntimeConfig();
        console.log("[projects] fetching from Sanity", {
          projectId: config.public.sanityProjectId,
          dataset: config.public.sanityDataset,
        });
        const client = createSanityClient({
          projectId: config.public.sanityProjectId,
          dataset: config.public.sanityDataset,
        });
        this.projects = await client.fetch<Project[]>(projectsQuery);
        console.log("[projects] loaded", {
          count: this.projects.length,
          projects: this.projects,
        });
      } catch (err) {
        console.error("[projects] fetch failed", err);
        this.error =
          err instanceof Error ? err.message : "Failed to load projects";
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
