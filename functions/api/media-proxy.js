/**
 * Cloudflare Pages Function — production counterpart to server/api/media-proxy.
 * Keeps Vimeo progressive files same-origin so WebGL can texture them.
 */

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
];

function isProxiedMediaHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return (
    h === "player.vimeo.com" ||
    h.endsWith(".vimeo.com") ||
    h.endsWith(".vimeocdn.com") ||
    h.endsWith(".akamaized.net")
  );
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges",
  };
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const incoming = new URL(request.url);
  const raw = incoming.searchParams.get("url") || "";
  let target;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (!isProxiedMediaHost(target.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const range = request.headers.get("Range");
  const upstreamHeaders = {
    "User-Agent":
      request.headers.get("User-Agent") ||
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
    return new Response(
      err instanceof Error ? err.message : "Upstream fetch failed",
      { status: 502 },
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const headers = new Headers(corsHeaders());
  for (const key of PASS_HEADERS) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
