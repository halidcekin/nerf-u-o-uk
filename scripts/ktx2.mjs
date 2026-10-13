// Parallel JPG/PNG -> KTX2 (UASTC + mipmaps + zstd) encoding with worker threads.
//   import { encodeFiles } from './ktx2.mjs';
//   await encodeFiles([{ src, dest, kind: 'color' | 'normal' | 'data' }]);
// kind: color  = sRGB albedo, normal = tangent-space normal map, data = roughness / AO / etc. (linear)
// Output stays un-flipped (glTF / flipY=false convention); the runtime sets normalScale.y = -s for such textures.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { encodeToKTX2 } = await import('ktx2-encoder');
  const sharp = (await import('sharp')).default;
  const imageDecoder = async (buffer) => {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  };
  parentPort.on('message', async ({ src, dest, kind }) => {
    try {
      let input = await fs.readFile(src);
      // BC/ASTC blocks are 4x4: make both sides a multiple of 4
      const meta = await sharp(input).metadata();
      const w = Math.max(4, Math.round(meta.width / 4) * 4), h = Math.max(4, Math.round(meta.height / 4) * 4);
      if (w !== meta.width || h !== meta.height) input = await sharp(input).resize({ width: w, height: h, fit: 'fill' }).png().toBuffer();
      const out = await encodeToKTX2(new Uint8Array(input), {
        isUASTC: true,
        generateMipmap: true,
        needSupercompression: true,
        isNormalMap: kind === 'normal',
        isPerceptual: kind === 'color',
        isSetKTX2SRGBTransferFunc: kind === 'color',
        imageDecoder,
      });
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, out);
      parentPort.postMessage({ ok: true, dest, bytes: out.length });
    } catch (e) {
      parentPort.postMessage({ ok: false, dest, error: String(e && e.message || e) });
    }
  });
}

export async function encodeFiles(jobs, { log = console.log } = {}) {
  if (!jobs.length) return;
  const n = Math.max(1, Math.min(jobs.length, os.cpus().length - 1));
  const queue = [...jobs];
  let done = 0, failed = 0;
  await new Promise((resolve) => {
    const workers = [];
    const next = (w) => {
      const job = queue.shift();
      if (!job) { w.terminate(); if (!--alive) resolve(); return; }
      w.once('message', (m) => {
        done++;
        if (!m.ok) { failed++; log(`  !! ktx2 ${m.dest}: ${m.error}`); }
        if (done % 10 === 0 || done === jobs.length) log(`  ktx2 ${done}/${jobs.length}`);
        next(w);
      });
      w.postMessage(job);
    };
    let alive = n;
    for (let i = 0; i < n; i++) { const w = new Worker(THIS); workers.push(w); next(w); }
  });
  if (failed) throw new Error(`${failed} KTX2 encodes failed`);
}
