/**
 * Copy MediaPipe WASM from the installed npm package and fetch the Face
 * Landmarker model into public/vision. The live-check page loads these as
 * same-origin static files — it does not download biometric models from a
 * third-party CDN at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public', 'vision');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const files = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];
const MODEL_NAME = 'face_landmarker.task';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

fs.mkdirSync(dest, { recursive: true });

for (const name of files) {
  const from = path.join(wasmSrc, name);
  if (!fs.existsSync(from)) {
    console.error(`[sync-vision] missing ${from} — run npm install`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dest, name));
  console.log(`[sync-vision] copied ${name}`);
}

const modelPath = path.join(dest, MODEL_NAME);
if (!fs.existsSync(modelPath) || fs.statSync(modelPath).size < 1_000_000) {
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[sync-vision] failed to download ${MODEL_NAME}: HTTP ${res.status}`);
    process.exit(1);
  }
  fs.writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log(`[sync-vision] downloaded ${MODEL_NAME} (${fs.statSync(modelPath).size} bytes)`);
} else {
  console.log(`[sync-vision] ${MODEL_NAME} already present (${fs.statSync(modelPath).size} bytes)`);
}
