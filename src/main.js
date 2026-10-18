import './style.css';
import { createIcons, ArrowUpRight, ArrowRight, ArrowDownToLine, VolumeX, Volume2, Maximize, Minimize, Infinity, Move, Camera, Crosshair, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, CircleHelp, Box, Smartphone, X, Info } from 'lucide';
import { CONFIG } from './config.js';
import { createPhysics } from './physics.js';
import { createScene } from './scene.js';

const $ = (s) => document.querySelector(s);
const icons = { ArrowUpRight, ArrowRight, ArrowDownToLine, VolumeX, Volume2, Maximize, Minimize, Infinity, Move, Camera, Crosshair, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, CircleHelp, Box, Smartphone, X, Info };
function renderIcons() { createIcons({ icons, attrs: { 'aria-hidden': 'true' } }); }
renderIcons();

let physics, view, ready = false, attempts = 0, best = null, guide = true, sound = false;
let phase = 'aim', elapsed = 0, phaseStart = null, accumulator = 0, last = 0, raf = 0, successShown = false;
let aim = { x: 0, y: CONFIG.home.y, z: 0 }, claw = { ...aim, open: 1 };
const held = new Set();
const phaseLabels = { aim: '位置を合わせてください', descend: 'アーム下降中', close: 'アームを閉じています', lift: '持ち上げています', release: 'アームを開いています', return: '次の一手を準備中', settle: '景品の動きを確認中', won: '景品を獲得しました！' };
const messages = { aim: '位置は何度でも調整できます', descend: 'どこに掛かるか、観察してみよう', close: 'アームの力と摩擦で、箱が動きます', lift: 'この動きを、次の一手につなげよう', release: '箱の位置は、次のプレイにも引き継ぎます', return: 'もう少しで、次の一手', settle: '箱が落ち着くまで待っています', won: 'NICE CATCH! 次のチャレンジへ' };
try { best = Number(localStorage.getItem('hashi-best')) || null; } catch { /* Storage is optional. */ }
function updateStats() { $('#attempt-count').innerHTML = String(attempts).padStart(2, '0') + '<span>回</span>'; $('#best-count').innerHTML = (best ?? '—') + '<small>回</small>'; }
updateStats();

class Sound {
  constructor() { this.context = null; }
  unlock() { try { this.context ??= new (window.AudioContext || window.webkitAudioContext)(); this.context.resume().catch(() => {}); } catch { /* Audio can be unavailable. */ } }
  tone(frequency, duration = .1, type = 'sine', volume = .035, offset = 0) {
    if (!sound || !this.context) return;
    const t = this.context.currentTime + offset, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .015); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    osc.connect(gain).connect(this.context.destination); osc.start(t); osc.stop(t + duration + .01);
  }
  catch() { this.tone(250, .12, 'triangle'); this.tone(400, .12, 'triangle', .025, .09); }
  win() { [523.25, 659.25, 783.99, 1046.5].forEach((n, i) => this.tone(n, .45, 'triangle', .05, i * .13)); }
}
const audio = new Sound();
function setSound(value) { sound = value; if (sound) audio.unlock(); $('#sound-setting').checked = sound; $('#sound-button').innerHTML = `<i data-lucide="${sound ? 'volume-2' : 'volume-x'}"></i>`; $('#sound-button').setAttribute('aria-label', `サウンドを${sound ? 'オフ' : 'オン'}にする`); $('#sound-button').setAttribute('aria-pressed', String(sound)); renderIcons(); }
$('#sound-button').addEventListener('click', () => setSound(!sound));
$('#sound-setting').addEventListener('change', e => setSound(e.target.checked));

function setGuide(value) { guide = value; view?.setGuide(guide); $('#guide-setting').checked = guide; $('#guide-button').setAttribute('aria-pressed', String(guide)); $('#guide-button span').textContent = `ガイド ${guide ? 'ON' : 'OFF'}`; }
$('#guide-button').addEventListener('click', () => setGuide(!guide));
$('#guide-setting').addEventListener('change', e => setGuide(e.target.checked));
$('#quality-setting').addEventListener('change', e => view?.setQuality(e.target.value));

function clearInput() { held.clear(); document.querySelectorAll('[data-move]').forEach(b => b.classList.remove('active')); }
document.querySelectorAll('[data-dialog]').forEach(b => b.addEventListener('click', () => { clearInput(); $(`#${b.dataset.dialog}-dialog`).showModal(); }));
document.querySelectorAll('.dialog-close').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('#help-done').addEventListener('click', () => $('#help-dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); }));
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else { await document.documentElement.requestFullscreen(); try { await screen.orientation?.lock?.('landscape'); } catch { /* Orientation lock varies by browser. */ } }
  } catch { $('#fullscreen-button').title = 'このブラウザではフルスクリーンを利用できません'; }
});
document.addEventListener('fullscreenchange', () => { $('#fullscreen-button').innerHTML = `<i data-lucide="${document.fullscreenElement ? 'minimize' : 'maximize'}"></i>`; renderIcons(); view?.resize(); });
document.querySelectorAll('[data-camera]').forEach(b => b.addEventListener('click', () => { view?.setCamera(b.dataset.camera); document.querySelectorAll('[data-camera]').forEach(c => { c.classList.toggle('selected', b === c); c.setAttribute('aria-pressed', String(b === c)); }); }));

const keyMap = { ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', ArrowUp:'forward', KeyW:'forward', ArrowDown:'back', KeyS:'back' };
function nudge(direction, amount = .035) {
  if (!ready || phase !== 'aim') return;
  if (direction === 'left' || direction === 'right') aim.x = Math.max(-CONFIG.moveLimit.x, Math.min(CONFIG.moveLimit.x, aim.x + (direction === 'right' ? amount : -amount)));
  else aim.z = Math.max(-CONFIG.moveLimit.z, Math.min(CONFIG.moveLimit.z, aim.z + (direction === 'back' ? amount : -amount)));
}
document.querySelectorAll('[data-move]').forEach(b => {
  b.addEventListener('pointerdown', e => { if (phase !== 'aim' || !ready) return; e.preventDefault(); audio.unlock(); b.setPointerCapture(e.pointerId); nudge(b.dataset.move); held.add(b.dataset.move); b.classList.add('active'); });
  b.addEventListener('click', e => { if (e.detail === 0) nudge(b.dataset.move); });
  const release = () => { held.delete(b.dataset.move); b.classList.remove('active'); };
  b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release); b.addEventListener('lostpointercapture', release);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
window.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const move = keyMap[e.code];
  if (move) { e.preventDefault(); if (phase === 'aim' && ready) { if (!e.repeat && !held.has(move)) nudge(move, .025); held.add(move); document.querySelector(`[data-move="${move}"]`).classList.add('active'); } }
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); startCatch(); }
  if (e.code === 'KeyR' && !e.repeat) reset();
});
window.addEventListener('keyup', e => { const move = keyMap[e.code]; if (move) { held.delete(move); document.querySelector(`[data-move="${move}"]`).classList.remove('active'); } });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { clearInput(); accumulator = 0; last = 0; });

function setPhase(next) {
  phase = next; elapsed = 0; phaseStart = { ...claw };
  $('#stage-status').innerHTML = '<span></span>' + phaseLabels[phase];
  $('#stage-status').classList.toggle('busy', phase !== 'aim' && phase !== 'won');
  $('#turn-message').textContent = messages[phase];
  $('#catch-label').textContent = phase === 'aim' ? 'キャッチする' : phase === 'won' ? 'NICE CATCH!' : phaseLabels[phase];
  $('#catch-button').disabled = phase !== 'aim' || !ready;
  document.querySelectorAll('[data-move]').forEach(b => b.disabled = phase !== 'aim' || !ready);
}
function startCatch() { if (!ready || phase !== 'aim') return; clearInput(); audio.unlock(); audio.catch(); attempts++; updateStats(); setPhase('descend'); }
$('#catch-button').addEventListener('click', startCatch);
function reset() {
  if (!ready) return; clearInput(); physics.resetPrize(); attempts = 0; successShown = false; $('#success').hidden = true;
  aim = { x: 0, y: CONFIG.home.y, z: 0 }; claw = { ...aim, open: 1 }; physics.setClawTarget(claw);
  for (let i = 0; i < 180; i++) physics.step(CONFIG.fixedStep);
  view.setTarget(aim); updateStats(); setPhase('aim'); accumulator = 0;
}
$('#reset-button').addEventListener('click', reset);
$('#play-again').addEventListener('click', reset);
function win() {
  if (successShown) return; clearInput(); successShown = true; setPhase('won'); audio.win();
  if (!best || attempts < best) { best = attempts; try { localStorage.setItem('hashi-best', String(best)); } catch { /* Storage is optional. */ } updateStats(); }
  $('#success-detail').textContent = `${attempts}回のチャレンジで景品を獲得しました。`;
  $('#success').hidden = false;
}
const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function tick(dt) {
  elapsed += dt;
  if (phase === 'aim') {
    const dx = Number(held.has('right')) - Number(held.has('left')), dz = Number(held.has('back')) - Number(held.has('forward'));
    const speed = .65 / (dx && dz ? Math.SQRT2 : 1);
    aim.x = Math.max(-CONFIG.moveLimit.x, Math.min(CONFIG.moveLimit.x, aim.x + dx * speed * dt));
    aim.z = Math.max(-CONFIG.moveLimit.z, Math.min(CONFIG.moveLimit.z, aim.z + dz * speed * dt));
    claw = { x: aim.x, y: CONFIG.home.y, z: aim.z, open: 1 };
  } else if (phase === 'descend') {
    claw.y = lerp(phaseStart.y, 1.78, smooth(elapsed / 1.8));
    if (elapsed >= 1.8) setPhase('close');
  } else if (phase === 'close') {
    claw.open = lerp(1, 0, smooth(elapsed / 1.1));
    if (elapsed >= 1.5) setPhase('lift');
  } else if (phase === 'lift') {
    claw.y = lerp(phaseStart.y, CONFIG.home.y, smooth(elapsed / 2.3));
    if (elapsed >= 2.65) setPhase('release');
  } else if (phase === 'release') {
    claw.open = smooth(elapsed / 1.0);
    if (elapsed >= 1.3) setPhase('return');
  } else if (phase === 'return') {
    const t = smooth(elapsed / 1.2); claw.x = lerp(phaseStart.x, aim.x, t); claw.z = lerp(phaseStart.z, aim.z, t);
    if (elapsed >= 1.2) setPhase('settle');
  } else if (phase === 'settle' && elapsed >= 1.2) setPhase('aim');
  physics.setClawTarget(claw); physics.step(dt);
  const state = physics.getState();
  if (state.won && !successShown) win();
  return state;
}
function frame(time) {
  raf = requestAnimationFrame(frame);
  if (document.hidden || !ready) { last = 0; return; }
  const dt = last ? Math.min((time - last) / 1000, .1) : 0; last = time;
  accumulator += dt; let state;
  while (accumulator >= CONFIG.fixedStep) { state = tick(CONFIG.fixedStep); accumulator -= CONFIG.fixedStep; }
  state ??= physics.getState();
  view.setTarget(aim); view.update(state, dt);
  $('#position-x').textContent = aim.x.toFixed(2); $('#position-z').textContent = aim.z.toFixed(2);
}

async function init() {
  try {
    physics = await createPhysics();
    view = await createScene($('#stage'));
    physics.setClawTarget(claw); view.setTarget(aim);
    for (let i = 0; i < 180; i++) physics.step(CONFIG.fixedStep);
    ready = true; setPhase('aim');
    $('#loading').style.opacity = '0'; setTimeout(() => $('#loading').hidden = true, 500);
    raf = requestAnimationFrame(frame);
    // Read-only inspection for integration tests and diagnostics.
    window.__HASHI__ = { getState: () => ({ ...physics.getState(), phase, attempts, aim: { ...aim } }), get renderer() { return view.renderer; } };
  } catch (error) {
    console.error('HASHI initialization failed', error);
    $('#loading').classList.add('failed'); $('#loading').innerHTML = '<strong>3D画面を準備できませんでした</strong><span>WebGL 2 対応のブラウザで、ページを再読み込みしてください。</span><button onclick="location.reload()">再読み込み ↗</button>';
  }
}
window.addEventListener('pagehide', e => { cancelAnimationFrame(raf); if (!e.persisted) { view?.dispose(); physics?.dispose(); } });
window.addEventListener('pageshow', e => { if (e.persisted && ready) { last = 0; accumulator = 0; raf = requestAnimationFrame(frame); } });
init();
