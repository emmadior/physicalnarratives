import { PARAMS } from "./uniforms.js";

/** Shared idle shape — every project starts identical. */
const BASE_CIRCLE_COUNT = 40;
const BASE_RADIUS = 100;

/**
 * Population where the stage should read ~20% zoomed out vs base radius at 1×.
 * Zoom scales with √n so packing density stays roughly even as projects are added.
 */
const REF_BLOB_COUNT = 8;
const REF_SIZE_SCALE = 0.8;

/**
 * On-screen size factor (1 = base). At 8 blobs → 0.8 (20% smaller).
 * @param {number} count
 */
export function populationSizeScale(count) {
  const n = Math.max(count, 1);
  return REF_SIZE_SCALE * Math.sqrt(REF_BLOB_COUNT / n);
}

/**
 * Layout-reference multiplier: >1 zooms the camera out (bigger stage).
 * Inverse of size scale so radius stays at BASE_RADIUS in sim units.
 * @param {number} count
 */
export function populationLayoutBoost(count) {
  return 1 / populationSizeScale(count);
}

/** Default blob sim params when CMS data is mapped onto a project. */
const BLOB_TEMPLATE = {
  circleCount: BASE_CIRCLE_COUNT,
  minRadius: BASE_RADIUS,
  maxRadius: BASE_RADIUS,
  videoOpacity: 1.0,
};

/**
 * Map Sanity projects onto simulation blob slots (preview → idle, vimeo → selected).
 *
 * @param {import('~/stores/project').Project[]} projects
 */
export function applyProjectsToParams(projects) {
  console.log("[projects] applyProjectsToParams input", {
    count: projects.length,
    projects,
  });

  const eligible = projects.filter((p) => Boolean(p.vimeoLink));

  if (eligible.length < projects.length) {
    console.warn("[projects] some projects skipped (missing vimeoLink)", {
      total: projects.length,
      eligible: eligible.length,
      skipped: projects.filter((p) => !p.vimeoLink),
    });
  }

  const count = eligible.length;
  PARAMS.populationLayoutBoost = populationLayoutBoost(count);

  PARAMS.blobs = eligible.map((project) => ({
    ...BLOB_TEMPLATE,
    circleCount: BASE_CIRCLE_COUNT,
    minRadius: BASE_RADIUS,
    maxRadius: BASE_RADIUS,
    /** Idle atlas: thumbnail, else preview video, else full-video first frame. */
    thumbnail: project.thumbnailUrl || null,
    video: project.previewUrl || null,
    videoFull: project.vimeoLink,
    projectId: project._id,
    title: project.title,
    slug: project.slug,
    date: project.date,
    location: project.location || "",
    category: project.category || "",
    info: project.info || [],
    credits: project.credits || [],
    upcoming: project.upcoming || [],
  }));

  console.log("[projects] PARAMS.blobs", {
    count,
    radius: BASE_RADIUS,
    sizeScale: populationSizeScale(count),
    layoutBoost: PARAMS.populationLayoutBoost,
    blobs: PARAMS.blobs,
  });

  return PARAMS.blobs.length;
}
