// Saalu Mane Ata — real 3D renderer (Three.js + Unreal bloom). Three nested
// glowing squares, carved stones, taps to place/move/fly/remove, minimax AI,
// and the world's teaching revealed on a mill, a capture and the win.
import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import { POINTS, ADJ, newGame, legalMoves, applyMove, bestMove, canFly, other } from './logic.js';
import { makeNode, makeStone } from './pieces3d.js';
import { applyEnvironment, addContactShadow, applyRealistic, loadTexture, addTableWorld, loadPieceModel, tintPiece } from './sky.js';
import { initTutorial } from './tutorial.js';
import { createGrandEffects, playOpening } from './grand.js';
import { initSave } from './save.js';
import { initSettings, applySettings } from './settings.js';
import { createCoachOverlay } from './coach3d.js';
import { initLearn } from './learn.js';
import * as audio from './audio.js';

const $ = (s) => document.querySelector(s);
const hexInt = (h) => parseInt(String(h || '#000').replace('#', ''), 16) || 0;
const hexBlend = (a, b, t) => { a = hexInt(a); b = hexInt(b); const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t); return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const tween = (dur, fn) => new Promise((res) => { const t0 = performance.now(); const step = () => { const p = Math.min(1, (performance.now() - t0) / dur); fn(p); p < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const SP = 1.5;

async function main() {
  const params = new URLSearchParams(location.search);
  let cfg = {}; try { cfg = JSON.parse(sessionStorage.getItem('sma.game') || '{}'); } catch { cfg = {}; }
  const worldId = (params.get('world') || cfg.world || 'parampare').replace(/[^a-z]/gi, '');
  const world = await (await fetch(`worlds/${worldId}.json`)).json();
  const T = world.theme || {};
  const REALISTIC = !!world.realistic;
  document.body.classList.add('cinematic-opening');
  const mode = params.get('mode') || cfg.mode || 'ai';
  const humanSide = +(params.get('side') ?? cfg.side ?? 0) ? 1 : 0;
  const level = Math.max(1, Math.min(3, +(params.get('level') || cfg.level || 2)));
  document.title = `${world.title} — Saalu Mane Ata`;
  $('#title').textContent = world.title; $('#kn').textContent = world.kannada || '';
  const nameOf = (p) => (p === 0 ? world.sides.p0.name : world.sides.p1.name);
  const controls = (side) => mode === 'hotseat' || side === humanSide;

  let state = newGame(); let busy = false, selected = null, targets = [], learning = false;

  // ---- three ----
  const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 760;
  const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !MOBILE; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  $('#stage').appendChild(renderer.domElement);
  const gl = renderer.getContext(); const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const softwareRenderer = gpuInfo && /swiftshader/i.test(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL));

  const scene = new THREE.Scene();
  applyEnvironment(renderer, scene, { top: hexBlend(T.bg, T.accent, REALISTIC ? 0.10 : 0.20), mid: hexBlend(T.bg, T.board, REALISTIC ? 0.35 : 0.55), bottom: T.bg });
  if (REALISTIC && !softwareRenderer) applyRealistic(renderer, scene, 'assets/realistic/env.jpg');
  scene.fog = new THREE.Fog(hexInt(T.fog || T.bg), 24, 64);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
  scene.add(new THREE.HemisphereLight(hexInt(T.accent), hexInt(T.board), 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(5, 13, 6);
  if (!MOBILE) { key.castShadow = true; key.shadow.mapSize.set(2048, 2048); const d = 8; Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 40 }); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.03; }
  scene.add(key); scene.add(new THREE.AmbientLight(0xffffff, 0.16));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), REALISTIC ? 0.08 : (MOBILE ? 0.52 : 0.64), 0.9, REALISTIC ? 0.6 : 0.24);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- board ----
  const pos = POINTS.map(([x, y]) => new THREE.Vector3((x - 3) * SP, 0, (3 - y) * SP));
  const radius = Math.max(...pos.map((p) => Math.hypot(p.x, p.z))) + 1.5;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(radius * 2 + 1.4, 0.3, radius * 2 + 1.4), REALISTIC
    ? new THREE.MeshStandardMaterial({ map: loadTexture('assets/realistic/board.jpg', [2, 2]), roughness: 0.55, metalness: 0.08, envMapIntensity: 1.15 })
    : new THREE.MeshStandardMaterial({ color: hexInt(T.board), roughness: 0.65, metalness: 0.25, envMapIntensity: 0.5 }));
  slab.position.y = -0.18; slab.receiveShadow = true; scene.add(slab);
  addContactShadow(scene, radius + 2, -0.03, 0.5);
  if (REALISTIC) addTableWorld(scene, { radius: (radius + 1.4) * 2.3, tableY: -0.34, woodUrl: 'assets/realistic/board.jpg', floorHex: hexInt(T.bg) });

  const edgeMat = new THREE.MeshStandardMaterial(REALISTIC ? { color: hexInt(T.node), emissive: 0x000000, roughness: 0.4, metalness: 0.85, envMapIntensity: 1.2 } : { color: hexInt(T.node), emissive: hexInt(T.node), emissiveIntensity: 0.7, roughness: 0.45, metalness: 0.45, envMapIntensity: 0.7 });
  const seen = new Set();
  for (let i = 0; i < 24; i++) for (const a of ADJ[i]) {
    const k = i < a ? `${i}-${a}` : `${a}-${i}`; if (seen.has(k)) continue; seen.add(k);
    const p = pos[i], q = pos[a], len = p.distanceTo(q);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), edgeMat);
    t.position.copy(p).add(q).multiplyScalar(0.5); t.position.y = 0.02;
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()); scene.add(t);
  }
  const nodeMat = new THREE.MeshStandardMaterial(REALISTIC ? { color: hexInt(T.node), emissive: 0x000000, roughness: 0.4, metalness: 0.85, envMapIntensity: 1.2 } : { color: hexInt(T.node), emissive: hexInt(T.node), emissiveIntensity: 0.32, roughness: 0.45, metalness: 0.4, envMapIntensity: 0.7 });
  const ringMat = new THREE.MeshStandardMaterial(REALISTIC ? { color: hexInt(T.accent), emissive: 0x000000, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.3 } : { color: hexInt(T.accent), emissive: hexInt(T.accent), emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5, envMapIntensity: 0.9 });
  const nodeMeshes = POINTS.map((_, i) => { const g = makeNode(nodeMat, ringMat); g.position.copy(pos[i]); g.userData.node = i; scene.add(g); return g; });

  const markMat = new THREE.MeshStandardMaterial({ color: hexInt(T.accent), emissive: hexInt(T.accent), emissiveIntensity: 1.3, transparent: true, opacity: 0.9 });
  const removeMat = new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 1.4, transparent: true, opacity: 0.85 });
  const marks = [];
  const selRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 12, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 }));
  selRing.rotation.x = Math.PI / 2; selRing.visible = false; scene.add(selRing);

  const mkMat = (hex, emi) => new THREE.MeshStandardMaterial(REALISTIC ? { color: hexInt(hex), emissive: 0x000000, roughness: 0.5, metalness: 0.15, envMapIntensity: 1.1 } : { color: hexInt(hex), emissive: hexInt(hex), emissiveIntensity: emi, roughness: 0.3, metalness: 0.55, envMapIntensity: 0.8 });
  const stoneMats = [
    { body: mkMat(T.p0, 0.35), rim: mkMat(T.accent, 0.5), gem: mkMat(T.accent, 1.4) },
    { body: mkMat(T.p1, 0.35), rim: mkMat(T.accent, 0.5), gem: mkMat(T.accent, 1.4) },
  ];
  const stones = new Map();   // point -> mesh
  // Realistic worlds use a carved wooden seed (TripoSR sculpt), stained per side —
  // dark tamarind vs pale neem; other worlds keep the glowing procedural stone.
  const woodTint = (hex) => hexBlend(hex, '#ffffff', 0.3);
  const seedProto = REALISTIC ? await loadPieceModel('assets/realistic/models/seed.glb', 0.5) : null;
  function spawn(p, node) {
    const m = seedProto ? tintPiece(seedProto, woodTint(p === 0 ? T.p0 : T.p1)) : makeStone(stoneMats[p]);
    if (m.userData.pickR === undefined) m.userData.pickR = 0.3;
    m.position.copy(pos[node]); m.userData.owner = p; scene.add(m); stones.set(node, m); return m;
  }

  // ---- camera + controls ----
  let az = 0, pol = MOBILE ? 0.5 : 0.62, dist = radius / Math.tan((camera.fov * Math.PI / 180) / 2) * (MOBILE ? 1.2 : 1.02);
  const targetV = new THREE.Vector3();
  function place() { pol = Math.max(0.12, Math.min(1.3, pol)); dist = Math.max(radius * 0.8, Math.min(radius * 3, dist)); camera.position.set(dist * Math.sin(pol) * Math.sin(az), dist * Math.cos(pol), dist * Math.sin(pol) * Math.cos(az)); camera.lookAt(targetV); }
  place();
  const grand = createGrandEffects({ scene, boardRadius: radius, accent: hexInt(T.accent), realistic: REALISTIC, mobile: MOBILE });
  const coach = createCoachOverlay({ scene });
  const canvas = renderer.domElement; const ptrs = new Map(); let dragged = false, pinchD = 0;
  canvas.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, e); dragged = false; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinchD) { dist *= pinchD / d; place(); } pinchD = d; dragged = true; }
    else if (ptrs.size === 1 && (e.buttons || e.pressure)) { const dx = e.clientX - prev.clientX, dy = e.clientY - prev.clientY; if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true; az -= dx * 0.006; pol -= dy * 0.006; place(); }
  });
  canvas.addEventListener('pointerup', (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinchD = 0; if (!dragged) onTap(e); });
  canvas.addEventListener('pointercancel', (e) => ptrs.delete(e.pointerId));
  canvas.addEventListener('wheel', (e) => { dist *= 1 + Math.sign(e.deltaY) * 0.08; place(); }, { passive: true });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); place(); });

  // ---- raycast ----
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pick(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...nodeMeshes, ...stones.values()], true); if (!hits.length) return null;
    let o = hits[0].object; while (o && o.userData.node === undefined && o.userData.owner === undefined && o.parent) o = o.parent;
    if (o && o.userData.node !== undefined) return o.userData.node;
    for (const [node, m] of stones) { let p = hits[0].object; while (p) { if (p === m) return node; p = p.parent; } }
    return null;
  }

  function onTap(e) {
    if (busy || learning || state.winner !== null || !controls(state.turn)) return;
    const node = pick(e); if (node === null) return; clearHint(); audio.unlock(worldId);
    const side = state.turn;
    if (state.removePending) { const mv = legalMoves(state).find((m) => m.at === node); if (mv) commit(mv); return; }
    if (state.toPlace[side] > 0) { if (state.points[node] === null) commit({ type: 'place', to: node }); return; }
    if (state.points[node] === side) { selected = node; targets = legalMoves(state).filter((m) => m.from === node); showTargets(); return; }
    if (selected !== null) { const mv = targets.find((m) => m.to === node); if (mv) { clearTargets(); commit(mv); } }
  }

  function showTargets() {
    clearTargets(); selRing.visible = true; selRing.position.copy(pos[selected]); selRing.position.y = 0.4;
    for (const m of targets) { const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 20), markMat); mk.position.copy(pos[m.to]); mk.position.y = 0.05; scene.add(mk); marks.push(mk); }
  }
  function showRemovable() {
    clearTargets();
    for (const m of legalMoves(state)) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 10, 28), removeMat); r.rotation.x = Math.PI / 2; r.position.copy(pos[m.at]); r.position.y = 0.4; scene.add(r); marks.push(r); }
  }
  function clearTargets() { selRing.visible = false; for (const m of marks) scene.remove(m); marks.length = 0; }

  // ---- commit + animate ----
  async function commit(move) {
    if (busy) return; busy = true; selected = null; clearTargets(); clearHint(); updateUndo();
    save.record();
    const prev = state; state = applyMove(prev, move); await animate(prev, move, state.event); updateHud();
    if (state.event.mill) await reveal('mill', rand(world.teachings.mill));
    if (state.event.type === 'remove') await reveal('remove', rand(world.teachings.remove || world.teachings.mill));
    save.persist();
    if (state.winner !== null) { await onWin(); busy = false; return; }
    busy = false; loop();
  }

  async function animate(prev, move, ev) {
    if (move.type === 'place') { const m = spawn(prev.turn, move.to); m.scale.setScalar(0.01); audio.sfx('place'); await tween(240, (p) => m.scale.setScalar(easeIO(p))); }
    else if (move.type === 'move') {
      const m = stones.get(move.from); stones.delete(move.from); const from = pos[move.from], to = pos[move.to];
      const fly = canFly(prev, prev.turn); audio.sfx(fly ? 'jump' : 'step');
      await tween(fly ? 420 : 300, (p) => { const e = easeIO(p); m.position.set(from.x + (to.x - from.x) * e, Math.sin(e * Math.PI) * (fly ? 1.4 : 0.4), from.z + (to.z - from.z) * e); });
      m.position.copy(to); stones.set(move.to, m);
    } else if (move.type === 'remove') {
      const m = stones.get(move.at); stones.delete(move.at); audio.sfx('capture'); grand.burst(pos[move.at]); settingsApi?.haptic('capture');
      if (m) { await tween(320, (p) => { m.scale.setScalar(1 - p); m.position.y = p * 0.8; }); scene.remove(m); }
    }
    if (ev.mill && ev.type !== 'remove') { audio.sfx('mill'); flashMill(state.lastMill); }
  }

  function flashMill(mill) {
    if (!mill) return;
    for (const idx of mill) {
      const s = stones.get(idx); if (!s) continue;
      const base = 1;
      tween(520, (p) => { const k = 1 + Math.sin(p * Math.PI) * 0.35; s.scale.setScalar(base * k); s.position.y = pos[idx].y + Math.sin(p * Math.PI) * 0.25; })
        .then(() => { s.scale.setScalar(1); s.position.y = pos[idx].y; });
    }
  }

  // ---- AI / loop ----
  async function loop() {
    if (state.winner !== null || busy || learning) return;
    if (state.removePending && controls(state.turn)) { showRemovable(); hintTurn(); updateUndo(); return; }
    if (controls(state.turn)) { hintTurn(); updateUndo(); return; }
    busy = true; $('#thinking').classList.add('show'); await wait(240);
    const mv = await Promise.resolve().then(() => bestMove(state, level));
    $('#thinking').classList.remove('show');
    if (!mv) { state = { ...state, winner: other(state.turn) }; save.clear(); await onWin(); busy = false; return; }
    save.record();
    const prev = state; state = applyMove(prev, mv); await animate(prev, mv, state.event); updateHud();
    if (state.event.mill) await reveal('mill', rand(world.teachings.mill));
    if (state.event.type === 'remove') await reveal('remove', rand(world.teachings.remove || world.teachings.mill));
    save.persist();
    if (state.winner !== null) { await onWin(); busy = false; return; }
    busy = false; loop();
  }

  // ---- reveal + win ----
  const card = $('#card');
  async function reveal(kind, teaching) {
    if (!teaching) return;
    card.querySelector('.kind').textContent = kind === 'mill' ? 'Mill!' : 'Captured';
    card.querySelector('.kind').className = `kind ${kind}`;
    card.querySelector('.en').textContent = teaching.en || ''; card.querySelector('.m').textContent = teaching.text;
    card.classList.add('show'); audio.narrate(teaching.text, world); await wait(1900); card.classList.remove('show'); await wait(220);
  }
  async function onWin() {
    const win = state.winner;
    const t = rand(win === humanSide || mode === 'hotseat' ? world.teachings.win : world.teachings.lose);
    audio.sfx(mode === 'ai' && win !== humanSide ? 'lose' : 'win');
    const ov = $('#win'); ov.querySelector('#winTitle').textContent = `${nameOf(win)} win`;
    ov.querySelector('#winText').textContent = t.text; ov.classList.add('show'); grand.victoryShower(); settingsApi?.haptic('win'); audio.narrate(t.text, world); save.clear();
  }

  // ---- hint engine ----
  const hintRings = []; let hintTimer = null;
  function clearHint() { for (const r of hintRings) scene.remove(r); hintRings.length = 0; coach.clear(); const h = $('#hint'); if (h) h.classList.remove('show'); if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; } }
  function addHintRing(node, color) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 12, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.7 })); r.rotation.x = Math.PI / 2; r.position.copy(pos[node]); r.position.y = 0.5; scene.add(r); hintRings.push(r); }
  function showHint() {
    if (busy || learning || state.winner !== null || !controls(state.turn)) return;
    const mv = bestMove(state, 3); if (!mv) return; clearHint();
    let txt;
    if (mv.type === 'remove') { txt = 'Remove the glowing enemy stone — it is the one most useful to your rival.'; coach.danger(pos[mv.at]); }
    else { const ns = applyMove(state, mv); const mill = ns.event && ns.event.mill; const line = mill && Array.isArray(ns.lastMill) ? ns.lastMill : null;
      if (mv.type === 'place') txt = mill ? 'Place on the glowing point to COMPLETE the gold mill and take an enemy stone.' : 'Place on the glowing point — it builds toward a mill or blocks your rival.';
      else { txt = mill ? 'Move to the glowing point to FORM the gold mill and capture.' : 'Move to the glowing point to strengthen your line.'; coach.path([pos[mv.from], pos[mv.to]]); }
      coach.destination(pos[mv.to]);
      if (line) { const lp = line.map((n) => pos[n]).sort((a, b) => (a.x - b.x) || (a.z - b.z)); coach.path(lp); } }
    const h = $('#hint'); if (h) { h.textContent = '💡 ' + txt; h.classList.add('show'); } hintTimer = setTimeout(clearHint, 5200);
  }

  // ---- hud ----
  function updateHud() {
    $('#p0').textContent = `${state.onBoard[0]}+${state.toPlace[0]}`;
    $('#p1').textContent = `${state.onBoard[1]}+${state.toPlace[1]}`;
    $('#turnLabel').textContent = nameOf(state.turn);
    $('#turnDot').style.background = state.turn === 0 ? T.p0 : T.p1;
    $('#phase').textContent = state.removePending ? 'Remove' : state.toPlace[state.turn] > 0 ? 'Placing' : canFly(state, state.turn) ? 'Flying' : 'Moving';
  }
  function hintTurn() {
    const you = controls(state.turn);
    $('#status').textContent = !you ? 'Thinking…'
      : state.removePending ? 'Your mill! Tap an enemy stone to remove it'
      : state.toPlace[state.turn] > 0 ? 'Tap an empty point to place a stone'
      : 'Tap your stone, then where it should go';
  }
  updateHud();

  const save = initSave({
    id: 'sma',
    serialize: () => state,
    restore: (s) => {
      state = s; selected = null; targets = []; clearTargets(); clearHint();
      for (const m of stones.values()) scene.remove(m); stones.clear();
      for (let node = 0; node < state.points.length; node++) { const o = state.points[node]; if (o === 0 || o === 1) spawn(o, node); }
      busy = false; updateHud(); loop(); updateUndo();
    },
    isMyTurn: (s) => mode === 'hotseat' || s.turn === humanSide,
  });
  function updateUndo() { const b = $('#undoBtn'); if (b) b.disabled = !(!busy && controls(state.turn) && save.canUndo()); }
  function doUndo() { if (busy || !save.canUndo()) return; audio.sfx('step'); save.undo(); }

  (function frame() { selRing.rotation.z += 0.03; const t = performance.now() * 0.004; for (const mk of marks) mk.position.y = (mk.geometry.type === 'TorusGeometry' ? 0.4 : 0.06) + Math.sin(t + mk.position.x) * 0.03; for (const r of hintRings) { r.rotation.z += 0.05; r.scale.setScalar(1 + Math.sin(t * 1.6) * 0.13); } coach.update(); grand.update(); composer.render(); requestAnimationFrame(frame); })();

  $('#restart').addEventListener('click', () => { save.clear(); location.reload(); });
  addEventListener('pointerdown', () => audio.unlock(worldId), { once: true });
  $('#winAgain')?.addEventListener('click', () => { save.clear(); location.reload(); });
  $('#hintBtn')?.addEventListener('click', showHint);
  $('#undoBtn')?.addEventListener('click', doUndo);
  initTutorial({ key: 'sma.tut.v1', title: 'How to play', accent: T.accent, steps: [
    { icon: '⚫', title: 'Saalu Mane Ata', text: 'Pure foresight, no dice. Two players each have nine seeds; line up three in a connected row (a mill) to remove a rival seed.' },
    { icon: '👆', title: '1 · Place', text: 'Take turns tapping empty points to place your nine seeds. Three of yours in a straight, connected line is a mill.' },
    { icon: '✨', title: 'Form a mill', text: 'Complete a mill and remove one enemy seed — but not one already inside a mill, unless every enemy seed is.' },
    { icon: '↔️', title: '2 · Move & fly', text: 'After all are placed, tap your seed then an adjacent point to move. Down to three seeds, you may fly anywhere.' },
    { icon: '🏆', title: 'Win', text: 'Reduce your rival to two seeds, or leave them with no move. Tap 💡 Hint anytime for a suggested move.' },
  ] });
  const settingsApi = initSettings({ id: 'sma', accent: T.accent, onChange: (s) => { applySettings(s, { bloomPass: bloom, grand, audio }); coach.setPreferences(s); } });

  // ---- Learn lesson (guided, narrated walkthrough on the real board) ----
  const play = (s, mv) => mv.reduce((st, m) => applyMove(st, m), s);
  const millTwo = play(newGame(), [{ type: 'place', to: 0 }, { type: 'place', to: 9 }, { type: 'place', to: 1 }]);
  const millDone = play(millTwo, [{ type: 'place', to: 10 }, { type: 'place', to: 2 }]);
  function rebuildStones() { for (const m of stones.values()) scene.remove(m); stones.clear(); for (let n = 0; n < state.points.length; n++) { const o = state.points[n]; if (o === 0 || o === 1) spawn(o, n); } }
  let preLearn = null;
  initLearn({ id: 'sma', title: 'Learn', accent: T.accent, hooks: {
    coach, clearCoach: () => coach.clear(), narrate: (t) => audio.narrate(t, world),
    applyState: (s) => { state = s; selected = null; targets = []; clearTargets(); clearHint(); rebuildStones(); updateHud(); },
    setLearning: (on) => { learning = on; if (on) { preLearn = JSON.stringify(state); busy = false; selected = null; clearTargets(); clearHint(); } },
    freshGame: () => { learning = false; try { state = preLearn ? JSON.parse(preLearn) : newGame(); } catch { state = newGame(); } preLearn = null; selected = null; targets = []; clearTargets(); clearHint(); rebuildStones(); busy = false; updateHud(); loop(); },
  }, steps: [
    { text: 'Two players each place nine seeds, one at a time, on the empty points — this is the placing phase.', en: 'Place your nine', position: newGame(), highlight: ({ coach: c }) => { c.destination(pos[0]); c.destination(pos[9]); } },
    { text: 'Three of your seeds in one connected straight line is a mill. Two are already in a row, and the gold point completes it.', en: 'A line of three', position: millTwo, highlight: ({ coach: c }) => { c.path([pos[0], pos[1], pos[2]]); c.destination(pos[2]); } },
    { text: 'The mill forms, so you take one rival seed — choose the one most useful to them, never one already inside a mill.', en: 'Take a rival seed', position: millDone, highlight: ({ coach: c }) => { c.path([pos[0], pos[1], pos[2]]); c.danger(pos[9]); c.danger(pos[10]); } },
    { text: 'Once all are placed, slide a seed to a neighbouring point to open and re-form mills. Down to three seeds, a side may fly anywhere.', en: 'Move and fly', position: millDone, highlight: ({ coach: c }) => { c.destination(pos[1]); } },
    { text: 'Reduce your rival to two seeds, or leave them with no move, and the board is yours. Foresight wins Saalu Mane Ata.', en: 'Foresight wins', highlight: ({ coach: c }) => { c.path([pos[0], pos[1], pos[2]]); } },
  ] });
  busy = true;
  playOpening({
    world,
    canvas,
    getView: () => ({ az, pol, dist }),
    setView: (v) => { az = v.az; pol = v.pol; dist = v.dist; },
    place,
    reducedMotion: settingsApi.get().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
  }).finally(() => {
    document.body.classList.remove('cinematic-opening');
    busy = false;
    if (!(save.hasSaved() && save.resume())) loop();
    updateUndo();
  });

  window.__sma = {
    get state() { return state; }, get busy() { return busy; }, world,
    legalMoves: () => legalMoves(state), play: (m) => commit(m),
    async autoplay(n = 60) { for (let i = 0; i < n && state.winner === null; i++) { while (busy) await wait(30); const m = bestMove(state, 2); if (!m) break; await commit(m); await wait(20); } return { winner: state.winner }; },
    rendererInfo: () => renderer.info.render,
    settingsInfo: () => ({ ...settingsApi.get(), bloomEnabled: bloom.enabled, bloomStrength: bloom.strength, grand: grand.info?.(), coach: coach.info() }),
  };
}
main().catch((e) => { console.error(e); const s = document.querySelector('#status'); if (s) s.textContent = 'Error: ' + e.message; });
