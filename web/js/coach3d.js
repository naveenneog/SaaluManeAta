import * as THREE from '../vendor/three.module.js';

const COLORS = {
  gain: 0xe8c24a,
  danger: 0xff5148,
  path: 0xf4f0e6,
};

export function createCoachOverlay({ scene }) {
  const entries = [];
  let preferences = { quality: 'high', reducedMotion: false };

  function material(role, opacity = 0.9, ghost = false) {
    const color = COLORS[role] || COLORS.path;
    const mat = role === 'path'
      ? new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false })
      : new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.25,
        transparent: opacity < 1,
        opacity,
        roughness: 0.38,
        metalness: 0.25,
        depthWrite: false,
      });
    mat.userData.coach = { role, opacity, ghost };
    return mat;
  }

  function track(object, { pulse = false, fill = false, materials = [] } = {}) {
    object.renderOrder = 8;
    scene.add(object);
    entries.push({ object, pulse, fill, materials, phase: Math.random() * Math.PI * 2 });
    applyPreferences(entries[entries.length - 1]);
    return object;
  }

  function applyPreferences(entry) {
    const low = preferences.quality === 'low';
    entry.object.visible = !(entry.fill && low);
    for (const mat of entry.materials) {
      const meta = mat.userData.coach;
      if (!meta) continue;
      if ('emissiveIntensity' in mat) mat.emissiveIntensity = low ? 0 : 1.25;
      mat.opacity = low ? Math.min(1, meta.opacity + 0.08) : meta.opacity;
      mat.wireframe = !!(low && meta.ghost);
      mat.needsUpdate = true;
    }
  }

  function ring(position, role, radius, y = 0.13) {
    const mat = material(role, 0.94);
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 10, 36), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y += y;
    return track(mesh, { pulse: true, materials: [mat] });
  }

  function destination(position, { radius = 0.42, y = 0.13 } = {}) {
    ring(position, 'gain', radius, y);
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.gain,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.userData.coach = { role: 'gain', opacity: 0.12, ghost: false };
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.78, 32), mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(position);
    disc.position.y += y - 0.015;
    track(disc, { fill: true, materials: [mat] });
  }

  function danger(position, { radius = 0.4, y = 0.15 } = {}) {
    ring(position, 'danger', radius, y);
    const mat = material('danger', 0.76);
    const cross = new THREE.Group();
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.1, 0.025, 0.035), mat);
      bar.rotation.y = angle;
      cross.add(bar);
    }
    cross.position.copy(position);
    cross.position.y += y;
    track(cross, { materials: [mat] });
  }

  function path(points, { y = 0.18 } = {}) {
    if (!points || points.length < 2) return;
    const positions = points.map((point) => new THREE.Vector3(point.x, point.y + y, point.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(positions);
    const mat = new THREE.LineDashedMaterial({
      color: COLORS.path,
      transparent: true,
      opacity: preferences.quality === 'low' ? 0.72 : 0.58,
      dashSize: 0.18,
      gapSize: 0.12,
      depthWrite: false,
    });
    mat.userData.coach = { role: 'path', opacity: 0.58, ghost: false };
    const line = new THREE.Line(geometry, mat);
    line.computeLineDistances();
    track(line, { materials: [mat] });
  }

  function ghosts(points, { role = 'path', radius = 0.085, max = 48 } = {}) {
    if (!points?.length) return;
    const count = Math.min(points.length, preferences.quality === 'low' ? Math.min(max, 24) : max);
    const chosen = count === points.length
      ? points
      : Array.from({ length: count }, (_, i) => points[Math.round(i * (points.length - 1) / Math.max(1, count - 1))]);
    const geometry = new THREE.SphereGeometry(radius, 8, 6);
    const mat = material(role, role === 'path' ? 0.52 : 0.78, true);
    const mesh = new THREE.InstancedMesh(geometry, mat, chosen.length);
    const matrix = new THREE.Matrix4();
    chosen.forEach((point, i) => {
      matrix.makeTranslation(point.x, point.y, point.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    track(mesh, { materials: [mat] });
  }

  function clear() {
    while (entries.length) {
      const { object, materials } = entries.pop();
      scene.remove(object);
      object.traverse?.((child) => child.geometry?.dispose?.());
      for (const mat of new Set(materials)) mat.dispose();
    }
  }

  function setPreferences(settings = {}) {
    preferences = {
      quality: settings.quality || preferences.quality,
      reducedMotion: settings.reducedMotion ?? preferences.reducedMotion,
    };
    entries.forEach(applyPreferences);
  }

  function update(now = performance.now()) {
    for (const entry of entries) {
      if (!entry.pulse) continue;
      const scale = preferences.reducedMotion ? 1 : 1 + Math.sin(now * 0.003 + entry.phase) * 0.055;
      entry.object.scale.setScalar(scale);
    }
  }

  return {
    destination,
    danger,
    path,
    ghosts,
    clear,
    update,
    setPreferences,
    info: () => ({
      objects: entries.length,
      quality: preferences.quality,
      reducedMotion: preferences.reducedMotion,
    }),
  };
}
