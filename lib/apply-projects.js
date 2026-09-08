import { PARAMS } from "./uniforms.js";

/** Default blob sim params when CMS data is mapped onto a project. */
const BLOB_TEMPLATE = {
  circleCount: 22,
  minRadius: 60,
  maxRadius: 130,
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

  const eligible = projects.filter((p) => p.previewUrl && p.vimeoLink);

  if (eligible.length < projects.length) {
    console.warn(
      "[projects] some projects skipped (missing previewUrl or vimeoLink)",
      {
        total: projects.length,
        eligible: eligible.length,
        skipped: projects.filter((p) => !p.previewUrl || !p.vimeoLink),
      },
    );
  }

  PARAMS.blobs = eligible.map((project) => ({
    ...BLOB_TEMPLATE,
    /** Idle atlas still — Sanity thumbnail when set, else preview video first frame. */
    thumbnail: project.thumbnailUrl || null,
    video: project.previewUrl,
    videoFull: project.vimeoLink,
    projectId: project._id,
    title: project.title,
    slug: project.slug,
    date: project.date,
    location: project.location || "",
    category: project.category || "",
    info: project.info || [],
    credits: project.credits || [],
  }));

  console.log("[projects] PARAMS.blobs", PARAMS.blobs);

  return PARAMS.blobs.length;
}
