// Liquid-metal metaballs with a per-circle video mat.
//
// ONE field. Every circle in the scene contributes to the same scalar field
// regardless of which blob it belongs to, so circles from different blobs merge
// with exactly the same soft necks as circles inside one blob. What a blob owns
// is a video and a frame of reference, not a shape and not a pass.
//
// Silhouette and material are decoupled. The silhouette is ALWAYS cut from the
// clean, unmodified metaball field — nothing may perturb it. Inside the shape,
// each fragment picks a single video (winner-takes-all). Where the boundary
// falls is steered by a slow curl-noise flow that displaces the sample point
// used for material contributions only, folding contacts into large tongues as
// two blobs stay pressed together. UV blending only ever happens between
// circles of the *same* blob.
//
// MAX_BLOBS is patched at runtime to the live blob count. Previews live in one
// atlas (WebGL cannot dynamically index sampler arrays). Circles live in
// textures so uniform limits do not cap how many blobs can exist.
//
// Written against GLSL ES 1.0 constraints (constant loop bounds, indices built
// only from loop counters) so it compiles on WebGL1 and under three's WebGL2
// compatibility prelude. Screen-space AA of the interface needs derivatives;
// ShaderMaterial is created with `extensions: { derivatives: true }` so three
// injects the OES_standard_derivatives enable in the right place.

precision highp float;

#define MAX_BLOBS 4
#define MAX_PER_BLOB 24

// Kernel gain. The polynomial kernel below is 0 at the rim, so without a gain
// the default threshold of 0.55 would cut an isolated circle at only ~0.42 of
// its radius — circles would render far smaller than uRadius says and would
// never reach each other. The gain rescales the field so that at the default
// falloff/threshold the iso-contour sits at ~0.85 * radius. That puts the
// silhouette, the radius sliders and overlapTarget in the same units, which is
// what makes neighbouring circles actually fuse.
#define KERNEL_GAIN 12.0

varying vec2 vUv;

uniform vec2  uResolution;   // canvas size in CSS pixels
uniform float uTime;
uniform float uLayoutScale;  // CSS px per layout unit — keeps flow in world space
uniform float uFocusZoom;    // 1 = normal; >1 zooms toward canvas centre

// --- videos: one atlas of previews + one selected full-res video ------------
uniform sampler2D uVideoAtlas;
uniform sampler2D uVideoFull;
uniform float uAtlasCols;
uniform float uAtlasRows;
uniform int   uFullIndex;               // blob using uVideoFull, or -1
uniform vec2  uVideoRes[MAX_BLOBS];     // native pixel size of preview video
uniform vec2  uVideoResFull[MAX_BLOBS]; // native pixel size of full video
uniform float uHasVideo[MAX_BLOBS];     // 0 when preview failed to load
uniform float uHasVideoFull[MAX_BLOBS]; // 0 when full video not ready
uniform float uVideoBlend[MAX_BLOBS];   // 0 = preview, 1 = full
uniform int   uBlobCount;
uniform int   uCounts[MAX_BLOBS];       // active circles in each group
uniform vec2  uBlobCenter[MAX_BLOBS];   // live centre of the group's frame, px
uniform vec2  uBlobFit[MAX_BLOBS];      // half-extents of its video frame, px
uniform vec2  uBoundsMin[MAX_BLOBS];    // live AABB, for per-pixel group culling
uniform vec2  uBoundsMax[MAX_BLOBS];
uniform float uDisplace[MAX_BLOBS];     // 0 = video pinned to the blob, 1 = dragged
uniform float uVideoContain[MAX_BLOBS]; // 1 = letterbox (like object-fit: contain)
uniform float uVideoOpacity[MAX_BLOBS];
// Progressive mix amount per ordered pair (i*MAX_BLOBS+j). Symmetric, [0,1].
uniform float uPairMix[MAX_BLOBS * MAX_BLOBS];

// --- per circle, packed into textures so blob count is not a uniform cap ----
uniform sampler2D uCircleTex;     // xy = current centre, zw = rest centre
uniform sampler2D uCircleMetaTex; // x = radius, y = angle, z = scale

// --- global -----------------------------------------------------------------
uniform float uThreshold;      // metaball cut, ~0.55
uniform float uEdgeSoftness;   // smoothstep width around the threshold
uniform float uFalloff;        // kernel sharpness -> how eagerly circles merge
uniform float uUvSharpness;    // within one blob: 1 = soft smear, high = hard seams
uniform float uInterfaceWidth; // px of AA across a video/video boundary (0 = hard)
uniform bool  uVideoStretch;   // false = cover-fit (crop), true = stretch to the box
uniform bool  uUseFullTransform;
uniform vec3  uBlobColor;

// Meniscus: a thin rim drawn where two blob contributions are equal.
uniform float uMeniscus;         // 0 = off, 1 = on (also scales brightness)
uniform float uMeniscusWidth;    // rim half-width in pixels
uniform float uMeniscusEdgeFade; // px inside the silhouette before the rim is full
uniform vec3  uMeniscusColor;

// Curl-noise flow — displaces the material sample only.
uniform float uFlowMaster;
uniform float uFlowScale;      // feature size, layout px
uniform float uFlowStrength;   // displacement amplitude, layout px
uniform float uFlowSpeed;      // evolution rate (keep tiny)
uniform float uFlowEdgeFade;   // px inside silhouette before flow is full

uniform float uShowOutlines;

// Kinematic breaker ellipse — punches through the selected blob on scroll.
uniform vec3  uBreaker;      // xy = centre CSS px
uniform vec2  uBreakerSize;  // half extents CSS px (x = width, y = height)
uniform float uBreakerOn;    // 0..1 active
uniform float uBreakerCut;   // field subtraction gain

/**
 * Map a point in a blob's own frame (origin at its centre, pixels) to UVs of
 * that blob's video.
 *
 * `cover` preserves the video's aspect and crops the overflow; `stretch` maps
 * the frame edge to edge. The result is clamped rather than wrapped — a torn
 * slice that reaches past the frame must stretch its edge pixel, not tile the
 * video back in.
 */
vec2 fitUV(vec2 local, vec2 halfBox, vec2 videoRes, float contain) {
  vec2 box = max(halfBox * 2.0, vec2(1.0));
  vec2 fitted;

  if (uVideoStretch) {
    fitted = box;
  } else {
    float boxAspect = box.x / box.y;
    float vidAspect = videoRes.x / max(videoRes.y, 1.0);
    if (contain > 0.5) {
      // object-fit: contain — show the full frame, letterbox if needed
      fitted = boxAspect > vidAspect
        ? vec2(box.y * vidAspect, box.y)
        : vec2(box.x, box.x / vidAspect);
    } else {
      // object-fit: cover — fill the box, crop overflow
      fitted = boxAspect > vidAspect
        ? vec2(box.x, box.x / vidAspect)
        : vec2(box.y * vidAspect, box.y);
    }
  }

  return clamp(local / fitted + 0.5, 0.0, 1.0);
}

/** Half-extents of the fitted video rect in local space (contain or cover). */
vec2 fittedVideoHalf(vec2 halfBox, vec2 videoRes, float contain) {
  vec2 box = max(halfBox * 2.0, vec2(1.0));
  if (uVideoStretch) return halfBox;

  float boxAspect = box.x / box.y;
  float vidAspect = videoRes.x / max(videoRes.y, 1.0);
  vec2 fitted;
  if (contain > 0.5) {
    fitted = boxAspect > vidAspect
      ? vec2(box.y * vidAspect, box.y)
      : vec2(box.x, box.x / vidAspect);
  } else {
    fitted = boxAspect > vidAspect
      ? vec2(box.x, box.x / vidAspect)
      : vec2(box.y * vidAspect, box.y);
  }
  return fitted * 0.5;
}

vec2 atlasUV(vec2 uv, int b) {
  float cols = max(uAtlasCols, 1.0);
  float rows = max(uAtlasRows, 1.0);
  float col = mod(float(b), cols);
  float row = floor(float(b) / cols);
  vec2 cell = vec2(col, rows - 1.0 - row);
  return (cell + clamp(uv, 0.001, 0.999)) / vec2(cols, rows);
}

vec2 circleTexel(int b, int j) {
  return vec2(
    (float(j) + 0.5) / float(MAX_PER_BLOB),
    (float(b) + 0.5) / float(MAX_BLOBS)
  );
}

/** 1 inside the valid video frame, 0 outside — kills clamp streaks at edges. */
float videoFrameMask(vec2 local, vec2 halfBox, vec2 videoRes, float contain) {
  if (contain < 0.5) return 1.0;
  vec2 fitHalf = fittedVideoHalf(halfBox, videoRes, contain);
  vec2 edge = abs(local) - fitHalf;
  float outside = max(edge.x, edge.y);
  return 1.0 - smoothstep(0.0, 1.5, outside);
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

/** Smooth value noise in [-1, 1]. Low frequency only — never used as speckles. */
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

/**
 * Divergence-free 2D curl of a scalar potential. Evaluated in stable layout
 * (world) space so resize and blob drift do not shift the swirl. One strong
 * octave plus a much weaker second for a little asymmetry — never fine enough
 * to look granular.
 */
vec2 curlFlow(vec2 worldP) {
  float scale = max(uFlowScale, 1.0);
  float t = uTime * uFlowSpeed;
  // Slow advection of the potential only — not tied to blob positions.
  vec2 q = worldP / scale + vec2(t * 0.31, -t * 0.23);

  // Finite differences of the potential → curl = (dφ/dy, -dφ/dx).
  float e = 0.35;
  float nL = valueNoise(q + vec2(-e, 0.0));
  float nR = valueNoise(q + vec2( e, 0.0));
  float nD = valueNoise(q + vec2(0.0, -e));
  float nU = valueNoise(q + vec2(0.0,  e));
  vec2 c1 = vec2(nU - nD, nL - nR) / (2.0 * e);

  // Second octave, ~half the frequency contribution, much weaker amplitude.
  vec2 q2 = q * 1.7 + vec2(12.3, -8.1);
  float mL = valueNoise(q2 + vec2(-e, 0.0));
  float mR = valueNoise(q2 + vec2( e, 0.0));
  float mD = valueNoise(q2 + vec2(0.0, -e));
  float mU = valueNoise(q2 + vec2(0.0,  e));
  vec2 c2 = vec2(mU - mD, mL - mR) / (2.0 * e);

  return c1 + c2 * 0.25;
}

float metaballWeight(vec2 d, float radius) {
  float q = length(d) / max(radius, 1.0);
  float k = max(0.0, 1.0 - q * q);
  return pow(k, uFalloff) * k * KERNEL_GAIN;
}

void main() {
  // Pixel space with the origin at the canvas centre — the same space the CPU
  // simulation works in (after layoutScale), so circle uniforms compare directly.
  vec2 p = (vUv - 0.5) * uResolution;
  float focusZoom = max(uFocusZoom, 1.0);
  if (focusZoom > 1.0001) {
    p /= focusZoom;
  }

  // Layout (world) space: invariant under canvas resize.
  float layoutScale = max(uLayoutScale, 1e-4);
  vec2 worldP = p / layoutScale;

  float field = 0.0;               // clean shared field — silhouette ONLY
  float blobField[MAX_BLOBS];      // material scores (may be flow-displaced)
  vec2  blobUv[MAX_BLOBS];
  vec2  blobUvFull[MAX_BLOBS];
  float blobFrameMask[MAX_BLOBS];
  float mixAmt[MAX_BLOBS];         // how strongly each blob is currently mixing

  for (int b = 0; b < MAX_BLOBS; b++) {
    blobField[b] = 0.0;
    blobUv[b] = vec2(0.5);
    blobUvFull[b] = vec2(0.5);
    blobFrameMask[b] = 1.0;
    mixAmt[b] = 0.0;
  }

  // Max pair-mix for each blob (progressive contact with anyone).
  for (int b = 0; b < MAX_BLOBS; b++) {
    if (b >= uBlobCount) break;
    float m = 0.0;
    for (int o = 0; o < MAX_BLOBS; o++) {
      if (o >= uBlobCount || o == b) continue;
      m = max(m, uPairMix[b * MAX_BLOBS + o]);
    }
    mixAmt[b] = m;
  }

  // ---- pass 1: clean silhouette + UVs at the real fragment ----------------
  for (int b = 0; b < MAX_BLOBS; b++) {
    if (b >= uBlobCount) break;

    vec2 mn = uBoundsMin[b];
    vec2 mx = uBoundsMax[b];
    if (p.x < mn.x || p.x > mx.x || p.y < mn.y || p.y > mx.y) continue;

    vec2  uvSum = vec2(0.0);
    vec2  uvFullSum = vec2(0.0);
    float uvWeight = 0.0;
    float groupField = 0.0;

    for (int j = 0; j < MAX_PER_BLOB; j++) {
      if (j >= uCounts[b]) break;
      vec2 cUv = circleTexel(b, j);
      vec4 circle = texture2D(uCircleTex, cUv);
      vec2 pos = circle.xy;
      vec2 anchor = circle.zw;
      vec4 meta = texture2D(uCircleMetaTex, cUv);
      float radius = max(meta.x, 1.0);

      float w = metaballWeight(p - pos, radius);
      groupField += w;

      vec2 src;
      if (uUseFullTransform) {
        vec2 local = p - pos;
        src = anchor + (rot(-meta.y) * local) / max(meta.z, 0.01);
      } else {
        src = p - (pos - anchor);
      }
      src = mix(p, src, uDisplace[b]);
      vec2 localFrame = src - uBlobCenter[b];
      vec2 uvI = fitUV(
        localFrame,
        uBlobFit[b],
        uVideoRes[b],
        uVideoContain[b]
      );
      vec2 uvFullI = fitUV(
        localFrame,
        uBlobFit[b],
        uVideoResFull[b],
        uVideoContain[b]
      );

      float bw = pow(max(w, 1e-6), uUvSharpness);
      uvSum += uvI * bw;
      uvFullSum += uvFullI * bw;
      uvWeight += bw;
    }

    field += groupField;
    // Default material score = clean contribution; overwritten below if flowing.
    blobField[b] = groupField;
    if (uvWeight > 0.0) {
      blobUv[b] = uvSum / uvWeight;
      blobUvFull[b] = uvFullSum / uvWeight;
    }
    blobFrameMask[b] = videoFrameMask(
      p - uBlobCenter[b],
      uBlobFit[b],
      uVideoRes[b],
      uVideoContain[b]
    );
  }

  // Breaker: subtract an invisible ellipse from the shared field so the
  // selected blob splits around the rising info text.
  float breakerW = 0.0;
  if (uBreakerOn > 0.001 && uBreakerSize.y > 0.5) {
    vec2 d = p - uBreaker.xy;
    float ry = max(uBreakerSize.y, 1.0);
    float rx = max(uBreakerSize.x, 1.0);
    vec2 scaled = vec2(d.x * ry / rx, d.y);
    breakerW = metaballWeight(scaled, ry);
    field = max(field - breakerW * max(uBreakerCut, 0.0), 0.0);
  }

  // Silhouette from the clean field. Hard constraint: never modified below.
  float mask = smoothstep(uThreshold - uEdgeSoftness, uThreshold + uEdgeSoftness, field);

  float edgePx = (field - uThreshold) / max(fwidth(field), 1e-5);
  float interior = smoothstep(0.0, max(uFlowEdgeFade, 1e-3), edgePx);

  // ---- pass 2: material scores at curl-displaced positions ----------------
  // Only runs when some contact is mixing and the master is up. Displacement
  // is in layout units, converted to CSS px for the circle comparison.
  float master = uFlowMaster * interior;
  if (master > 1e-4 && uFlowStrength > 1e-4) {
    vec2 flowWorld = curlFlow(worldP) * uFlowStrength * master;
    vec2 flowPx = flowWorld * layoutScale;

    float cullPad = length(flowPx) + 4.0;

    for (int b = 0; b < MAX_BLOBS; b++) {
      if (b >= uBlobCount) break;
      float mb = mixAmt[b];
      if (mb < 1e-4) continue; // not in a mixing contact — keep clean score

      vec2 pMat = p + flowPx * mb;

      vec2 mn = uBoundsMin[b] - cullPad;
      vec2 mx = uBoundsMax[b] + cullPad;
      if (pMat.x < mn.x || pMat.x > mx.x || pMat.y < mn.y || pMat.y > mx.y) {
        blobField[b] = 0.0;
        continue;
      }

      float groupMaterial = 0.0;
      for (int j = 0; j < MAX_PER_BLOB; j++) {
        if (j >= uCounts[b]) break;
        vec2 cUv = circleTexel(b, j);
        vec4 circle = texture2D(uCircleTex, cUv);
        groupMaterial += metaballWeight(pMat - circle.xy, max(texture2D(uCircleMetaTex, cUv).x, 1.0));
      }
      blobField[b] = groupMaterial;
    }
  }

  // --- material: sample each blob with its own UVs -------------------------
  vec3 blobColor[MAX_BLOBS];

  for (int b = 0; b < MAX_BLOBS; b++) {
    if (b >= uBlobCount) break;
    vec3 vidP = texture2D(uVideoAtlas, atlasUV(blobUv[b], b)).rgb;
    vec3 vidF = texture2D(uVideoFull, blobUvFull[b]).rgb;
    float blend = b == uFullIndex ? clamp(uVideoBlend[b], 0.0, 1.0) : 0.0;
    vec3 vid = mix(vidP, vidF, blend);
    float hasVid = mix(uHasVideo[b], uHasVideoFull[b], blend);
    float vidMix = uVideoOpacity[b] * hasVid * blobFrameMask[b];
    blobColor[b] = mix(uBlobColor, vid, vidMix);
  }

  // --- partition: strongest score wins (hard boundary, ~1px AA) ------------
  float top1 = 0.0;
  float top2 = 0.0;
  int i1 = 0;
  int i2 = 0;
  bool hasSecond = false;

  for (int b = 0; b < MAX_BLOBS; b++) {
    if (b >= uBlobCount) break;
    float f = blobField[b];
    if (f > top1) {
      top2 = top1;
      i2 = i1;
      if (top2 > 1e-4) hasSecond = true;
      top1 = f;
      i1 = b;
    } else if (f > top2) {
      top2 = f;
      i2 = b;
      if (f > 1e-4) hasSecond = true;
    }
  }

  vec3 color1 = blobColor[0];
  vec3 color2 = blobColor[0];
  for (int b = 0; b < MAX_BLOBS; b++) {
    if (b == i1) color1 = blobColor[b];
    if (b == i2) color2 = blobColor[b];
  }

  // Meniscus and AA follow the flow-displaced boundary.
  float delta = top1 - top2;
  float px = max(fwidth(delta), 1e-5);
  float halfW = max(uInterfaceWidth, 0.0) * 0.5 * px;
  float win = 1.0;
  if (hasSecond) {
    win = halfW > 1e-6
      ? smoothstep(-halfW, halfW, delta)
      : 1.0;
  }

  vec3 color = mix(color2, color1, win);

  if (uMeniscus > 0.001 && hasSecond) {
    float distPx = abs(delta) / px;
    float rim = 1.0 - smoothstep(0.0, max(uMeniscusWidth, 1e-3), distPx);
    float meniscusEdge = smoothstep(0.0, max(uMeniscusEdgeFade, 1e-3), edgePx);
    color = mix(color, uMeniscusColor, rim * meniscusEdge * uMeniscus * mask);
  }

  // Contain-fit: clip silhouette on X only. Clipping Y flattened the blob
  // into a hard line at the video-frame (≈ canvas) top/bottom.
  if (top1 > 1e-4 && uVideoContain[i1] > 0.5) {
    vec2 local = p - uBlobCenter[i1];
    vec2 fitHalf = fittedVideoHalf(uBlobFit[i1], uVideoRes[i1], 1.0);
    float outsideX = abs(local.x) - fitHalf.x;
    mask *= 1.0 - smoothstep(0.0, 1.5, outsideX);
  }


  // --- debug: raw circle rings over the composite --------------------------
  if (uShowOutlines > 0.5) {
    for (int b = 0; b < MAX_BLOBS; b++) {
      if (b >= uBlobCount) break;

      vec3 tint = vec3(
        float(b) == 0.0 || float(b) == 3.0 ? 1.0 : 0.1,
        float(b) == 1.0 || float(b) == 3.0 ? 1.0 : 0.2,
        float(b) == 2.0 ? 1.0 : 0.6
      );

      for (int j = 0; j < MAX_PER_BLOB; j++) {
        if (j >= uCounts[b]) break;
        vec2 cUv = circleTexel(b, j);
        vec4 circle = texture2D(uCircleTex, cUv);
        float radius = texture2D(uCircleMetaTex, cUv).x;

        float ring = 1.0 - smoothstep(0.8, 1.8, abs(length(p - circle.xy) - radius));
        color = mix(color, tint, ring);
        mask = max(mask, ring);

        float dot_ = 1.0 - smoothstep(0.8, 1.8, abs(length(p - circle.zw) - 4.0));
        color = mix(color, vec3(0.2, 1.0, 0.4), dot_);
        mask = max(mask, dot_);
      }
    }
  }

  gl_FragColor = vec4(color, mask);
}
