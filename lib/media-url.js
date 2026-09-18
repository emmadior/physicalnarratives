/**
 * External progressive hosts (Vimeo) lack usable CORS for WebGL textures.
 * Route them through our same-origin proxy so the blob can sample frames.
 */

/**
 * @param {string} hostname
 */
export function isProxiedMediaHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return (
    h === "player.vimeo.com" ||
    h.endsWith(".vimeo.com") ||
    h.endsWith(".vimeocdn.com") ||
    h.endsWith(".akamaized.net")
  );
}

/**
 * @param {string | null | undefined} src
 * @returns {string | null | undefined}
 */
export function mediaPlayUrl(src) {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("/api/media-proxy")) return src;
  if (src.startsWith("/") || src.startsWith("blob:") || src.startsWith("data:")) {
    return src;
  }

  try {
    const base =
      typeof window !== "undefined" ? window.location.href : "http://localhost";
    const url = new URL(src, base);
    if (typeof window !== "undefined" && url.origin === window.location.origin) {
      return src;
    }
    // Sanity CDN already sends ACAO for canvas / WebGL.
    if (url.hostname.endsWith("cdn.sanity.io")) return src;
    if (isProxiedMediaHost(url.hostname)) {
      return `/api/media-proxy?url=${encodeURIComponent(url.toString())}`;
    }
  } catch {
    /* keep original */
  }
  return src;
}
