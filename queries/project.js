/** @typedef {import('~/stores/project').Project} Project */

/** @type {string} */
export const projectsQuery = `*[_type == "project"] | order(date desc) {
  _id,
  title,
  "slug": slug.current,
  date,
  credits,
  location,
  category,
  upcoming[]{
    location,
    dates,
    link
  },
  "thumbnailUrl": thumbnail.asset->url,
  "previewUrl": preview.asset->url,
  vimeoLink,
  info
}`;
