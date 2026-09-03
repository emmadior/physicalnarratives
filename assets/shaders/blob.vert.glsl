// Fullscreen quad. PlaneGeometry(2, 2) already spans clip space under the
// orthographic camera set up in main.js, so this is a straight pass-through
// that only forwards the UVs used to reconstruct pixel space in the fragment.

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
