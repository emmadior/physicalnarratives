import { PARAMS } from "./uniforms.js";

/** Default blob sim params when CMS data is mapped onto a project. */
const BLOB_TEMPLATE = {
  circleCount: 22,
  minRadius: 60,
  maxRadius: 130,
  videoOpacity: 1.0,
};

/** Idle size is calibrated so this many blobs read ~10% smaller than the old fixed radii. */
const SIZE_REF_COUNT = 8;
const SIZE_REF_SCALE = 0.9;

/**
 * Scale blob radii by count: denser scenes shrink, sparse scenes grow.
 * sqrt keeps extremes softer than a linear 8/n.
 * @param {number} count
 */
export function blobSizeScaleForCount(count) {
  const n = Math.max(count, 1);
  return SIZE_REF_SCALE * Math.sqrt(SIZE_REF_COUNT / n);
}

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

  const sizeScale = blobSizeScaleForCount(eligible.length);

  PARAMS.blobs = eligible.map((project) => ({
    ...BLOB_TEMPLATE,
    minRadius: BLOB_TEMPLATE.minRadius * sizeScale,
    maxRadius: BLOB_TEMPLATE.maxRadius * sizeScale,
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
    count: PARAMS.blobs.length,
    sizeScale,
    minRadius: PARAMS.blobs[0]?.minRadius,
    maxRadius: PARAMS.blobs[0]?.maxRadius,
    blobs: PARAMS.blobs,
  });

  return PARAMS.blobs.length;
}
