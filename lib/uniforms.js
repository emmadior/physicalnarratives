/**
 * Single source of truth for every tunable in the effect.
 *
 * The GUI mutates this object in place; the render loop reads it every frame and
 * pushes the values into the shader uniforms. Nothing else holds its own copy,
 * so any change is live except the ones that alter a blob's population or size
 * range, which relayout that blob.
 *
 * Units: all lengths are in "layout pixels" measured in a reference space whose
 * short axis is LAYOUT_REFERENCE px. The simulation runs entirely in that space
 * and main.js multiplies by a single scale factor when uploading, which is what
 * keeps the composition identical across viewport sizes and DPRs.
 */

/** Circles simulated per blob. Must match `#define MAX_PER_BLOB` in blob.frag.glsl. */
export const MAX_PER_BLOB = 24;

/** Short-axis length of the space the simulation runs in. */
export const LAYOUT_REFERENCE = 900;

/** Iso-contour reach as a fraction of circle radius — must match the shader. */
export const METABALL_VISIBLE_FRACTION = 0.85;

export const PARAMS = {
  // ---- simulation: forces (shared by every blob) -------------------------
  noiseStrength: 55, // px/s^2 of random wander
  noiseSpeed: 0.12, // how fast each circle walks through its noise field
  anchorStiffness: 1.4, // pull back to the rest position
  cohesion: 0.6, // weak pull toward the blob's own centroid
  linkStiffness: 2.2, // k-NN spring network, makes a blob one organism
  overlapTarget: 0.35, // circles repel below (r_i + r_j) * overlapTarget
  repulsion: 3.0, // strength of that soft repulsion
  damping: 0.92, // velocity retained per 60 Hz step
  maxSpeed: 70, // px/s clamp

  /** Video tear strength — shared by every blob (0 = pinned, ~1.2 = idle tear). */
  displaceAmount: 0.5,

  // ---- between blobs ------------------------------------------------------
  // crossOverlapTarget: repulsion engages when circle centres are closer than
  // (r_i + r_j) * this value. 1.0 ≈ silhouettes touching; >1 pushes earlier.
  crossOverlapTarget: 1,
  crossRepulsion: 1.5,
  // How far two blobs may sink into each other before pair-mix ramps (visual).
  contactOverlap: 0.72,
  /** Seconds of contact before separation bias reaches full strength. */
  contactSeparationRamp: 3.5,
  /** Max extra push applied evenly to every circle while a pair stays merged. */
  contactSeparationBias: 85,

  // ---- breathing ----------------------------------------------------------
  breathAmount: 0.08, // radius = baseRadius * (1 + breathAmount * noise)
  breathSpeed: 0.16,

  // ---- lazy drift personality --------------------------------------------
  // A blob rests for a stretch, then eases into a drift, then eases back to a
  // stop. Every duration is randomised per phase per blob.
  driftSpeedMin: 2, // px/s
  driftSpeedMax: 22,
  driftSecondsMin: 3,
  driftSecondsMax: 10,
  restSecondsMin: 6,
  restSecondsMax: 18,
  restChance: 0.48, // probability a phase is a rest rather than a drift
  easeSeconds: 4.2, // ease in/out time for any change of speed or direction

  // ---- random nudges ------------------------------------------------------
  // Occasional kicks in a random direction on top of the lazy drift, so the
  // scene stays lively without waiting for phases to line up.
  nudgeSpeed: 80, // px/s
  nudgeSeconds: 2.5,
  nudgeIntervalMin: 12, // seconds between automatic nudges, per blob
  nudgeIntervalMax: 32,

  // ---- canvas edges -------------------------------------------------------
  // Blobs travel right up to this inset from the canvas edge, then bounce back.
  edgeBuffer: 10, // CSS px; converted to layout units at upload time
  edgeGrip: 0.22, // per-step hold applied to circles crossing the edge

  // ---- shader: silhouette ------------------------------------------------
  threshold: 5, // metaball iso-level
  edgeSoftness: 0, // smoothstep half-width around the threshold
  falloff: 1.2, // kernel sharpness; higher = tighter, merges less eagerly

  // ---- shader: video matting --------------------------------------------
  // Within one blob: how sharply torn slices meet (high = defined seams).
  uvSharpness: 3,
  // Across blobs: AA width of the winner-takes-all interface, in pixels.
  // 0 = hard step, ~1 = clean line, higher = softens toward a short blend.
  interfaceWidth: 1.0,
  videoStretch: false, // selected/pinned: fill live silhouette; idle tear uses rest frame
  videoFitPadding: 1.12, // frame padding around the rest silhouette
  blobColor: "#bababa", // fallback fill under the video

  // ---- meniscus rim along video/video interfaces -------------------------
  meniscus: false,
  meniscusWidth: 2.0, // half-width of the rim, in pixels
  meniscusBrightness: 0.55, // 0..1 mix strength into the rim colour
  meniscusEdgeFade: 6.0, // px inside the silhouette before the rim is full
  meniscusColor: "#e8efe9", // subtle light rim by default

  // ---- interface flow (material only — never touches the silhouette) -----
  // Curl-noise displaces where each blob's contribution is sampled for the
  // winner decision, folding the boundary into large tongues. Conservative
  // defaults — turn the master up if you want more.
  flowMaster: 0.65, // 0 = clean boundary, 1 = full strength
  flowScale: 110, // feature size in layout px (~ one blob radius)
  flowStrength: 28, // displacement amplitude in layout px
  flowSpeed: 0.04, // how fast the swirl evolves (keep very slow)
  flowMixSeconds: 5, // ramp from clean → full while a pair stays in contact
  flowEdgeFade: 0, // px inside the silhouette before flow is full

  // ---- selection -----------------------------------------------------------
  transitionSeconds: 0.62,
  transitionEasing: "easeInOutCubic",
  /** Ease selected/idle physics in after the layout transition finishes. */
  focusSettleSeconds: 0.42,
  /** How fast unselected blobs leave the canvas. Shorter than growth. */
  exitSeconds: 2,
  /** How long returning blobs take to ease back in. Calmer than the exit. */
  returnSeconds: 0.85,
  /** Pause after the selected blob finishes shrinking, before others return. */
  returnDelaySeconds: 0.12,
  /** Ease idle morph / drift back in after return (avoids a hard motion snap). */
  returnMotionBlendSeconds: 0.4,
  /** Inset from viewport edges when scaling up, CSS px. */
  focusPadding: 0,
  /** Extra top/bottom margin so the selected silhouette is not canvas-clipped. */
  focusVertInset: 64,
  /** Hard cap on camera zoom during focus (0 = no cap). */
  focusMaxScale: 0,
  /** Space reserved below the blob for player controls, CSS px. */
  focusPlayerHeight: 52,
  /** Scale the video-aspect circle layout (>1 = larger blob when selected). */
  focusLayoutScale: 1.7,
  /** Extra camera zoom multiplier on top of edge-fit. */
  focusZoomBoost: 1.0,
  /**
   * How much wander, breathing and tearing survive at full selection
   * (0 = frozen, 1 = full idle motion).
   */
  focusMotionSurvival: 0.42,
  /** How far circles may bulge outside the video-aspect ellipse when selected. */
  focusAspectSlack: 1,
  /** Extra anchor pull while selected — keeps the fill from hollowing out. */
  focusAnchorStiffness: 2.8,
  /** Extra pull toward centroid while selected. */
  focusCohesion: 1.6,
  /** Extra travel when pushing unselected blobs off-screen, CSS px. */
  exitMargin: 200,
  /** Page scroll distance mapped to breaker rise 0→1, CSS px. */
  scrollRange: 1400,
  /** Fallback height of the rising text block used for collision, CSS px. */
  scrollTextHeight: 280,
  /** Smoothing time for scroll-driven breaker motion. */
  scrollSmoothSeconds: 0.16,

  /** Extra radius as a fraction of the focused blob's smaller layout axis. */
  breakerRadiusScale: 0,
  /**
   * Fixed breaker width as % of the canvas/viewport width (1–100). Height always
   * follows the measured info box so the shape is an ellipse, not a circle.
   */
  breakerWidth: 65,
  /** One-way repulsion of blob circles by the breaker. */
  breakerRepulsion: 0,
  /** Engage distance as a multiple of (circle + breaker) radii. */
  breakerOverlap: 1.12,
  /** Extra left/right shove while the breaker crosses the blob midline. */
  breakerSplit: 280,
  /** Positional correction 0..1 so the split is immediate. */
  breakerPush: 0.48,
  /** How strongly the breaker subtracts from the blob field (>1 = visible gap). */
  breakerCut: 1.28,
  /** Fade in/out once a blob is selected. */
  breakerFadeSeconds: 0.35,
  /**
   * After the breaker leaves on scroll-up, how long aspect containment eases
   * back in. Release on scroll-down stays immediate so the split stays free.
   */
  breakerHealSeconds: 0.85,
  /** Speed cap multiplier while the breaker is overlapping. */
  breakerMaxSpeedScale: 2.4,

  /** Seconds for the centre play button to fade in after selection settles. */
  playButtonFadeSeconds: 0.45,

  /** Crossfade preview → full video in the shader when a blob is selected. */
  videoCrossfadeSeconds: 0.55,

  /** Fade video out to base colour when exiting selected state. */
  exitVideoFadeOutSeconds: 0.2,

  /** Fade preview back in after the exit layout animation settles. */
  exitVideoFadeInSeconds: 0.2,

  /** Base colour snap-in on select (colour opacity 0→1). */
  selectBlinkOutSeconds: 0.1,

  /** Fade video back in after the select colour flash. */
  selectBlinkInSeconds: 0.4,

  /** Fade preview video in when each blob's source finishes loading. */
  videoFadeInSeconds: 0.85,

  /** Inset scale for selected blob video contain fit (>1 shows more picture). */
  selectedVideoFitScale: 1.0,

  // ---- optional per-circle rotation/scale of the sampled slice -----------
  useFullTransform: false,
  transformAngle: 0.25, // max rotation of a slice, radians
  transformScale: 0.15, // +/- scale of a slice, fraction

  // ---- debug -------------------------------------------------------------
  showCircleOutlines: false,
  /** Draw inter-blob force vectors (dev). Green = repulsive, red = attractive. */
  showForceDebug: false,

  /** Filled from CMS via applyProjectsToParams — empty until projects load. */
  blobs: [],
};
