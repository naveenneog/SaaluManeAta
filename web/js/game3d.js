// Saalu Mane Ata — real 3D renderer (Three.js + Unreal bloom). Three nested
// glowing squares, carved stones, taps to place/move/fly/remove, minimax AI,
// and the world's teaching revealed on a mill, a capture and the win.
import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import { POINTS, ADJ, newGame, legalMoves, applyMove, bestMove, canFly, other, canonicalState } from './logic.js';
import { makeNode, makeStone } from './pieces3d.js';
import { applyEnvironment, addContactShadow, applyRealistic, loadTexture, addTableWorld, loadPieceModel, tintPiece } from './sky.js';
import { initTutorial } from './tutorial.js';
import { maybeAutoDemo } from './auto-demo.js';
import { createGrandEffects, playOpening } from './grand.js';
import { initSave } from './save.js';
import { createRngSuite } from './rng.js';
import { hashState } from './state-hash.js';
import { createLog, derive, checkpoint } from './action-log.js';
import { initSettings, applySettings } from './settings.js';
import { createCoachOverlay } from './coach3d.js';
import { initLearn } from './learn.js';
import { initPuzzleUI } from './puzzle-ui.js';
import { initProfileUI } from './profile-ui.js';
import { initReplayUI } from './replay-ui.js';
import { initRecapUI } from './recap-ui.js';
import { buildRecap } from './recap.js';
import { analyzeSmaTransition } from './recap-insights.js';
import { createModeToken } from './mode-token.js';
import { makeSmaPuzzleIface } from './puzzle-sma.js';
import { initProfile } from './profile.js';
import { validateAchievementRegistry, evaluateAchievements, newUnlocks, recordUnlocks } from './achievements.js';
import { createSmaAchievementEvaluators } from './achievement-insights.js';
import { renderShareCard, shareCard } from './share-card.js';
import { drawShareBoard } from './share-board.js';
import { initSpectate, buildSpectateLog } from './spectate.js';
import { initSpectateUI } from './spectate-ui.js';
import { createSmaSpectateDriver } from './spectate-driver.js';
import { encode as encodeChallenge } from './challenge-link.js';
import { openLanguagePackDb, initLanguagePacks } from './language-pack.js';
import { initLanguageStoreUI } from './language-store-ui.js';
import * as audio from './audio.js';
import { setLang as i18nSetLang, savedLang, loadWorldI18n, loadUII18n, localizeUI, setCatalogSource as i18nSetCatalogSource, t as tr } from './i18n.js';
import { loadWorld } from './world-loader.js';
import { projectSmaWorldV2 } from './world-projection.js';

const $ = (s) => document.querySelector(s);
const hexInt = (h) => parseInt(String(h || '#000').replace('#', ''), 16) || 0;
const hexBlend = (a, b, t) => { a = hexInt(a); b = hexInt(b); const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t); return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const tween = (dur, fn) => new Promise((res) => { const t0 = performance.now(); const step = () => { const p = Math.min(1, (performance.now() - t0) / dur); fn(p); p < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const SP = 1.5;
const ACH_ICON_GLYPH = {
  'board-knot': '🪢', 'victory-leaf': '🍃', 'puzzle-knot': '🧩', 'daily-lamp': '🪔', 'streak-thread': '🧵',
  'trap-ring': '🎯', 'tiger-paw': '🐯', 'goat-shield': '🐐', 'seed-hand': '🌱', 'relay-loop': '🔁',
  'harvest-bowl': '🥣', 'balance-scale': '⚖️', 'cowrie-shell': '🐚', 'home-gate': '🏠', 'safe-cell': '🛡️',
  'mill-wheel': '🎡', 'flying-stone': '🪨', 'capture-ring': '💍',
};

async function main() {
  const params = new URLSearchParams(location.search);
  let cfg = {}; try { cfg = JSON.parse(sessionStorage.getItem('sma.game') || '{}'); } catch { cfg = {}; }
  const requestedWorld = params.get('world') || cfg.world || 'parampare';
  const worldId = /^[a-z][a-z0-9-]{0,63}$/i.test(requestedWorld) ? requestedWorld.toLowerCase() : 'parampare';
  const world = await loadWorld(worldId, { game: 'sma', projector: projectSmaWorldV2 });
  const uiLang = savedLang('sma'); i18nSetLang(uiLang); audio.setLang(uiLang); await loadWorldI18n(worldId); await loadUII18n('sma'); localizeUI();
  const T = world.theme || {};
  const REALISTIC = !!world.realistic;
  document.body.classList.add('cinematic-opening');
  const mode = params.get('mode') || cfg.mode || 'ai';
  const humanSide = +(params.get('side') ?? cfg.side ?? 0) ? 1 : 0;
  const level = Math.max(1, Math.min(3, +(params.get('level') || cfg.level || 2)));
  document.title = `${world.title} — Saalu Mane Ata`;
  $('#title').textContent = world.title; $('#kn').textContent = world.kannada || '';
  const nameOf = (p) => tr(p === 0 ? world.sides.p0.name : world.sides.p1.name);
  const controls = (side) => mode === 'hotseat' || side === humanSide;

  let state = newGame(); let busy = false, selected = null, targets = [], learning = false, puzzling = false, lastMatchLog = null;

  // ---- deterministic core (α2): action log + save.js v2 (Saalu has no canonical RNG) ----
  const freshSeed = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(16).padStart(8, '0') + a[1].toString(16).padStart(8, '0'); };
  const seed = (params.get('seed') || cfg.seed || freshSeed()).toString();
  const engine = {
    setup: () => ({ state: newGame(), rng: null }),
    apply: (st, entry) => applyMove(st, entry.action),   // the move IS the action; no RNG
    restore: (log, cp) => ({ state: cp.state, rng: null }),
    hash: (st) => hashState(canonicalState(st)),
  };
  const newLog = () => createLog({ game: 'sma', engine: { version: '1.5.0' }, ruleset: { id: 'sma.base', version: 1 }, world: worldId, rng: createRngSuite({ seed, streams: ['rules'] }) });
  const modeToken = createModeToken('opening');
  function maybeCheckpoint() {
    const log = save.log; if (!log || log.actions.length === 0 || log.actions.length % 16 !== 0) return;
    checkpoint(log, { afterAction: log.actions.length, state: canonicalState(state), rngState: null, stateHash: engine.hash(state) });
    save.persist();
  }
  // Rebuild the board stones to reflect `state` (used after resume / undo).
  function renderState() {
    selected = null; targets = []; clearTargets(); clearHint();
    for (const m of stones.values()) scene.remove(m); stones.clear();
    for (let node = 0; node < state.points.length; node += 1) { const o = state.points[node]; if (o === 0 || o === 1) spawn(o, node); }
    busy = false; updateHud();
  }
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
    ? new THREE.MeshStandardMaterial({ map: loadTexture('assets/' + worldId + '/board.jpg', [1, 1]), roughness: 0.55, metalness: 0.08, envMapIntensity: 1.15 })
    : new THREE.MeshStandardMaterial({ color: hexInt(T.board), roughness: 0.65, metalness: 0.25, envMapIntensity: 0.5 }));
  slab.position.y = -0.18; slab.receiveShadow = true; scene.add(slab);
  addContactShadow(scene, radius + 2, -0.03, 0.5);
  if (REALISTIC) addTableWorld(scene, { radius: (radius + 1.4) * 2.3, tableY: -0.34, woodUrl: 'assets/' + worldId + '/board.jpg', tableUrl: 'assets/' + worldId + '/table.jpg', tableRepeat: [5, 5], floorHex: hexInt(T.bg) });

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
    if (busy || learning || document.body.classList.contains('replay-viewing')) return;
    if (puzzling) { if (state.winner !== null || state.turn !== 0) return; }
    else if (state.winner !== null || !controls(state.turn)) return;
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
    const lease = modeToken.begin();
    const prev = state; const moveSide = prev.turn;
    state = applyMove(prev, move);
    if (!puzzling) { save.record({ side: moveSide, action: move, stateHash: engine.hash(state) }); maybeCheckpoint(); }
    await animate(prev, move, state.event); updateHud();
    if (state.event.mill) await reveal('mill', rand(world.teachings.mill));
    if (state.event.type === 'remove') await reveal('remove', rand(world.teachings.remove || world.teachings.mill));
    if (!modeToken.isCurrent(lease)) return;   // a mode switch (puzzle/replay) invalidated this move
    if (puzzling) {
      const solved = puzzleUI?.report(state);
      if (solved) { busy = true; return; }
      if (state.turn !== 0) { puzzleUI?.fail(); busy = true; return; }
      busy = false; return;
    }
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
    if (state.winner !== null || busy || learning || puzzling || document.body.classList.contains('replay-viewing')) return;
    if (state.removePending && controls(state.turn)) { showRemovable(); hintTurn(); updateUndo(); return; }
    if (controls(state.turn)) { hintTurn(); updateUndo(); return; }
    busy = true; $('#thinking').classList.add('show');
    const lease = modeToken.begin();
    await wait(240);
    if (!modeToken.isCurrent(lease)) { $('#thinking').classList.remove('show'); return; }
    const mv = await Promise.resolve().then(() => bestMove(state, level));
    $('#thinking').classList.remove('show');
    if (!modeToken.isCurrent(lease)) return;
    if (!mv) { state = { ...state, winner: other(state.turn) }; await onWin(); busy = false; return; }
    const prev = state; const moveSide = prev.turn;
    state = applyMove(prev, mv);
    save.record({ side: moveSide, action: mv, stateHash: engine.hash(state) });
    maybeCheckpoint();
    await animate(prev, mv, state.event); updateHud();
    if (state.event.mill) await reveal('mill', rand(world.teachings.mill));
    if (state.event.type === 'remove') await reveal('remove', rand(world.teachings.remove || world.teachings.mill));
    if (!modeToken.isCurrent(lease)) return;
    if (state.winner !== null) { await onWin(); busy = false; return; }
    busy = false; loop();
  }

  // ---- reveal + win ----
  const card = $('#card');
  async function reveal(kind, teaching) {
    if (!teaching) return;
    card.querySelector('.kind').textContent = tr(kind === 'mill' ? 'Mill!' : 'Captured');
    card.querySelector('.kind').className = `kind ${kind}`;
    card.querySelector('.en').textContent = teaching.en || ''; card.querySelector('.m').textContent = tr(teaching.text);
    card.classList.add('show'); audio.narrate(teaching.text, world); await wait(1900); card.classList.remove('show'); await wait(220);
  }
  async function onWin() {
    const win = state.winner;
    if (win === 0) profile.bump('games.won');
    const t = rand(win === humanSide || mode === 'hotseat' ? world.teachings.win : world.teachings.lose);
    audio.sfx(mode === 'ai' && win !== humanSide ? 'lose' : 'win');
    const ov = $('#win'); ov.querySelector('#winTitle').textContent = tr('%s win').replace('%s', nameOf(win));
    ov.querySelector('#winText').textContent = tr(t.text); ov.classList.add('show'); grand.victoryShower(); settingsApi?.haptic('win'); audio.narrate(t.text, world); lastMatchLog = save.log; try { recapUI.setRecap(buildRecap(lastMatchLog, { adapter: engine, analyzeTransition: analyzeSmaTransition, perspective: 0 })); } catch { /* recap optional */ } awardAchievements('live', { log: lastMatchLog, finalState: state }); save.clear();
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
    const h = $('#hint'); if (h) { h.textContent = '💡 ' + tr(txt); h.classList.add('show'); } hintTimer = setTimeout(clearHint, 5200);
  }

  // ---- hud ----
  function updateHud() {
    $('#p0').textContent = `${state.onBoard[0]}+${state.toPlace[0]}`;
    $('#p1').textContent = `${state.onBoard[1]}+${state.toPlace[1]}`;
    $('#turnLabel').textContent = nameOf(state.turn);
    $('#turnDot').style.background = state.turn === 0 ? T.p0 : T.p1;
    $('#phase').textContent = tr(state.removePending ? 'Remove' : state.toPlace[state.turn] > 0 ? 'Placing' : canFly(state, state.turn) ? 'Flying' : 'Moving');
  }
  function hintTurn() {
    const you = controls(state.turn);
    $('#status').textContent = !you ? tr('Thinking…')
      : state.removePending ? tr('Your mill! Tap an enemy stone to remove it')
      : state.toPlace[state.turn] > 0 ? tr('Tap an empty point to place a stone')
      : tr('Tap your stone, then where it should go');
  }
  updateHud();

  const save = initSave({
    id: 'sma',
    adapter: engine,
    isMyTurn: (s) => mode === 'hotseat' || s.turn === humanSide,
  });
  function updateUndo() { const b = $('#undoBtn'); if (b) b.disabled = !(!busy && controls(state.turn) && save.canUndo()); }
  function doUndo() {
    if (busy || puzzling || learning || state.winner != null || document.body.classList.contains('replay-viewing') || !save.canUndo()) return; audio.sfx('step');
    const restored = save.undo();
    if (restored) { const r = derive(save.log, engine); state = r.state; renderState(); loop(); }
  }

  (function frame() { selRing.rotation.z += 0.03; const t = performance.now() * 0.004; for (const mk of marks) mk.position.y = (mk.geometry.type === 'TorusGeometry' ? 0.4 : 0.06) + Math.sin(t + mk.position.x) * 0.03; for (const r of hintRings) { r.rotation.z += 0.05; r.scale.setScalar(1 + Math.sin(t * 1.6) * 0.13); } coach.update(); grand.update(); composer.render(); requestAnimationFrame(frame); })();

  $('#restart').addEventListener('click', () => { save.clear(); location.reload(); });
  addEventListener('pointerdown', () => audio.unlock(worldId), { once: true });
  $('#winAgain')?.addEventListener('click', () => { save.clear(); location.reload(); });
  $('#hintBtn')?.addEventListener('click', showHint);
  $('#undoBtn')?.addEventListener('click', doUndo);
  let demoPending = false; try { demoPending = !localStorage.getItem('tbg.sma.demo.v1'); } catch { /* */ }
  demoPending = demoPending && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  initTutorial({ key: 'sma.tut.v1', title: 'How to play', accent: T.accent, autoOpen: !demoPending, steps: [
    { icon: '⚫', title: 'Saalu Mane Ata', text: 'Pure foresight, no dice. Two players each have nine seeds; line up three in a connected row (a mill) to remove a rival seed.' },
    { icon: '👆', title: '1 · Place', text: 'Take turns tapping empty points to place your nine seeds. Three of yours in a straight, connected line is a mill.' },
    { icon: '✨', title: 'Form a mill', text: 'Complete a mill and remove one enemy seed — but not one already inside a mill, unless every enemy seed is.' },
    { icon: '↔️', title: '2 · Move & fly', text: 'After all are placed, tap your seed then an adjacent point to move. Down to three seeds, you may fly anywhere.' },
    { icon: '🏆', title: 'Win', text: 'Reduce your rival to two seeds, or leave them with no move. Tap 💡 Hint anytime for a suggested move.' },
  ] });
  const settingsApi = initSettings({ id: 'sma', accent: T.accent, onChange: (s) => { applySettings(s, { bloomPass: bloom, grand, audio }); coach.setPreferences(s); }, onLanguageRequest: (lang) => languageStoreUI?.requestLanguage(lang) });

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
    freshGame: () => { learning = false; try { const r = derive(save.log, engine); state = r.state; } catch { state = newGame(); } preLearn = null; renderState(); loop(); },
  }, steps: [
    { text: 'Two players each place nine seeds, one at a time, on the empty points — this is the placing phase.', en: 'Place your nine', position: newGame(), highlight: ({ coach: c }) => { c.destination(pos[0]); c.destination(pos[9]); } },
    { text: 'Three of your seeds in one connected straight line is a mill. Two are already in a row, and the gold point completes it.', en: 'A line of three', position: millTwo, highlight: ({ coach: c }) => { c.path([pos[0], pos[1], pos[2]]); c.destination(pos[2]); } },
    { text: 'The mill forms, so you take one rival seed — choose the one most useful to them, never one already inside a mill.', en: 'Take a rival seed', position: millDone, highlight: ({ coach: c }) => { c.path([pos[0], pos[1], pos[2]]); c.danger(pos[9]); c.danger(pos[10]); } },
    { text: 'Once all are placed, slide a seed to a neighbouring point to open and re-form mills. Down to three seeds, a side may fly anywhere.', en: 'Move and fly', position: millDone, highlight: ({ coach: c }) => { c.destination(pos[1]); } },
    { text: 'Reduce your rival to two seeds, or leave them with no move, and the board is yours. Foresight wins Saalu Mane Ata.', en: 'Foresight wins', highlight: ({ coach: c }) => { c.path([pos[0], pos[1], pos[2]]); } },
  ] });
  const smaIface = makeSmaPuzzleIface();
  const profile = initProfile({ id: 'sma' });
  initProfileUI({ id: 'sma', accent: T.accent, profile });
  // --- v1.8 α1: optional lazy language packs (validated, hash-addressed, atomic install) ---
  let languagePacks = null;
  let languageStoreUI = null;
  const OPTIONAL_LANGUAGES = ['hi', 'ta', 'te', 'ml', 'mr'];
  const languagePacksReady = (async () => {
    try {
      // v1.8 α1 flip: core-config.json (emitted by tooling/build-core.mjs; dev ships all-languages/relative)
      // picks the packaging profile + optional remote pack origin. A staged `default-core` core is
      // AUTHORITATIVE — it cannot be loosened back to bundling via ?langprofile (its optional originals are
      // physically absent). Dev (`all-languages`) may still opt into the default-core path via the param.
      const coreConfig = await fetch('core-config.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const configProfile = coreConfig?.profile === 'default-core' ? 'default-core' : 'all-languages';
      const packBaseUrl = coreConfig?.packBaseUrl || null;
      const [trustedIndex, schema] = await Promise.all([
        // The trusted index + schema are the hash trust anchors — always fetched LOCALLY (bundled in core,
        // even in default-core). Only pack manifests/files resolve to packBaseUrl (inside initLanguagePacks),
        // so a remote host can never redefine the expected hashes.
        fetch('packs/sma/language-index.json').then((r) => (r.ok ? r.json() : null)),
        fetch('schemas/v1.8/language-pack.schema.json').then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!trustedIndex || typeof caches === 'undefined') return null;
      const db = await openLanguagePackDb();
      // Packaging profile: `all-languages` (default) keeps optional-language originals in core, so they
      // resolve as fetch-free `compatibility`; `default-core` (lean core) excludes them so the validated
      // pack install path runs, fetching packs from packBaseUrl (the Pages origin) when set.
      const profileName = configProfile === 'default-core' ? 'default-core' : (params.get('langprofile') || 'all-languages');
      const bundled = profileName === 'all-languages' ? OPTIONAL_LANGUAGES : [];
      languagePacks = initLanguagePacks({
        game: 'sma', coreLanguages: ['kn', 'en'], trustedIndex, schema,
        fetchImpl: fetch, packBaseUrl, cacheStorage: caches, db, maxPackBytes: 8 * 1024 * 1024,
        compatibility: {
          languages: bundled, components: ['text'],
          loadText: async (lang) => { const r = await fetch(`assets/ui/${lang}.json`); return r.ok ? r.json() : {}; },
        },
      });
      await languagePacks.repair();
      // v1.8 α1 stage-2: serve text from the active installed pack (CacheStorage) via i18n's catalog
      // source; if the saved language is an installed/compat optional pack, activate it + re-localize so it
      // serves the UI/world text even in default-core (which has no bundled optional asset to fall back to).
      // A brief English first paint is acceptable; on any failure the English fallback stays.
      i18nSetCatalogSource((l, role, opts) => languagePacks.getCatalog(l, role, opts));
      audio.setVoiceSource((l, text, scope) => languagePacks.getVoiceFile(l, text, scope));
      if (OPTIONAL_LANGUAGES.includes(uiLang)) {
        try {
          const st = await languagePacks.status(uiLang, 'text');
          if (st.state === 'installed' || st.state === 'compatibility') {
            await languagePacks.activate(uiLang);
            await loadUII18n('sma');
            await loadWorldI18n(worldId);
            localizeUI();
          }
        } catch { /* leave the English fallback */ }
      }
      try {
        languageStoreUI = initLanguageStoreUI({
          packs: languagePacks, translate: tr, accent: T.accent,
          getSelectedLanguage: () => uiLang,
          dataSaver: navigator.connection?.saveData === true,
          onActivated: async (language, snapshot, metadata) => {
            languageStoreUI?.refresh();
            if (metadata?.preservePreference === true) {
              // Fallback: the active pack was removed/repaired away. Restore the displayed language in
              // place (usually English) WITHOUT touching settings, so the user's saved preference survives
              // — a later unrelated settings change must not persist this fallback over their choice.
              i18nSetLang(language);
              audio.setLang(language);
              await loadWorldI18n(worldId);
              await loadUII18n('sma');
              localizeUI();
            } else {
              // Normal activation (explicit user choice): persist the preference + reload so all UI and
              // world text renders in the chosen language (stage-1 serves catalogs from the bundle).
              settingsApi.setLanguage(language, { persist: true });
              location.reload();
            }
          },
        });
      } catch (e) { console.warn('language store UI unavailable:', e?.message || e); }
      return languagePacks;
    } catch (e) { console.warn('language packs unavailable:', e?.message || e); return null; }
  })();
  // --- achievements (v1.7 α3): evaluate on match / puzzle / daily completion; toast fresh unlocks ---
  const achievementEvaluators = createSmaAchievementEvaluators({ adapter: engine });
  let achievementRegistry = null;
  (async () => {
    try { const r = await (await fetch('achievements/registry.json')).json(); validateAchievementRegistry(r); achievementRegistry = r; }
    catch { achievementRegistry = null; }
  })();
  function showAchievementToast(list) {
    let host = document.getElementById('achToasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'achToasts';
      host.setAttribute('aria-live', 'polite');
      host.style.cssText = 'position:fixed;left:50%;bottom:calc(1rem + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:70;display:flex;flex-direction:column;gap:.5rem;pointer-events:none;width:min(92vw,420px)';
      document.body.appendChild(host);
    }
    for (const a of list) {
      const card = document.createElement('div');
      card.setAttribute('role', 'status');
      card.style.cssText = `pointer-events:auto;display:flex;align-items:center;gap:.7rem;background:${T.accent || '#e8c24a'};color:#241200;border-radius:16px;padding:.7rem .9rem;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer;transform:translateY(14px);opacity:0;transition:transform .3s ease,opacity .3s ease`;
      const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true'); icon.style.cssText = 'font-size:1.6rem;line-height:1;flex:0 0 auto'; icon.textContent = ACH_ICON_GLYPH[a.icon] || '🏅';
      const col = document.createElement('span'); col.style.cssText = 'display:flex;flex-direction:column;min-width:0';
      const kicker = document.createElement('strong'); kicker.style.cssText = 'font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;opacity:.75'; kicker.textContent = tr('Achievement unlocked');
      const title = document.createElement('span'); title.style.cssText = 'font-weight:700;font-size:1rem'; title.textContent = tr(a.titleKey);
      const desc = document.createElement('span'); desc.style.cssText = 'font-size:.86rem;opacity:.9'; desc.textContent = tr(a.descKey);
      const shareBtn = document.createElement('button'); shareBtn.type = 'button'; shareBtn.setAttribute('aria-label', tr('Share')); shareBtn.textContent = tr('Share');
      shareBtn.style.cssText = 'flex:0 0 auto;margin-left:auto;align-self:center;font:600 .8rem "Segoe UI",sans-serif;color:#241200;background:rgba(0,0,0,.12);border:1px solid rgba(0,0,0,.25);border-radius:10px;padding:.35rem .6rem;cursor:pointer;min-height:36px';
      shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareGameCard({ kind: 'achievement', titleKey: a.titleKey, bodyKey: a.descKey, params: { achievementId: a.id, ...(a.tier ? { tier: a.tier } : {}) } }); });
      col.append(kicker, title, desc); card.append(icon, col, shareBtn); host.appendChild(card);
      requestAnimationFrame(() => { card.style.transform = 'translateY(0)'; card.style.opacity = '1'; });
      settingsApi?.haptic?.('win');
      const kill = () => { card.style.opacity = '0'; card.style.transform = 'translateY(14px)'; setTimeout(() => card.remove(), 320); };
      card.addEventListener('click', kill);
      setTimeout(kill, 5600);
    }
  }
  function awardAchievements(source, { log = null, finalState = null } = {}) {
    if (!achievementRegistry) return;
    try {
      const results = evaluateAchievements(achievementRegistry, {
        profile: profile.snapshot(), log, finalState,
        evaluators: achievementEvaluators, context: { source },
      });
      const unlocked = newUnlocks(results, profile.snapshot());
      if (!unlocked.length) return;
      recordUnlocks(profile, unlocked);
      showAchievementToast(unlocked);
    } catch { /* achievements are optional cosmetics — never break play */ }
  }
  const smaValidateAction = (a) => {
    if (!a || typeof a !== 'object') return false;
    const idx = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
    if (a.type === 'place') return idx(a.to);
    if (a.type === 'move') return idx(a.from) && idx(a.to);
    if (a.type === 'remove') return idx(a.at);
    return false;
  };
  const replayUI = initReplayUI({
    id: 'sma', adapter: engine,
    validation: { game: 'sma', engine: { version: '1.5.0' }, ruleset: { id: 'sma.base', version: 1 }, validateAction: smaValidateAction },
    renderState: (s) => { state = s; renderState(); },
    restoreLive: () => { modeToken.enter('live'); puzzling = false; const src = save.log || lastMatchLog; try { const r = derive(src, engine); state = r.state; } catch { state = newGame(); } renderState(); busy = false; if (state.winner == null) loop(); },
    translate: tr,
    reducedMotion: settingsApi.get().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
    accent: T.accent,
  });
  { const wa = $('#winAgain'); if (wa) { const wb = document.createElement('button'); wb.id = 'winReplay'; wb.textContent = tr('Watch replay'); wb.style.cssText = 'font:inherit;margin-right:.6rem;color:#241200;background:#e8c24a;border:0;border-radius:14px;padding:.8rem 1.4rem;cursor:pointer;min-height:48px'; wb.addEventListener('click', () => { modeToken.enter('replay'); replayUI.open(lastMatchLog || save.log); }); wa.insertAdjacentElement('beforebegin', wb); } }
  const recapUI = initRecapUI({ accent: T.accent, translate: tr, narrate: (text) => audio.narrate(text, world), onSeek: (index) => { recapUI.close(); modeToken.enter('replay'); replayUI.open(lastMatchLog || save.log); replayUI.seek(index); } });
  // --- α4: share cards + AI-vs-AI spectate ---
  const saveData = navigator.connection?.saveData === true;
  const reducedMotionNow = () => settingsApi.get().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  function flashToast(text) {
    let host = document.getElementById('achToasts');
    if (!host) { host = document.createElement('div'); host.id = 'achToasts'; host.setAttribute('aria-live', 'polite'); host.style.cssText = 'position:fixed;left:50%;bottom:calc(1rem + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:70;display:flex;flex-direction:column;gap:.5rem;pointer-events:none;width:min(92vw,420px)'; document.body.appendChild(host); }
    const el = document.createElement('div'); el.setAttribute('role', 'status'); el.style.cssText = 'background:rgba(15,18,24,.96);color:#eef2f7;border-radius:14px;padding:.6rem .9rem;box-shadow:0 10px 28px rgba(0,0,0,.35);font:600 .9rem "Segoe UI",sans-serif;text-align:center;opacity:0;transform:translateY(12px);transition:opacity .25s,transform .25s'; el.textContent = text; host.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(12px)'; setTimeout(() => el.remove(), 260); }, 2600);
  }
  const fmtShare = (key, params = {}) => { let s = tr(key); for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v)); return s; };
  const boardShareState = () => ({ points: state.points.slice() });
  async function shareGameCard({ kind, titleKey, bodyKey, params = {}, url = null, shareState = null }) {
    try {
      const { file } = await renderShareCard({
        kind, game: 'sma', world: worldId, locale: savedLang('sma'),
        titleKey, bodyKey, params, state: shareState || boardShareState(),
        drawBoard: (ctx, box) => drawShareBoard(ctx, box, { world }),
        translate: tr, size: 'landscape',
      });
      const text = `${fmtShare(titleKey, params)} — ${fmtShare(bodyKey, params)}`;
      const res = await shareCard({ file, title: fmtShare(titleKey, params), text, url, downloadName: `tbg-sma-${kind}.png` });
      if (res.method !== 'cancel') flashToast(res.method === 'clipboard' ? tr('Link copied') : res.method === 'download' ? tr('Saved image') : tr('Shared'));
    } catch { flashToast(tr('Share unavailable')); }
  }
  let lastPuzzleShare = null;
  async function sharePuzzleResult(details) {
    if (!details) return;
    let url = null;
    try { const hash = await encodeChallenge({ game: 'sma', puzzleId: details.spec.id }); url = `${location.origin}${location.pathname}${location.search}${hash}`; } catch { url = null; }
    return shareGameCard({
      kind: 'puzzle', titleKey: 'sma.share.puzzle.title', bodyKey: 'sma.share.puzzle.body',
      params: { puzzleId: details.spec.id, difficulty: details.spec.difficulty, moves: details.moves, par: details.par, daily: details.isDaily },
      url, shareState: details.state,
    });
  }
  function shareResultCard() {
    const win = state.winner; const outcome = (win === humanSide || mode === 'hotseat') ? 'win' : 'loss';
    const moves = (lastMatchLog?.actions || save.log?.actions || []).length;
    return shareGameCard({ kind: 'result', titleKey: `sma.share.result.${outcome}.title`, bodyKey: `sma.share.result.${outcome}.body`, params: { moves } });
  }
  { const wa = $('#winAgain'); if (wa) { const sb = document.createElement('button'); sb.id = 'winShare'; sb.textContent = tr('Share'); sb.style.cssText = 'font:inherit;margin-right:.6rem;color:#eef2f7;background:#2a2118;border:1px solid #7d6335;border-radius:14px;padding:.8rem 1.4rem;cursor:pointer;min-height:48px'; sb.addEventListener('click', () => shareResultCard()); wa.insertAdjacentElement('beforebegin', sb); } }
  const spectateLog = (seed) => createLog({ game: 'sma', engine: { version: '1.5.0' }, ruleset: { id: 'sma.base', version: 1 }, world: worldId, rng: createRngSuite({ seed, streams: ['rules'] }) });
  const spectate = initSpectate({
    generate: async (seed) => buildSpectateLog({ log: spectateLog((seed ?? freshSeed()).toString()), adapter: engine, driver: createSmaSpectateDriver({ level: 2 }), maxActions: 400, repetition: 3 }),
    replayUI,
    restoreLive: () => { modeToken.enter('live'); const src = save.log || lastMatchLog; try { const r = derive(src, engine); state = r.state; } catch { state = newGame(); } renderState(); busy = false; if (state.winner == null) loop(); },
    reducedMotion: reducedMotionNow(), saveData,
  });
  const spectateUI = initSpectateUI({ spectate, translate: tr, accent: T.accent, reducedMotion: reducedMotionNow(), saveData });
  let attractTimer = null;
  function canStartAttract() {
    return openingDone && !document.hidden && !busy && !learning && !puzzling && !spectate.active
      && !document.body.classList.contains('replay-viewing')
      && state.winner == null && (save?.log?.actions?.length ?? 0) === 0
      && !location.hash.startsWith('#c=')
      && !document.querySelector('#win.show, #pz-picker.show, [role="dialog"].show, [aria-modal="true"].show');
  }
  function resetAttractTimer() {
    if (attractTimer !== null) clearTimeout(attractTimer);
    attractTimer = null;
    if (reducedMotionNow() || saveData) return;
    attractTimer = setTimeout(async () => { attractTimer = null; if (!canStartAttract()) { resetAttractTimer(); return; } await spectateUI.start(); }, 60000);
  }
  addEventListener('pointerdown', resetAttractTimer, { passive: true });
  addEventListener('keydown', resetAttractTimer, { passive: true });
  let puzzleUI = null, openingDone = false, hashLaunched = false;
  function maybeLaunchHash() { if (hashLaunched || !openingDone || !puzzleUI) return; hashLaunched = true; puzzleUI.launchFromHash(); }
  function enterPuzzle(spec) {
    modeToken.enter('puzzle');
    puzzling = true; busy = false; learning = false; selected = null;
    state = JSON.parse(JSON.stringify(spec.position.state));
    clearTargets(); clearHint(); rebuildStones(); updateHud();
    if (state.removePending) showRemovable();
  }
  function exitPuzzle() {
    modeToken.enter('live');
    puzzling = false; busy = false; selected = null; clearTargets(); clearHint();
    try { const r = derive(save.log, engine); state = r.state; } catch { state = newGame(); }
    rebuildStones(); updateHud(); loop();
  }
  (async () => {
    try {
      const idx = await (await fetch('assets/puzzles/sma/index.json')).json();
      const specs = await Promise.all(idx.puzzles.map((p) => fetch(`assets/puzzles/sma/${p.id}.json`).then((r) => r.json())));
      puzzleUI = initPuzzleUI({
        id: 'sma', accent: T.accent, profile, iface: smaIface,
        index: { version: idx.version, puzzles: specs },
        hooks: { enter: enterPuzzle, exit: exitPuzzle, narrate: (text) => audio.narrate(text, world), solved: ({ spec, isDaily, moves }) => { lastPuzzleShare = { spec, isDaily, moves: moves ?? 0, par: spec.par ?? spec.solution?.length ?? moves ?? 0, state: boardShareState() }; awardAchievements(isDaily ? 'daily' : 'puzzle'); } },
      });
      maybeLaunchHash();
      $('#pz-share')?.addEventListener('click', (e) => { if (!lastPuzzleShare) return; e.preventDefault(); e.stopImmediatePropagation(); sharePuzzleResult(lastPuzzleShare); }, true);
    } catch { /* puzzles unavailable — button simply absent */ }
  })();
  busy = true;
  playOpening({
    world,
    canvas,
    getView: () => ({ az, pol, dist }),
    setView: (v) => { az = v.az; pol = v.pol; dist = v.dist; },
    place,
    reducedMotion: settingsApi.get().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
  }).finally(async () => {
    document.body.classList.remove('cinematic-opening');
    const resumed = save.hasSaved() ? save.resume(seed) : null;
    if (resumed) { const r = derive(save.log, engine); state = r.state; renderState(); }
    else {
      save.begin(newLog());
      await maybeAutoDemo({
        id: 'sma', adapter: engine,
        applyState: (s) => { state = s; renderState(); busy = true; },
        freshState: () => { const r = derive(save.log, engine); state = r.state; renderState(); },
        audio, accent: T.accent,
        reducedMotion: settingsApi.get().reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
      profile.bump('games.played');
    }
    busy = false;
    loop();
    updateUndo();
    openingDone = true;
    maybeLaunchHash();
    resetAttractTimer();
  });

  window.__sma = {
    get state() { return state; }, get busy() { return busy; }, get log() { return save.log; }, get seed() { return seed; }, world,
    legalMoves: () => legalMoves(state), play: (m) => commit(m), replay: () => { modeToken.enter('replay'); return replayUI.open(save.log); },
    award: (source, opts) => awardAchievements(source, opts || {}),
    achToast: (list) => showAchievementToast(list),
    achRegistry: () => achievementRegistry,
    spectate: () => spectate,
    packs: () => languagePacks,
    packsReady: () => languagePacksReady,
    renderShareTest: async () => { const { blob } = await renderShareCard({ kind: 'result', game: 'sma', world: worldId, locale: savedLang('sma'), titleKey: 'sma.share.result.win.title', bodyKey: 'sma.share.result.win.body', params: { moves: 37 }, state: boardShareState(), drawBoard: (ctx, box) => drawShareBoard(ctx, box, { world }), translate: tr, size: 'landscape' }); return blob ? blob.size : 0; },
    async autoplay(n = 60) { for (let i = 0; i < n && state.winner === null; i++) { while (busy) await wait(30); const m = bestMove(state, 2); if (!m) break; await commit(m); await wait(20); } return { winner: state.winner }; },
    rendererInfo: () => renderer.info.render,
    settingsInfo: () => ({ ...settingsApi.get(), bloomEnabled: bloom.enabled, bloomStrength: bloom.strength, grand: grand.info?.(), coach: coach.info() }),
  };
}
main().catch((e) => { console.error(e); const s = document.querySelector('#status'); if (s) s.textContent = 'Error: ' + e.message; });
