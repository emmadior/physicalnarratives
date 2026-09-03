import { createClient } from "@sanity/client";

/**
 * @param {{ projectId: string, dataset: string, apiVersion?: string, useCdn?: boolean }} config
 */
export function createSanityClient(config) {
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion ?? "2026-01-01",
    useCdn: config.useCdn ?? true,
  });
}
