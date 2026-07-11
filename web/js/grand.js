import * as THREE from '../vendor/three.module.js';

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2);

function particleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.18, 'rgba(255,238,174,.92)');
  glow.addColorStop(0.55, 'rgba(255,170,54,.28)');
  glow.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePoints(count, color, size, texture, opacity = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function openingTitle(world) {
  const root = document.createElement('div');
  root.id = 'cinematic-title';
  root.setAttribute('aria-hidden', 'true');
  const kannada = document.createElement('div');
  kannada.className = 'cinematic-kannada';
  kannada.textContent = world.kannada || '';
  const english = document.createElement('div');
  english.className = 'cinematic-english';
  english.textContent = world.title || '';
  const rule = document.createElement('div');
  rule.className = 'cinematic-rule';
  root.append(kannada, english, rule);
  document.body.appendChild(root);
  return root;
}

export async function playOpening({ world, canvas, getView, setView, place, reducedMotion = false }) {
  const title = openingTitle(world);
  const finish = getView();
  if (reducedMotion || document.body.classList.contains('tbg-reduced-motion')) {
    title.style.opacity = '1';
    await new Promise((resolve) => setTimeout(resolve, 500));
    title.remove();
    return;
  }

  const start = {
    az: finish.az - 0.42,
    pol: Math.max(0.22, finish.pol * 0.42),
    dist: finish.dist * 1.58,
  };
  setView(start);
  place();

  let done = false;
  let raf = 0;
  let resolveOpening;
  const completed = new Promise((resolve) => { resolveOpening = resolve; });
  const skip = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    done = true;
    resolveOpening();
  };
  canvas.addEventListener('pointerdown', skip, { capture: true });

  const t0 = performance.now();
  const frame = (now) => {
    if (done) return;
    if (document.body.classList.contains('tbg-reduced-motion')) {
      done = true;
      resolveOpening();
      return;
    }
    const p = clamp01((now - t0) / 2500);
    const e = easeInOutCubic(p);
    setView({
      az: start.az + (finish.az - start.az) * e,
      pol: start.pol + (finish.pol - start.pol) * e,
      dist: start.dist + (finish.dist - start.dist) * e,
    });
    place();
    const alpha = Math.min(clamp01(p / 0.14), clamp01((1 - p) / 0.25));
    title.style.opacity = String(alpha);
    title.style.transform = `translateY(${(1 - e) * 14}px) scale(${0.96 + e * 0.04})`;
    if (p < 1) raf = requestAnimationFrame(frame);
    else { done = true; resolveOpening(); }
  };
  raf = requestAnimationFrame(frame);
  await completed;
  cancelAnimationFrame(raf);
  canvas.removeEventListener('pointerdown', skip, { capture: true });
  setView(finish);
  place();
  title.style.opacity = '0';
  setTimeout(() => title.remove(), 320);
}

export function createGrandEffects({ scene, boardRadius, accent, realistic, mobile }) {
  const texture = particleTexture();
  const effects = [];

  const rim = new THREE.DirectionalLight(0x9bc7ff, realistic ? 0.62 : 0.78);
  rim.position.set(-8, 7, -9);
  scene.add(rim);

  const heroTarget = new THREE.Object3D();
  heroTarget.position.set(0, 0, 0);
  scene.add(heroTarget);
  const hero = new THREE.SpotLight(0xffd39a, realistic ? 48 : 38, boardRadius * 5, 0.68, 0.88, 1.35);
  hero.position.set(1.5, 12, 3.5);
  hero.target = heroTarget;
  scene.add(hero);

  const dustCount = mobile ? (realistic ? 16 : 22) : (realistic ? 42 : 64);
  const dust = makePoints(dustCount, realistic ? 0xffd9a0 : accent, mobile ? 0.045 : 0.06, texture, realistic ? 0.24 : 0.32);
  const dustPos = dust.geometry.attributes.position.array;
  const dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    const j = i * 3;
    dustPos[j] = (Math.random() - 0.5) * boardRadius * 2.4;
    dustPos[j + 1] = 0.35 + Math.random() * 5.5;
    dustPos[j + 2] = (Math.random() - 0.5) * boardRadius * 2.1;
    dustSeed[i] = Math.random() * Math.PI * 2;
  }
  scene.add(dust);
  let dustActive = true;

  function burst(position) {
    const count = mobile ? 18 : 34;
    const points = makePoints(count, 0xffb33c, mobile ? 0.13 : 0.16, texture);
    const positions = points.geometry.attributes.position.array;
    const velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      positions[j] = position.x;
      positions[j + 1] = position.y + 0.18;
      positions[j + 2] = position.z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.3;
      velocity[j] = Math.cos(angle) * speed;
      velocity[j + 1] = 1.2 + Math.random() * 2.8;
      velocity[j + 2] = Math.sin(angle) * speed;
    }
    scene.add(points);
    effects.push({ kind: 'burst', points, velocity, age: 0, life: 0.75 });
  }

  function victoryShower() {
    const count = mobile ? 72 : 150;
    const points = makePoints(count, 0xffd66b, mobile ? 0.12 : 0.15, texture);
    const positions = points.geometry.attributes.position.array;
    const velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      positions[j] = (Math.random() - 0.5) * boardRadius * 1.7;
      positions[j + 1] = 3.5 + Math.random() * 5;
      positions[j + 2] = (Math.random() - 0.5) * boardRadius * 1.5;
      velocity[j] = (Math.random() - 0.5) * 0.7;
      velocity[j + 1] = -(1.1 + Math.random() * 1.8);
      velocity[j + 2] = (Math.random() - 0.5) * 0.7;
    }
    scene.add(points);
    effects.push({ kind: 'shower', points, velocity, age: 0, life: 3.8 });
  }

  let last = performance.now();
  function update(now = performance.now()) {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    const time = now * 0.00025;
    if (dustActive) {
      for (let i = 0; i < dustCount; i++) {
        const j = i * 3;
        dustPos[j] += Math.sin(time + dustSeed[i]) * dt * 0.055;
        dustPos[j + 1] += dt * (0.025 + (i % 4) * 0.008);
        dustPos[j + 2] += Math.cos(time * 0.8 + dustSeed[i]) * dt * 0.04;
        if (dustPos[j + 1] > 5.9) dustPos[j + 1] = 0.35;
      }
      dust.geometry.attributes.position.needsUpdate = true;
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      fx.age += dt;
      const positions = fx.points.geometry.attributes.position.array;
      const count = positions.length / 3;
      for (let p = 0; p < count; p++) {
        const j = p * 3;
        positions[j] += fx.velocity[j] * dt;
        positions[j + 1] += fx.velocity[j + 1] * dt;
        positions[j + 2] += fx.velocity[j + 2] * dt;
        if (fx.kind === 'burst') {
          fx.velocity[j] *= 0.97;
          fx.velocity[j + 1] -= 5.2 * dt;
          fx.velocity[j + 2] *= 0.97;
        } else {
          fx.velocity[j + 1] -= 0.16 * dt;
        }
      }
      fx.points.material.opacity = Math.min(1, (fx.life - fx.age) * 1.6);
      fx.points.geometry.attributes.position.needsUpdate = true;
      if (fx.age >= fx.life) {
        scene.remove(fx.points);
        fx.points.geometry.dispose();
        fx.points.material.dispose();
        effects.splice(i, 1);
      }
    }
  }

  function setVisualSettings({ quality = 'high', reducedMotion = false } = {}) {
    const factor = quality === 'high' ? 1 : quality === 'balanced' ? 0.5 : 0;
    const visibleCount = reducedMotion ? 0 : Math.floor(dustCount * factor);
    dust.geometry.setDrawRange(0, visibleCount);
    dust.visible = visibleCount > 0;
    dustActive = dust.visible;
  }

  return {
    update,
    burst,
    victoryShower,
    setVisualSettings,
    info: () => ({ dustVisible: dust.visible, dustCount: dust.geometry.drawRange.count }),
  };
}
