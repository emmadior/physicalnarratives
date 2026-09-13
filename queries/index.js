/** @typedef {import('~/stores/index').IndexEntry} IndexEntry */

/** @type {string} */
export const indexQuery = `*[_type == "index"] | order(date desc) {
  _id,
  title,
  date,
  location,
  category,
  credits,
  info,
  link
}`;
