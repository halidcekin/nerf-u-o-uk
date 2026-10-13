// Prints the sun direction / sky colours of an HDRI (used to align the directional light with the environment map).
// node hdri-sun.mjs rooitou_park_2k
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import fs from 'node:fs';
for (const id of process.argv.slice(2)) {
  const buf = fs.readFileSync(`../public/assets/hdri/${id}.hdr`);
  const l = new HDRLoader().setDataType(THREE.FloatType);
  const t = l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { data, width: W, height: H } = t;
  let max = 0, sumLum = 0, cnt = 0;
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let i = 0; i < data.length; i += 4) { const L = lum(i); if (L > max) max = L; sumLum += L; cnt++; }
  let sx = 0, sy = 0, sz = 0, sw = 0, solid = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const L = lum((r * W + c) * 4);
    if (L > max * 0.3) {
      const el = (0.5 - (r + 0.5) / H) * Math.PI, a = ((c + 0.5) / W - 0.5) * 2 * Math.PI;
      const w = L * Math.cos(el); // solid angle weighting
      sx += w * Math.cos(el) * Math.cos(a); sy += w * Math.sin(el); sz += w * Math.cos(el) * Math.sin(a); sw += w; solid++;
    }
  }
  const d = new THREE.Vector3(sx, sy, sz).normalize();
  // average colour of the sky above horizon excluding sun, and horizon band
  let up = [0, 0, 0], upn = 0, hz = [0, 0, 0], hzn = 0, dn = [0,0,0], dnn = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = (r * W + c) * 4; const el = (0.5 - (r + 0.5) / H) * Math.PI;
    const L = lum(i); if (L > max * 0.02) continue;
    const w = Math.cos(el);
    if (el > 0.5) { up[0] += data[i] * w; up[1] += data[i + 1] * w; up[2] += data[i + 2] * w; upn += w; }
    else if (el > 0) { hz[0] += data[i] * w; hz[1] += data[i + 1] * w; hz[2] += data[i + 2] * w; hzn += w; }
    else { dn[0] += data[i] * w; dn[1] += data[i + 1] * w; dn[2] += data[i + 2] * w; dnn += w; }
  }
  const f = (a, n) => a.map(v => (v / n).toFixed(3)).join(',');
  console.log(id, `${W}x${H}`, 'maxLum', max.toFixed(1), 'meanLum', (sumLum / cnt).toFixed(3), 'sunDir', d.x.toFixed(3), d.y.toFixed(3), d.z.toFixed(3), 'elev', (Math.asin(d.y) * 180 / Math.PI).toFixed(1), 'azimuthAtan2(z,x)deg', (Math.atan2(d.z, d.x) * 180 / Math.PI).toFixed(1), 'sunPixels', solid, '| sky', f(up, upn), 'horizon', f(hz, hzn), 'ground', f(dn, dnn));
}
