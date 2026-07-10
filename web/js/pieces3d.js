// Procedural 3D objects for Saalu Mane Ata: a board "socket" at each of the 24
// points and a glowing carved stone for each player. Emissive so the bloom pass
// gives them their glow. Base at y = 0.
import * as THREE from '../vendor/three.module.js';

const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; return m; };

// a recessed glowing socket where a stone can sit
export function makeNode(mat, ringMat) {
  const g = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 24), mat, false);
  base.receiveShadow = true; g.add(base);
  const ring = mesh(new THREE.TorusGeometry(0.2, 0.025, 10, 28), ringMat || mat, false);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  return g;
}

// a polished stone / seed with a carved rim and a glowing cabochon on top
export function makeStone(mats) {
  const { body, rim, gem } = mats;
  const g = new THREE.Group();
  const stone = mesh(new THREE.SphereGeometry(0.26, 24, 18), body);
  stone.scale.set(1, 0.62, 1); stone.position.y = 0.17; g.add(stone);
  const band = mesh(new THREE.TorusGeometry(0.2, 0.035, 12, 28), rim, false);
  band.rotation.x = Math.PI / 2; band.position.y = 0.13; g.add(band);
  const cab = mesh(new THREE.SphereGeometry(0.09, 16, 12), gem, false);
  cab.scale.set(1, 0.7, 1); cab.position.y = 0.3; g.add(cab);
  g.userData.pickR = 0.3;
  return g;
}
