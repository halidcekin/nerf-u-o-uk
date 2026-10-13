import * as THREE from 'three';

// Small procedural canvas textures (HUD-ish props, TV screen, foliage). Surfaces use the Poly Haven PBR sets via assets.js.

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function tex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function stripes(a = '#d8402f', b = '#f4efe6', n = 8) {
  const [c, g] = makeCanvas(64, 256);
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * 256 / n, 64, 256 / n); }
  return tex(c);
}

export function bullseye() {
  const S = 512;
  const [c, g] = makeCanvas(S);
  const rings = ['#ffffff', '#e3262e', '#ffffff', '#e3262e', '#ffffff', '#e3262e'];
  rings.forEach((col, i) => {
    g.fillStyle = col; g.beginPath(); g.arc(S / 2, S / 2, S / 2 * (1 - i / rings.length), 0, 7); g.fill();
  });
  g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.07, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
  for (let i = 0; i < rings.length; i++) { g.beginPath(); g.arc(S / 2, S / 2, S / 2 * (1 - i / rings.length) - 1.5, 0, 7); g.stroke(); }
  return tex(c);
}

export function canLabel(hue) {
  const [c, g] = makeCanvas(256, 128);
  g.fillStyle = `hsl(${hue},75%,45%)`; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, 50, 256, 28);
  g.fillStyle = `hsl(${hue},75%,30%)`; g.font = 'bold 24px Segoe UI, sans-serif';
  g.fillText('FIZZ', 20, 72); g.fillText('FIZZ', 148, 72);
  return tex(c);
}

export function tvScreen() {
  const [c, g] = makeCanvas(512, 288);
  const grd = g.createLinearGradient(0, 0, 512, 288);
  grd.addColorStop(0, '#0b1b3a'); grd.addColorStop(1, '#4a1660');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 288);
  g.fillStyle = '#ff7a1a'; g.font = 'bold 54px Segoe UI, sans-serif'; g.textAlign = 'center';
  g.fillText('FOAM WARS', 256, 140);
  g.fillStyle = '#9fc1ff'; g.font = '22px Segoe UI, sans-serif'; g.fillText('PRESS START', 256, 190);
  return tex(c);
}

export function decalLogo(text = 'FOAM-X') {
  const [c, g] = makeCanvas(256, 64);
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#ff6a13'; g.font = 'italic 900 40px Segoe UI, sans-serif'; g.textBaseline = 'middle';
  g.fillText(text, 10, 34);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function softDot() {
  const [c, g] = makeCanvas(64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Tileable leafy mottle used on tree canopies / hedges (colour + bump).
export function foliage() {
  const S = 256, r = rng(55);
  const [c, g] = makeCanvas(S);
  g.fillStyle = '#5b8c3a'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 2600; k++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI, w = 3 + r() * 6, h = 1.5 + r() * 3;
    const hue = 70 + r() * 40, lum = 30 + r() * 38;
    g.fillStyle = `hsl(${hue},${40 + r() * 30}%,${lum}%)`;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -10 || x + ox > S + 10 || y + oy < -10 || y + oy > S + 10) continue;
      g.beginPath(); g.ellipse(x + ox, y + oy, w, h, a, 0, 7); g.fill();
    }
  }
  return tex(c);
}
