import * as THREE from 'three';
import { softDot } from './textures.js';

const GRAVITY = 9.81;
const DART_LEN = 0.072 * 1.15;
const DART_R = 0.0065 * 1.15;

// Pooled foam darts with swept-raycast collision, bounce, suction-stick and rest.
export class Darts {
  constructor(scene, hitMeshes, sfx, { count = 64 } = {}) {
    this.scene = scene;
    this.hitMeshes = hitMeshes;
    this.sfx = sfx;
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.list = [];
    this.onHit = null; // (dart, hit) => void   (targets / cans)

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.95 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xc81b24, roughness: 0.5 });
    const bodyGeo = new THREE.CylinderGeometry(DART_R, DART_R, DART_LEN * 0.82, 12).rotateX(Math.PI / 2).translate(0, 0, -DART_LEN * 0.09);
    const tipGeo = new THREE.CylinderGeometry(DART_R * 1.08, DART_R * 1.12, DART_LEN * 0.18, 12).rotateX(Math.PI / 2).translate(0, 0, DART_LEN * 0.41);
    const capGeo = new THREE.SphereGeometry(DART_R * 1.08, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, DART_LEN * 0.5);
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.25, depthWrite: false });
    const streakGeo = new THREE.ConeGeometry(DART_R * 0.9, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);

    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const tip = new THREE.Mesh(tipGeo, tipMat);
      const cap = new THREE.Mesh(capGeo, tipMat);
      const streak = new THREE.Mesh(streakGeo, streakMat);
      streak.position.z = -DART_LEN * 0.5;
      body.castShadow = tip.castShadow = true;
      g.add(body, tip, cap, streak);
      g.visible = false;
      scene.add(g);
      this.list.push({ obj: g, streak, state: 'free', pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), age: 0, bounces: 0, restAt: 0 });
    }

    // impact puffs
    this.puffs = [];
    const dotTex = softDot();
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 0.05 });
    }
    this._puffI = 0;
    this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3(); this._n = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  get activeCount() { return this.list.filter(d => d.state !== 'free').length; }

  spawn(pos, vel) {
    let d = this.list.find(x => x.state === 'free');
    if (!d) return null;
    if (d.obj.parent !== this.scene) this.scene.attach(d.obj);
    d.state = 'fly'; d.age = 0; d.bounces = 0;
    d.pos.copy(pos); d.vel.copy(vel);
    d.spin.set(0, 0, (Math.random() - 0.5) * 30);
    d.obj.position.copy(pos);
    d.obj.visible = true;
    d.streak.visible = true;
    this._orient(d);
    return d;
  }

  free(d) {
    d.state = 'free';
    d.obj.visible = false;
    if (d.obj.parent !== this.scene) this.scene.attach(d.obj);
  }

  _orient(d) {
    this._tmp.copy(d.pos).add(d.vel);
    d.obj.lookAt(this._tmp);
  }

  puff(pos, normal, n = 6, color = 0xffffff, speed = 0.8, size = 0.05, life = 0.35) {
    for (let i = 0; i < n; i++) {
      const p = this.puffs[this._puffI++ % this.puffs.length];
      p.s.position.copy(pos);
      p.s.material.color.setHex(color);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(speed);
      if (normal) p.vel.addScaledVector(normal, speed * (0.6 + Math.random()));
      p.life = 0; p.max = life * (0.7 + Math.random() * 0.6); p.size = size * (0.6 + Math.random() * 0.8);
      p.s.visible = true;
    }
  }

  update(dt) {
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.s.visible = false; continue; }
      p.vel.multiplyScalar(Math.exp(-dt * 6));
      p.vel.y += dt * 0.15;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size * (1 + k * 2.5));
      p.s.material.opacity = 0.55 * (1 - k) * (1 - k);
    }

    for (const d of this.list) {
      if (d.state !== 'fly') continue;
      d.age += dt;
      // integrate with substeps for fast darts
      const steps = Math.max(1, Math.ceil(d.vel.length() * dt / 0.25));
      const h = dt / steps;
      for (let s = 0; s < steps && d.state === 'fly'; s++) this._step(d, h);
      if (d.state === 'fly') {
        d.obj.position.copy(d.pos);
        const speed = d.vel.length();
        if (d.bounces === 0) {
          this._orient(d);
          d.obj.rotateZ(d.age * d.spin.z);
        } else {
          // tumble
          d.obj.rotateX(d.spin.x * dt); d.obj.rotateY(d.spin.y * dt);
        }
        d.streak.visible = speed > 8 && d.bounces === 0;
        if (d.streak.visible) d.streak.scale.set(1, 1, Math.min(0.5, speed * 0.012));
      }
      if (d.age > 12 && d.state === 'fly') this._rest(d, d.pos.clone().setY(Math.max(DART_R, d.pos.y)), new THREE.Vector3(0, 1, 0));
    }
  }

  _step(d, h) {
    const v = d.vel;
    // foam darts: strong drag, a bit of lift-less drop
    const drag = 0.012 * v.length();
    v.multiplyScalar(Math.max(0, 1 - drag * h));
    v.y -= GRAVITY * h;
    const move = this._tmp2.copy(v).multiplyScalar(h);
    const dist = move.length();
    if (dist < 1e-6) return;
    const dir = move.clone().divideScalar(dist);
    // cast from the tail so the tip lands on the surface
    this.ray.set(d.pos, dir);
    this.ray.far = dist + DART_LEN * 0.5;
    const hits = this.ray.intersectObjects(this.hitMeshes, false);
    if (hits.length) {
      this._collide(d, hits[0], dir);
    } else {
      d.pos.add(move);
      if (d.pos.y < DART_R) { // safety: never below the floor
        this._collide(d, { point: d.pos.clone().setY(0), object: null, face: { normal: new THREE.Vector3(0, 1, 0) }, floor: true }, dir);
      }
    }
  }

  _collide(d, hit, dir) {
    const n = this._n;
    if (hit.face) {
      n.copy(hit.face.normal);
      if (hit.object) n.transformDirection(hit.object.matrixWorld);
    } else n.set(0, 1, 0);
    if (n.dot(dir) > 0) n.negate();
    const speed = d.vel.length();
    const vn = d.vel.dot(n);
    const head = -vn / Math.max(speed, 1e-4); // 1 = head-on
    const surface = hit.object?.material?.userData?.surface || 'wood';

    const consumed = this.onHit ? this.onHit(d, hit, n, surface) : false;

    // impact FX + sound
    if (speed > 1.2) {
      const tint = surface === 'soft' ? 0xd8d0c4 : 0xffffff;
      this.puff(hit.point, n, Math.min(8, 2 + Math.floor(speed / 3)), tint, 0.5 + speed * 0.04, 0.035, 0.3);
      if (!consumed) this.sfx.impact(hit.point, surface, speed / 18);
    }

    // suction-tip stick on vertical, hard surfaces when hit head-on and fast
    if (d.bounces === 0 && speed > 9 && head > 0.82 && Math.abs(n.y) < 0.6 && surface !== 'soft' && Math.random() < 0.4) {
      d.state = 'stuck';
      d.streak.visible = false;
      d.pos.copy(hit.point).addScaledVector(n, DART_LEN * 0.5 - 0.004);
      d.obj.position.copy(d.pos);
      this._tmp.copy(d.pos).sub(n);
      d.obj.lookAt(this._tmp);
      d.obj.rotateZ(Math.random() * 6);
      // wobble angle so it's not perfectly perpendicular
      d.obj.rotateX((Math.random() - 0.5) * 0.12); d.obj.rotateY((Math.random() - 0.5) * 0.12);
      if (hit.object && hit.object.userData.dynamic) hit.object.attach(d.obj);
      return;
    }

    // bounce
    const e = surface === 'soft' ? 0.12 : surface === 'glass' || surface === 'tile' ? 0.42 : 0.32;
    d.vel.addScaledVector(n, -(1 + e) * vn);
    // tangential friction
    const vnAfter = d.vel.dot(n);
    const tang = this._tmp.copy(d.vel).addScaledVector(n, -vnAfter);
    d.vel.copy(tang.multiplyScalar(0.55)).addScaledVector(n, vnAfter);
    d.pos.copy(hit.point).addScaledVector(n, DART_R * 1.5);
    d.bounces++;
    d.streak.visible = false;
    d.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0).multiplyScalar(Math.min(1, speed / 10));
    if (n.y > 0.65 && d.vel.length() < 0.9) this._rest(d, hit.point, n, hit.object);
  }

  _rest(d, point, n, object) {
    d.state = 'rest';
    d.streak.visible = false;
    d.pos.copy(point).addScaledVector(n, DART_R);
    d.obj.position.copy(d.pos);
    // lie flat along the last horizontal heading
    const h = this._tmp.set(d.vel.x, 0, d.vel.z);
    if (h.lengthSq() < 1e-6) h.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    h.normalize();
    d.obj.lookAt(this._tmp2.copy(d.pos).add(h));
    d.obj.rotateZ(Math.random() * 6);
    if (object && object.userData.dynamic) object.attach(d.obj);
  }

  // darts resting / stuck within radius of a point -> collected count
  collect(center, radius, filter = () => true) {
    let n = 0;
    const p = this._tmp;
    for (const d of this.list) {
      if (d.state !== 'rest' && d.state !== 'stuck') continue;
      d.obj.getWorldPosition(p);
      if (p.distanceTo(center) < radius && filter(d, p)) { this.free(d); n++; }
    }
    return n;
  }

  countNear(center, radius) {
    let n = 0;
    const p = this._tmp;
    for (const d of this.list) {
      if (d.state !== 'rest' && d.state !== 'stuck') continue;
      d.obj.getWorldPosition(p);
      if (p.distanceTo(center) < radius) n++;
    }
    return n;
  }
}
