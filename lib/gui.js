/**
 * lil-gui panel bound directly to PARAMS. Loaded only in development.
 */

import GUI from "lil-gui";
import { PARAMS, MAX_PER_BLOB } from "./uniforms.js";

const NUDGE_DIRECTIONS = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
  "up left": [-1, 1],
  "up right": [1, 1],
  "down left": [-1, -1],
  "down right": [1, -1],
};

/**
 * @param {{ sim: import('./blob.js').BlobSim, onRebuildBlob: (i: number) => void }} ctx
 * @returns {{ destroy: () => void }}
 */
export function initGUI({ sim, onRebuildBlob }) {
  const gui = new GUI({ title: "blobs" });
  gui.domElement.style.zIndex = "10";

  let visible = false;
  gui.hide();

  const drift = gui.addFolder("drift");
  drift.add(PARAMS, "driftSpeedMin", 0, 40, 0.5).name("speed min");
  drift.add(PARAMS, "driftSpeedMax", 0, 120, 1).name("speed max");
  drift.add(PARAMS, "restChance", 0, 1, 0.01).name("rest chance");
  drift.add(PARAMS, "driftSecondsMin", 2, 60, 1).name("drift secs min");
  drift.add(PARAMS, "driftSecondsMax", 2, 90, 1).name("drift secs max");
  drift.add(PARAMS, "restSecondsMin", 2, 60, 1).name("rest secs min");
  drift.add(PARAMS, "restSecondsMax", 2, 90, 1).name("rest secs max");
  drift.add(PARAMS, "easeSeconds", 0.5, 12, 0.1).name("ease secs");
  drift.add(PARAMS, "nudgeSpeed", 10, 400, 5).name("nudge speed");
  drift.add(PARAMS, "nudgeSeconds", 1, 20, 0.5).name("nudge secs");
  drift.add(PARAMS, "nudgeIntervalMin", 1, 30, 0.5).name("nudge every min");
  drift.add(PARAMS, "nudgeIntervalMax", 2, 60, 0.5).name("nudge every max");
  drift
    .add(
      {
        nudgeAll: () => {
          for (const blob of sim.blobs) blob.randomNudge();
        },
      },
      "nudgeAll",
    )
    .name("nudge all now");

  const merge = gui.addFolder("merge");
  merge.add(PARAMS, "threshold", 0.05, 12, 0.005);
  merge.add(PARAMS, "edgeSoftness", 0.001, 5, 0.001).name("edge softness");
  merge.add(PARAMS, "falloff", 0.5, 8, 0.05).name("falloff (merge)");
  merge
    .add(PARAMS, "crossOverlapTarget", 0.5, 1.5, 0.01)
    .name("cross engage distance");
  merge.add(PARAMS, "crossRepulsion", 0, 8, 0.05).name("cross repulsion");
  merge.add(PARAMS, "contactSeparationBias", 0, 300, 1).name("separation bias");
  merge
    .add(PARAMS, "contactSeparationRamp", 0.5, 15, 0.1)
    .name("separation ramp s");
  merge.add(PARAMS, "contactOverlap", 0.2, 1.2, 0.01).name("max shared region");
  merge.add(PARAMS, "interfaceWidth", 0, 8, 0.05).name("interface width px");
  merge.add(PARAMS, "meniscus").name("meniscus rim");
  merge.add(PARAMS, "meniscusWidth", 0.5, 100, 0.1).name("meniscus width px");
  merge
    .add(PARAMS, "meniscusBrightness", 0, 1, 0.01)
    .name("meniscus brightness");
  merge.add(PARAMS, "meniscusEdgeFade", 0, 40, 0.5).name("meniscus edge fade");
  merge.addColor(PARAMS, "meniscusColor").name("meniscus colour");

  const flow = gui.addFolder("interface flow");
  flow.add(PARAMS, "flowMaster", 0, 2, 0.01).name("master");
  flow.add(PARAMS, "flowScale", 30, 300, 1).name("flow scale");
  flow.add(PARAMS, "flowStrength", 0, 120, 1).name("displacement");
  flow.add(PARAMS, "flowSpeed", 0, 0.3, 0.005).name("evolution speed");
  flow.add(PARAMS, "flowMixSeconds", 0.5, 20, 0.1).name("mix ramp secs");
  flow.add(PARAMS, "flowEdgeFade", 0, 60, 0.5).name("edge fade px");

  const mat = gui.addFolder("video");
  mat.add(PARAMS, "videoStretch").name("stretch to blob");
  mat.add(PARAMS, "videoFitPadding", 0.85, 1.6, 0.01).name("fit padding");
  mat.add(PARAMS, "uvSharpness", 0.1, 16, 0.05).name("tear sharpness");
  mat.add(PARAMS, "displaceAmount", 0, 2, 0.01).name("tearing");
  mat.addColor(PARAMS, "blobColor").name("fallback colour");

  const edges = gui.addFolder("canvas edges");
  edges.add(PARAMS, "edgeBuffer", 0, 80, 1).name("edge buffer px");
  edges.add(PARAMS, "edgeGrip", 0.02, 0.6, 0.01).name("grip");
  edges.close();

  const selection = gui.addFolder("selection");
  selection.add(PARAMS, "transitionSeconds", 0.2, 3, 0.05).name("focus secs");
  selection
    .add(PARAMS, "transitionEasing", {
      easeInOutCubic: "easeInOutCubic",
      smoothstep: "smoothstep",
      linear: "linear",
    })
    .name("focus easing");
  selection.add(PARAMS, "exitSeconds", 0.05, 2, 0.01).name("exit secs");
  selection.add(PARAMS, "returnSeconds", 0.1, 3, 0.05).name("return secs");
  selection
    .add(PARAMS, "returnDelaySeconds", 0, 1.5, 0.01)
    .name("return delay");
  selection.add(PARAMS, "exitMargin", 0, 400, 5).name("exit margin px");
  selection.add(PARAMS, "focusPadding", 0, 48, 1).name("focus inset px");
  selection.add(PARAMS, "focusVertInset", 0, 160, 1).name("vertical inset px");
  selection
    .add(PARAMS, "focusLayoutScale", 0.8, 2.5, 0.01)
    .name("layout scale");
  selection.add(PARAMS, "focusZoomBoost", 1, 1.5, 0.01).name("zoom boost");
  selection
    .add(PARAMS, "selectedVideoFitScale", 0.85, 1.5, 0.01)
    .name("video fit scale");
  selection
    .add(PARAMS, "focusMotionSurvival", 0, 1, 0.01)
    .name("selected motion");
  selection.add(PARAMS, "focusAspectSlack", 0, 5, 0.01).name("aspect slack");

  const breaker = gui.addFolder("scroll breaker");
  breaker.add(PARAMS, "scrollRange", 400, 4000, 20).name("scroll range px");
  breaker
    .add(PARAMS, "scrollSmoothSeconds", 0.04, 0.8, 0.01)
    .name("smooth secs");
  breaker.add(PARAMS, "breakerWidth", 1, 100, 1).name("width %");
  breaker.add(PARAMS, "breakerRepulsion", 0, 40, 0.5).name("repulsion");
  breaker.add(PARAMS, "breakerOverlap", 0.6, 1.6, 0.01).name("overlap");
  breaker.add(PARAMS, "breakerSplit", 0, 600, 5).name("split shove");
  breaker.add(PARAMS, "breakerPush", 0, 1, 0.01).name("positional push");
  breaker.add(PARAMS, "breakerCut", 0, 2.5, 0.01).name("field cut");
  breaker.add(PARAMS, "breakerFadeSeconds", 0.05, 1.2, 0.01).name("fade secs");

  const motion = gui.addFolder("circle motion");
  motion.add(PARAMS, "noiseStrength", 0, 400, 1);
  motion.add(PARAMS, "noiseSpeed", 0, 1.5, 0.005);
  motion.add(PARAMS, "anchorStiffness", 0, 8, 0.01);
  motion.add(PARAMS, "cohesion", 0, 5, 0.01);
  motion.add(PARAMS, "linkStiffness", 0, 10, 0.01);
  motion.add(PARAMS, "overlapTarget", 0.1, 1.5, 0.01);
  motion.add(PARAMS, "repulsion", 0, 12, 0.01);
  motion.add(PARAMS, "damping", 0.7, 0.999, 0.001);
  motion.add(PARAMS, "maxSpeed", 0, 600, 1);
  motion.add(PARAMS, "breathAmount", 0, 0.6, 0.005);
  motion.add(PARAMS, "breathSpeed", 0, 2, 0.005);
  motion.close();

  const extra = gui.addFolder("per-circle transform");
  extra.add(PARAMS, "useFullTransform");
  extra.add(PARAMS, "transformAngle", 0, 1.6, 0.01);
  extra.add(PARAMS, "transformScale", 0, 0.8, 0.01);
  extra.close();

  PARAMS.blobs.forEach((bp, index) => {
    const folder = gui.addFolder(`blob ${index + 1}`);
    folder
      .add(bp, "circleCount", 1, MAX_PER_BLOB, 1)
      .name("circles")
      .onFinishChange(() => onRebuildBlob(index));
    folder
      .add(bp, "minRadius", 10, 300, 1)
      .name("radius min")
      .onFinishChange(() => onRebuildBlob(index));
    folder
      .add(bp, "maxRadius", 10, 400, 1)
      .name("radius max")
      .onFinishChange(() => onRebuildBlob(index));
    folder.add(bp, "videoOpacity", 0, 1, 0.01).name("video opacity");

    const nudge = {
      direction: "right",
      speed: PARAMS.nudgeSpeed,
      seconds: PARAMS.nudgeSeconds,
    };
    folder.add(nudge, "direction", Object.keys(NUDGE_DIRECTIONS));
    folder.add(nudge, "speed", 10, 400, 5);
    folder.add(nudge, "seconds", 1, 20, 0.5);
    folder
      .add(
        {
          go: () => {
            const [dx, dy] = NUDGE_DIRECTIONS[nudge.direction];
            sim.blobs[index]?.nudge(dx, dy, nudge.speed, nudge.seconds);
          },
        },
        "go",
      )
      .name("nudge");
    folder
      .add(
        {
          random: () => sim.blobs[index]?.randomNudge(),
        },
        "random",
      )
      .name("random nudge");

    folder.close();
  });

  const debug = gui.addFolder("debug");
  debug.add(PARAMS, "showCircleOutlines").name("circle outlines");
  debug.add(PARAMS, "showForceDebug").name("inter-blob forces");
  debug
    .add(
      {
        copyParams: async () => {
          const json = JSON.stringify(PARAMS, null, 2);
          try {
            await navigator.clipboard.writeText(json);
          } catch {
            console.log(json);
          }
        },
      },
      "copyParams",
    )
    .name("copy params as JSON");

  const onKeydown = (event) => {
    if (event.key !== "h" && event.key !== "H") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;

    visible = !visible;
    if (visible) gui.show();
    else gui.hide();
  };
  window.addEventListener("keydown", onKeydown);

  return {
    destroy() {
      window.removeEventListener("keydown", onKeydown);
      gui.destroy();
    },
  };
}
