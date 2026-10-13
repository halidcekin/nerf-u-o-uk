import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// BVH-accelerated raycasts for every mesh (darts, aiming, cans).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const isDynamic = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.dynamic) return true; return false; };

// Merge all static meshes under `root` that share a material into one mesh each.
// ~1500 draw calls → a few dozen. Updates `hitMeshes` in place.
export function mergeStatic(root, hitMeshes) {
  root.updateMatrixWorld(true);
  const toWorldOfRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (Array.isArray(o.material) || o.material.transparent || isDynamic(o)) return;
    const g = o.geometry;
    if (Object.keys(g.morphAttributes).length) return;
    const attrs = Object.keys(g.attributes).sort().map(k => `${k}${g.attributes[k].itemSize}${g.attributes[k].normalized ? 'n' : ''}${g.attributes[k].array.constructor.name}`).join(',');
    const key = `${o.material.uuid}|${attrs}|${g.index ? 'i' : 'n'}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });

  const hitSet = new Set(hitMeshes);
  let before = 0, after = 0;
  for (const meshes of groups.values()) {
    before += meshes.length;
    if (meshes.length < 2) { after += meshes.length; continue; }
    const geos = meshes.map(m => {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toWorldOfRoot, m.matrixWorld));
      if (m.matrixWorld.determinant() < 0) { // mirrored: keep winding consistent
        const idx = g.index;
        if (idx) for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, t); }
      }
      return g;
    });
    let merged;
    try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    geos.forEach(g => g.dispose());
    if (!merged) { after += meshes.length; continue; }
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.name = 'merged:' + (first.material.name || first.material.type);
    let hit = false;
    for (const m of meshes) {
      if (hitSet.has(m)) { hit = true; hitSet.delete(m); }
      m.removeFromParent();
    }
    root.add(mesh);
    if (hit) hitSet.add(mesh);
    after++;
  }
  // drop now-empty groups
  const empty = [];
  root.traverse(o => { if (o !== root && !o.isMesh && !o.isLight && o.children.length === 0 && !isDynamic(o)) empty.push(o); });
  empty.forEach(o => o.removeFromParent());

  hitMeshes.length = 0;
  hitMeshes.push(...hitSet);
  for (const m of hitMeshes) if (m.geometry && !m.geometry.boundsTree) m.geometry.computeBoundsTree();
  return { before, after };
}

export function bvh(meshes) {
  for (const m of meshes) if (m.geometry && !m.geometry.boundsTree) m.geometry.computeBoundsTree();
}
