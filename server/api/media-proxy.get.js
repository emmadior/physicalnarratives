/**
 * Same-origin progressive media proxy (Nuxt / Nitro — used by `nuxt dev`).
 * Follows Vimeo redirects server-side so the browser never hits a CDN that
 * strips CORS, which would leave WebGL stuck on the thumbnail.
 */

import { isProxiedMediaHost } from "~~/lib/media-url.js";

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
];

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const raw = typeof query.url === "string" ? query.url : "";
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid url" });
  }

  if (!isProxiedMediaHost(target.hostname)) {
    throw createError({ statusCode: 403, statusMessage: "Host not allowed" });
  }

  const range = getRequestHeader(event, "range");
  const upstreamHeaders = {
    "User-Agent":
      getRequestHeader(event, "user-agent") ||
      "Mozilla/5.0 (compatible; EmmaMediaProxy/1.0)",
    Referer: "https://player.vimeo.com/",
    Accept: "*/*",
  };
  if (range) upstreamHeaders.Range = range;

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: upstreamHeaders,
      redirect: "follow",
    });
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: err instanceof Error ? err.message : "Upstream fetch failed",
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    throw createError({
      statusCode: upstream.status,
      statusMessage: `Upstream ${upstream.status}`,
    });
  }

  const headers = new Headers();
  for (const key of PASS_HEADERS) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges",
  );

  if (event.method === "HEAD" || !upstream.body) {
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
});
