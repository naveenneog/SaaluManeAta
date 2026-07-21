// Richer, softer 3D: a soothing vertical-gradient sky as the scene background AND
// a PMREM environment map derived from it, so metallic pieces pick up gentle
// reflections (Chaturanga-grade sheen without shipping heavy HDRIs or GLBs).
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

function gradientCanvas(top, mid, bottom) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.0, top); grd.addColorStop(0.55, mid); grd.addColorStop(1.0, bottom);
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  return c;
}

// Apply a soothing gradient background + soft environment. `colors` = {top, mid, bottom}.
// Returns the environment texture (already assigned to scene.environment).
export function applyEnvironment(renderer, scene, colors) {
  const bg = new THREE.CanvasTexture(gradientCanvas(colors.top, colors.mid, colors.bottom));
  bg.colorSpace = THREE.SRGBColorSpace; bg.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = bg;
  const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
  const envSrc = new THREE.CanvasTexture(gradientCanvas(colors.top, colors.mid, colors.bottom));
  envSrc.mapping = THREE.EquirectangularReflectionMapping;
  const rt = pmrem.fromEquirectangular(envSrc);
  scene.environment = rt.texture;
  envSrc.dispose();
  return rt.texture;
}

// A soft radial "contact shadow" disc under the board for a grounded, premium feel.
export function addContactShadow(scene, radius = 8, y = -0.02, strength = 0.5) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, `rgba(0,0,0,${strength})`); grd.addColorStop(0.7, `rgba(0,0,0,${strength * 0.4})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = -1; scene.add(m);
  return m;
}

// REALISTIC mode: load a warm environment image for physically-based image lighting
// (real reflections + fill), assigned to scene.environment. Background stays whatever
// the caller set (a soft studio gradient). Fails silently if the image is missing.
export function applyRealistic(renderer, scene, envUrl) {
  const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
  new THREE.TextureLoader().load(envUrl, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
  }, undefined, () => { /* env optional */ });
}

// Load a repeating, colour-managed texture (wood grain, cloth, ...) for a board surface.
export function loadTexture(url, repeat = [1, 1], srgb = true) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A 3D "world the board stays in": a large wooden table the board rests on, a soft
// floor below, and a gentle domed backdrop — so the realistic board sits in a real
// place rather than floating. `tableY` is the table-top height (board slab sits on it).
export function addTableWorld(scene, { radius = 10, tableY = -0.18, woodUrl, tableUrl, tableRepeat = [3, 3], floorHex = 0x1a140c }) {
  // Prefer a dedicated seamless tabletop tile (tableUrl); fall back to the board art
  // (woodUrl) at a modest repeat. If tableUrl 404s at load, swap back to woodUrl so
  // worlds that ship no table.jpg still render a valid tabletop.
  const tableMat = new THREE.MeshStandardMaterial(
    (tableUrl || woodUrl) ? { roughness: 0.5, metalness: 0.06, envMapIntensity: 1.1 } : { color: 0x5a3a1e, roughness: 0.55, metalness: 0.06 },
  );
  const applyTex = (url, repeat) => {
    const t = new THREE.TextureLoader().load(url, undefined, undefined, () => {
      if (url !== woodUrl && woodUrl) applyTex(woodUrl, [3, 3]); // graceful fallback
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    tableMat.map = t; tableMat.needsUpdate = true;
  };
  if (tableUrl) applyTex(tableUrl, tableRepeat);
  else if (woodUrl) applyTex(woodUrl, [3, 3]);
  // the table: a broad rounded wooden slab the board rests upon
  const table = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, 0.6, 64), tableMat);
  table.position.y = tableY - 0.3; table.receiveShadow = true; scene.add(table);
  // a soft rounded lip so the table edge catches light
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 12, 64), new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.4, metalness: 0.3, envMapIntensity: 1.0 }));
  lip.rotation.x = Math.PI / 2; lip.position.y = tableY; scene.add(lip);
  // the floor far below
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius * 6, 48), new THREE.MeshStandardMaterial({ color: floorHex, roughness: 0.95, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = tableY - 3.2; floor.receiveShadow = true; scene.add(floor);
  return table;
}

// ---- carved 3D piece models (realistic worlds) ----
// Load a carved GLB piece (from the TripoSR sculpt pipeline), normalized to `targetH`
// with its base resting at y = 0 and centred on X/Z. Returns a prototype Object3D to
// clone per instance, or null if the model is missing so callers fall back to procedural
// geometry. The baked concept texture (carved grain + AO) is kept for realism.
export async function loadPieceModel(url, targetH = 0.7) {
  try {
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
    const obj = gltf.scene;
    let box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    obj.scale.setScalar(targetH / (size.y || 1));
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj);
    const c = new THREE.Vector3(); box.getCenter(c);
    obj.position.set(-c.x, -box.min.y, -c.z);
    obj.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; } });
    const proto = new THREE.Group(); proto.add(obj);
    return proto;
  } catch { return null; }
}

// Clone a piece prototype and stain it toward `tintHex` (multiplies the baked carved
// texture, so grain + shading stay visible). De-emissive PBR wood so it reads real, not
// glowing. Returns a fresh Group with its own materials.
export function tintPiece(proto, tintHex) {
  const g = proto.clone(true);
  const col = new THREE.Color(tintHex);
  g.traverse((n) => {
    if (!n.isMesh) return;
    const m = n.material.clone();
    m.color = col.clone();
    if ('metalness' in m) m.metalness = 0.06;
    if ('roughness' in m) m.roughness = Math.max(0.45, m.roughness ?? 0.6);
    m.envMapIntensity = 1.0;
    if (m.emissive) { m.emissive = new THREE.Color(0x000000); m.emissiveIntensity = 0; }
    n.material = m; n.castShadow = true;
  });
  return g;
}
