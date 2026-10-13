import * as THREE from 'three';
import * as TX from './textures.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const R = 0.2;          // target radius
const CAN_R = 0.033, CAN_H = 0.122;

// Flip-down wall targets and knock-over can pyramids.
export class Targets {
  constructor(scene, house, sfx, onScore) {
    this.scene = scene; this.sfx = sfx; this.onScore = onScore;
    this.hitMeshes = house.hitMeshes;
    this.colliders = house.colliders;
    this.targets = [];
    this.cans = [];

    const faceMat = new THREE.MeshStandardMaterial({ map: TX.bullseye(), roughness: 0.55 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.45 });
    const discGeo = new THREE.CylinderGeometry(R, R, 0.02, 48).rotateX(Math.PI / 2);   // axis along z
    // cylinder caps: material index 1 = top(+z after rotation?), 2 = bottom. We use [rim, face, face].

    for (const spot of house.targetSpots) {
      const n = spot.normal.clone().normalize();
      const base = new THREE.Group();
      base.position.copy(spot.pos).addScaledVector(n, 0.012);
      base.lookAt(base.position.clone().add(n));               // +z = out of the wall
      scene.add(base);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), bracketMat);
      bracket.position.set(0, -R - 0.02, 0.02);
      bracket.castShadow = true; base.add(bracket);
      const pivot = new THREE.Group();
      pivot.position.set(0, -R, 0.035);
      base.add(pivot);
      const disc = new THREE.Mesh(discGeo, [rimMat, faceMat, faceMat]);
      disc.position.set(0, R, 0);
      disc.castShadow = true; disc.receiveShadow = true;
      disc.userData.dynamic = true;
      disc.material = [rimMat, faceMat, faceMat];
      pivot.add(disc);
      base.updateMatrixWorld(true);
      this.hitMeshes.push(disc, bracket);
      const t = { base, pivot, disc, angle: 0, vel: 0, down: false, timer: 0 };
      disc.userData.target = t;
      this.targets.push(t);
    }

    // cans
    const metal = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.25 });
    const labels = [8, 200, 120, 280, 40, 340].map(h => new THREE.MeshStandardMaterial({ map: TX.canLabel(h), metalness: 0.5, roughness: 0.35 }));
    const canGeo = new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 24);
    let li = 0;
    for (const sp of house.canSpots) {
      const ax = sp.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const layers = [3, 2, 1];
      const placed = [];
      layers.forEach((cnt, L) => {
        for (let i = 0; i < cnt; i++) {
          const off = (i - (cnt - 1) / 2) * (CAN_R * 2 + 0.004);
          const home = new THREE.Vector3(sp.x, sp.y + CAN_H / 2 + L * (CAN_H + 0.001), sp.z).addScaledVector(ax, off);
          const m = new THREE.Mesh(canGeo, [labels[li++ % labels.length], metal, metal]);
          m.castShadow = m.receiveShadow = true;
          m.userData.dynamic = true;
          m.position.copy(home);
          scene.add(m);
          this.hitMeshes.push(m);
          const c = { mesh: m, home, dynamic: false, vel: new THREE.Vector3(), ang: new THREE.Vector3(), scored: false, layer: L, supports: [], restT: 0 };
          // supported by cans directly below (layer L-1, within ~1 can width)
          if (L > 0) c.supports = placed.filter(p => p.layer === L - 1 && p.home.distanceTo(home) < CAN_R * 2.6 + CAN_H);
          m.userData.can = c;
          placed.push(c);
          this.cans.push(c);
        }
      });
    }
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._axis = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
  }

  // returns true if the dart should be considered "handled" (no generic sound)
  handleHit(dart, hit, normal) {
    const obj = hit.object;
    if (!obj) return false;
    const t = obj.userData.target;
    if (t) {
      if (t.down) return false;
      const center = this._v.set(0, 0, 0.01);
      obj.localToWorld(center);
      const d = center.distanceTo(hit.point);
      let pts = 10, label = '+10';
      if (d < 0.035) { pts = 100; label = 'TAM İSABET +100'; }
      else if (d < 0.08) { pts = 50; label = '+50'; }
      else if (d < 0.14) { pts = 25; label = '+25'; }
      t.down = true; t.timer = 4.5;
      t.vel = 9 + dart.vel.length() * 0.3;
      this.sfx.targetHit(hit.point, pts === 100);
      this.onScore(pts, label, pts >= 50);
      return true;
    }
    const c = obj.userData.can;
    if (c) {
      this.knock(c, this._v.copy(dart.vel).multiplyScalar(0.11).add(new THREE.Vector3(0, 0.6, 0)));
      this.sfx.can(hit.point, dart.vel.length() / 15);
      return true;
    }
    return false;
  }

  knock(c, impulse) {
    c.restT = 0;
    if (!c.dynamic) {
      c.dynamic = true;
      if (!c.scored) { c.scored = true; this.onScore(15, '+15', false); }
    }
    c.vel.add(impulse);
    c.ang.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 18);
  }

  reset() {
    for (const t of this.targets) { t.down = false; t.timer = 0; t.vel = -3; }
    for (const c of this.cans) {
      // drop any darts stuck to the can
      for (const ch of [...c.mesh.children]) this.scene.attach(ch);
      c.dynamic = false; c.scored = false; c.vel.set(0, 0, 0); c.ang.set(0, 0, 0);
      c.mesh.position.copy(c.home); c.mesh.rotation.set(0, 0, 0);
    }
  }

  update(dt) {
    // targets: damped spring toward 0 (up) or 90° (down)
    for (const t of this.targets) {
      if (t.down) { t.timer -= dt; if (t.timer <= 0) { t.down = false; t.vel = -2; } }
      const goal = t.down ? Math.PI / 2 : 0;
      t.vel += ((goal - t.angle) * 140 - t.vel * 9) * dt;
      t.angle += t.vel * dt;
      if (t.angle > Math.PI / 2) { t.angle = Math.PI / 2; t.vel *= -0.35; }
      t.pivot.rotation.x = t.angle;
    }

    // cans
    for (const c of this.cans) {
      if (!c.dynamic) {
        if (c.supports.some(s => s.dynamic)) this.knock(c, new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5));
        continue;
      }
      if (c.restT > 1.2) continue;
      const m = c.mesh;
      c.vel.y -= 9.81 * dt;
      // horizontal: sweep against the house geometry
      const hv = this._axis.set(c.vel.x, 0, c.vel.z);
      const hl = hv.length() * dt;
      if (hl > 1e-5) {
        hv.normalize();
        this.ray.set(this._v.copy(m.position), hv);
        this.ray.far = hl + CAN_R;
        const h = this.ray.intersectObjects(this.hitMeshes, false).find(x => x.object !== m);
        if (h) {
          const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
          if (Math.abs(n.y) < 0.7) {
            n.y = 0; n.normalize();
            const vn = c.vel.x * n.x + c.vel.z * n.z;
            if (vn < 0) { c.vel.x -= 1.4 * vn * n.x; c.vel.z -= 1.4 * vn * n.z; }
            if (h.object.userData.can) this.knock(h.object.userData.can, this._v.set(-n.x, 0.2, -n.z).multiplyScalar(-vn * 0.6));
          }
        } else {
          m.position.x += c.vel.x * dt; m.position.z += c.vel.z * dt;
        }
      }
      // vertical: find the surface below
      m.position.y += c.vel.y * dt;
      this.ray.set(this._v.set(m.position.x, m.position.y + 0.15, m.position.z), DOWN);
      this.ray.far = 20;
      const below = this.ray.intersectObjects(this.hitMeshes, false).find(x => x.object !== m);
      const ground = (below ? below.point.y : 0) + CAN_R;
      if (m.position.y < ground) {
        m.position.y = ground;
        if (c.vel.y < -1) this.sfx.can(m.position, -c.vel.y / 6);
        c.vel.y *= -0.3;
        c.vel.x *= 0.75; c.vel.z *= 0.75;
        c.ang.multiplyScalar(0.6);
        if (Math.abs(c.vel.y) < 0.4) {
          c.vel.y = 0;
          // settle lying on its side, rolling a little
          const e = m.rotation;
          const tx = Math.round((e.x - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
          e.x += (tx - e.x) * Math.min(1, dt * 12);
          e.z += (Math.round(e.z / Math.PI) * Math.PI - e.z) * Math.min(1, dt * 12);
          c.ang.x *= 0.9; c.ang.z *= 0.9;
        }
      }
      m.rotation.x += c.ang.x * dt; m.rotation.y += c.ang.y * dt; m.rotation.z += c.ang.z * dt;
      if (c.vel.lengthSq() < 0.01 && m.position.y <= ground + 0.001) c.restT += dt; else c.restT = 0;
    }
  }
}
