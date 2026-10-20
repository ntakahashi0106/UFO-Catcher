import './style.css';
import { createIcons, ArrowUpRight, ArrowRight, ArrowDownToLine, VolumeX, Volume2, Maximize, Minimize, Infinity, Move, Camera, Crosshair, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, CircleHelp, Box, Smartphone, X, Info, Download } from 'lucide';
import { CONFIG } from './config.js';
import { PRIZE_TYPES, getPrizeType, getPrizeLowerHeadY } from './prizes.js';
import { createPhysics } from './physics.js';
import { createScene } from './scene.js';
import { initPwa } from './pwa.js';
import { createActionGate, installTouchGuards } from './input.js';

const $ = selector => document.querySelector(selector);
const icons = { ArrowUpRight, ArrowRight, ArrowDownToLine, VolumeX, Volume2, Maximize, Minimize, Infinity, Move, Camera, Crosshair, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, CircleHelp, Box, Smartphone, X, Info, Download };
function renderIcons() { createIcons({ icons, attrs: { 'aria-hidden': 'true' } }); }
const allowAction = createActionGate();
installTouchGuards();
const readStorage = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* Storage is optional. */ } };
let activePrize = getPrizeType(readStorage('hashi-prize'));
let pendingPrize = activePrize;
let physics, view, ready = false, hasStarted = false, attempts = 0, best = null, guide = true, sound = false;
let phase = 'aim', elapsed = 0, phaseStart = null, accumulator = 0, last = 0, raf = 0, successShown = false;
let blockedUntil = 0, updating = false, offlineReady = false, initializationFailed = false;
let aim = { x: 0, y: CONFIG.home.y, z: 0 }, claw = { ...aim, open: 1 };
const held = new Set();
const phaseLabels = { aim: '位置を合わせてください', descend: 'アーム下降中', close: 'アームを閉じています', lift: '持ち上げています', release: 'アームを開いています', return: '次の一手を準備中', settle: '景品の動きを確認中', won: '景品を獲得しました！' };
const messages = { aim: '位置は何度でも調整できます', descend: 'どこに掛かるか、観察してみよう', close: 'アームの力と摩擦で、箱が動きます', lift: 'この動きを、次の一手につなげよう', release: '箱の位置は、次のプレイにも引き継ぎます', return: 'もう少しで、次の一手', settle: '箱が落ち着くまで待っています', won: 'NICE CATCH! 次のチャレンジへ' };
function readBest() {
  const stored = readStorage(`hashi-best-${activePrize.id}`) ?? (activePrize.id === 'standard' ? readStorage('hashi-best') : null);
  const number = Number(stored);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function updateStats() {
  $('#attempt-count').innerHTML = String(attempts).padStart(2, '0') + '<span>回</span>';
  $('#best-count').innerHTML = (best ?? '—') + '<small>回</small>';
  $('#current-prize-label').textContent = activePrize.label;
  $('.prize-color-dot').style.background = activePrize.color;
  $('#prize-button').setAttribute('aria-label', `${activePrize.label}。箱のタイプを選び直す`);
}
function controlsAvailable() { return ready && hasStarted && !updating && !document.querySelector('dialog[open]'); }
function inputAvailable() { return controlsAvailable() && performance.now() >= blockedUntil; }
function syncControls() {
  const aiming = controlsAvailable() && phase === 'aim';
  $('#catch-button').disabled = !aiming;
  document.querySelectorAll('[data-move]').forEach(button => button.disabled = !aiming);
  $('#prize-button').disabled = !controlsAvailable() || !['aim', 'won'].includes(phase);
  $('#reset-button').disabled = !controlsAvailable();
  $('#play-again').disabled = !controlsAvailable();
  $('#prize-start').disabled = !ready || updating;
  $('#pwa-update-button').disabled = updating || (hasStarted && !['aim', 'won'].includes(phase));
}
function clearInput() { held.clear(); document.querySelectorAll('[data-move]').forEach(button => button.classList.remove('active')); }

class Sound {
  constructor() { this.context = null; }
  unlock() { try { this.context ??= new (window.AudioContext || window.webkitAudioContext)(); this.context.resume().catch(() => {}); } catch { /* Optional audio. */ } }
  tone(frequency, duration = .1, type = 'sine', volume = .035, offset = 0) {
    if (!sound || !this.context) return;
    const time = this.context.currentTime + offset, oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .015); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain).connect(this.context.destination); oscillator.start(time); oscillator.stop(time + duration + .01);
  }
  catch() { this.tone(250, .12, 'triangle'); this.tone(400, .12, 'triangle', .025, .09); }
  win() { [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => this.tone(note, .45, 'triangle', .05, index * .13)); }
}
const audio = new Sound();
function setSound(value) {
  sound = value; if (sound) audio.unlock();
  $('#sound-setting').checked = sound;
  $('#sound-button').innerHTML = `<i data-lucide="${sound ? 'volume-2' : 'volume-x'}"></i>`;
  $('#sound-button').setAttribute('aria-label', `サウンドを${sound ? 'オフ' : 'オン'}にする`);
  $('#sound-button').setAttribute('aria-pressed', String(sound)); renderIcons();
}
$('#sound-button').addEventListener('click', () => { if (allowAction('sound')) setSound(!sound); });
$('#sound-setting').addEventListener('change', event => setSound(event.target.checked));
function setGuide(value) {
  guide = value; view?.setGuide(guide); $('#guide-setting').checked = guide;
  $('#guide-button').setAttribute('aria-pressed', String(guide)); $('#guide-button span').textContent = `ガイド ${guide ? 'ON' : 'OFF'}`;
}
$('#guide-button').addEventListener('click', () => { if (allowAction('guide')) setGuide(!guide); });
$('#guide-setting').addEventListener('change', event => setGuide(event.target.checked));
$('#quality-setting').addEventListener('change', event => view?.setQuality(event.target.value));

function openDialog(dialog) { clearInput(); dialog.showModal(); syncControls(); }
function closeDialog(dialog) { dialog.close(); }
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  if (!updating && allowAction('dialog')) openDialog($(`#${button.dataset.dialog}-dialog`));
}));
document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
$('#help-done').addEventListener('click', () => closeDialog($('#help-dialog')));
$('#install-done').addEventListener('click', () => closeDialog($('#install-dialog')));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('close', () => {
    // Some browser/embedded Escape paths can close a dialog without a cancellable event.
    if (dialog.id === 'prize-dialog' && !hasStarted && !initializationFailed) dialog.showModal();
    blockedUntil = performance.now() + 350; clearInput(); syncControls();
  });
  dialog.addEventListener('click', event => {
    if (dialog.id === 'prize-dialog' && !hasStarted) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
  });
});
$('#prize-dialog').addEventListener('cancel', event => { if (!hasStarted) event.preventDefault(); });
$('#prize-dialog').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !hasStarted) event.preventDefault();
});

$('#prize-options').innerHTML = PRIZE_TYPES.map((type, index) => `<button class="prize-option" data-prize="${type.id}" aria-pressed="false" style="--box-color:${type.color};--box-accent:${type.accent}"><span class="option-index">0${index + 1}</span><span class="option-selected" aria-hidden="true">✓</span><span class="box-preview box-preview-${type.id}" aria-hidden="true"><span class="box-model"><span class="box-model-front"><b>H</b><small>HASHI</small></span><span class="box-model-side"></span><span class="box-model-top"></span></span></span><span class="option-subtitle">${type.subtitle}</span><strong>${type.label}</strong><span class="option-description">${type.description}</span><span class="option-weight">${Math.round(type.mass * 1000)} <small>g</small></span></button>`).join('');
function selectPendingPrize(id) {
  pendingPrize = getPrizeType(id);
  document.querySelectorAll('[data-prize]').forEach(button => {
    const selected = button.dataset.prize === pendingPrize.id;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
}
document.querySelectorAll('[data-prize]').forEach(button => button.addEventListener('click', () => selectPendingPrize(button.dataset.prize)));
function openPrizePicker() {
  if (hasStarted && (!inputAvailable() || !['aim', 'won'].includes(phase))) return;
  selectPendingPrize(activePrize.id);
  $('#prize-dialog').setAttribute('closedby', hasStarted ? 'closerequest' : 'none');
  $('#prize-cancel').hidden = !hasStarted;
  $('#prize-selection-note').textContent = hasStarted ? '選び直すと、景品の位置と回数をリセットします。' : '好きな箱を選んでスタート。';
  openDialog($('#prize-dialog'));
}
$('#prize-button').addEventListener('click', () => { if (allowAction('prize-picker')) openPrizePicker(); });
$('#prize-start').addEventListener('click', () => {
  if (!ready || updating || !allowAction('start-prize')) return;
  activePrize = pendingPrize; hasStarted = true; best = readBest();
  writeStorage('hashi-prize', activePrize.id); resetRound(true);
  closeDialog($('#prize-dialog')); audio.unlock();
});

$('#fullscreen-button').addEventListener('click', async () => {
  if (!allowAction('fullscreen')) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else { await document.documentElement.requestFullscreen(); try { await screen.orientation?.lock?.('landscape'); } catch { /* Browser-specific support. */ } }
  } catch { $('#fullscreen-button').title = 'このブラウザではフルスクリーンを利用できません'; }
});
document.addEventListener('fullscreenchange', () => { $('#fullscreen-button').innerHTML = `<i data-lucide="${document.fullscreenElement ? 'minimize' : 'maximize'}"></i>`; renderIcons(); view?.resize(); });
document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => {
  if (updating) return;
  view?.setCamera(button.dataset.camera);
  document.querySelectorAll('[data-camera]').forEach(other => { other.classList.toggle('selected', button === other); other.setAttribute('aria-pressed', String(button === other)); });
}));

const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'forward', KeyW: 'forward', ArrowDown: 'back', KeyS: 'back' };
function nudge(direction, amount = .035) {
  if (!inputAvailable() || phase !== 'aim') return;
  if (direction === 'left' || direction === 'right') aim.x = Math.max(-CONFIG.moveLimit.x, Math.min(CONFIG.moveLimit.x, aim.x + (direction === 'right' ? amount : -amount)));
  else aim.z = Math.max(-CONFIG.moveLimit.z, Math.min(CONFIG.moveLimit.z, aim.z + (direction === 'back' ? amount : -amount)));
}
document.querySelectorAll('[data-move]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    if (!inputAvailable() || phase !== 'aim') return;
    event.preventDefault(); audio.unlock(); button.setPointerCapture(event.pointerId);
    nudge(button.dataset.move); held.add(button.dataset.move); button.classList.add('active');
  });
  button.addEventListener('click', event => { if (event.detail === 0) nudge(button.dataset.move); });
  const release = () => { held.delete(button.dataset.move); button.classList.remove('active'); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', event => event.preventDefault());
});
window.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  const direction = keyMap[event.code];
  if (direction) {
    event.preventDefault();
    if (inputAvailable() && phase === 'aim') { if (!event.repeat && !held.has(direction)) nudge(direction, .025); held.add(direction); document.querySelector(`[data-move="${direction}"]`).classList.add('active'); }
  }
  if (event.code === 'Space' && !event.repeat && !event.target.closest('button, a, [role="button"]')) { event.preventDefault(); startCatch(); }
  if (event.code === 'KeyR' && !event.repeat) reset();
});
window.addEventListener('keyup', event => { const direction = keyMap[event.code]; if (direction) { held.delete(direction); document.querySelector(`[data-move="${direction}"]`).classList.remove('active'); } });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { clearInput(); accumulator = 0; last = 0; });

function setPhase(next) {
  phase = next; elapsed = 0; phaseStart = { ...claw };
  $('#stage-status').innerHTML = '<span></span>' + phaseLabels[phase];
  $('#stage-status').classList.toggle('busy', phase !== 'aim' && phase !== 'won');
  $('#turn-message').textContent = messages[phase];
  $('#catch-label').textContent = phase === 'aim' ? (hasStarted ? 'キャッチする' : '箱を選んでスタート') : phase === 'won' ? 'NICE CATCH!' : phaseLabels[phase];
  syncControls();
}
function startCatch() {
  if (!inputAvailable() || phase !== 'aim' || !allowAction('catch')) return;
  clearInput(); audio.unlock(); audio.catch(); attempts++; updateStats(); setPhase('descend');
}
$('#catch-button').addEventListener('click', startCatch);
function resetRound(changeType = false) {
  clearInput();
  if (changeType) physics.setPrizeType(activePrize.id); else physics.resetPrize();
  view.setPrizeType(activePrize.id);
  attempts = 0; successShown = false; $('#success').hidden = true;
  aim = { x: 0, y: CONFIG.home.y, z: 0 }; claw = { ...aim, open: 1 }; physics.setClawTarget(claw);
  for (let index = 0; index < 180; index++) physics.step(CONFIG.fixedStep);
  view.setTarget(aim); updateStats(); setPhase('aim'); accumulator = 0;
}
function reset() { if (inputAvailable() && allowAction('reset')) resetRound(); }
$('#reset-button').addEventListener('click', reset);
$('#play-again').addEventListener('click', reset);
function win() {
  if (successShown) return;
  clearInput(); successShown = true; setPhase('won'); audio.win();
  if (!best || attempts < best) { best = attempts; writeStorage(`hashi-best-${activePrize.id}`, best); updateStats(); }
  $('#success-detail').textContent = `${activePrize.label}を${attempts}回のチャレンジで獲得しました。`;
  $('#success').hidden = false;
}
const smooth = value => { value = Math.min(1, Math.max(0, value)); return value * value * (3 - 2 * value); };
const lerp = (a, b, progress) => a + (b - a) * progress;
function tick(dt) {
  elapsed += dt;
  if (phase === 'aim') {
    const dx = Number(held.has('right')) - Number(held.has('left')), dz = Number(held.has('back')) - Number(held.has('forward'));
    const speed = .65 / (dx && dz ? Math.SQRT2 : 1);
    aim.x = Math.max(-CONFIG.moveLimit.x, Math.min(CONFIG.moveLimit.x, aim.x + dx * speed * dt));
    aim.z = Math.max(-CONFIG.moveLimit.z, Math.min(CONFIG.moveLimit.z, aim.z + dz * speed * dt));
    claw = { x: aim.x, y: CONFIG.home.y, z: aim.z, open: 1 };
  } else if (phase === 'descend') {
    claw.y = lerp(phaseStart.y, getPrizeLowerHeadY(activePrize.id), smooth(elapsed / 1.8));
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
    const progress = smooth(elapsed / 1.2); claw.x = lerp(phaseStart.x, aim.x, progress); claw.z = lerp(phaseStart.z, aim.z, progress);
    if (elapsed >= 1.2) setPhase('settle');
  } else if (phase === 'settle' && elapsed >= 1.2) setPhase('aim');
  physics.setClawTarget(claw); physics.step(dt);
  const state = physics.getState();
  if (state.won && !successShown) win();
  return state;
}
function frame(time) {
  raf = requestAnimationFrame(frame);
  if (document.hidden || !ready || updating) { last = 0; return; }
  const dt = last ? Math.min((time - last) / 1000, .1) : 0; last = time;
  accumulator += dt; let state;
  while (accumulator >= CONFIG.fixedStep) { state = tick(CONFIG.fixedStep); accumulator -= CONFIG.fixedStep; }
  state ??= physics.getState();
  view.setTarget(aim); view.update(state, dt);
  $('#position-x').textContent = aim.x.toFixed(2); $('#position-z').textContent = aim.z.toFixed(2);
}

function updateOfflineStatus() {
  const status = $('#pwa-status');
  if (!navigator.onLine) { status.hidden = false; status.textContent = offlineReady ? 'オフラインでプレイ中' : 'オフラインです'; }
  else if (offlineReady) { status.hidden = false; status.textContent = '✓ オフライン対応'; }
  else status.hidden = true;
  const note = $('#offline-state');
  if (note) note.textContent = offlineReady ? '✓ オフラインで起動する準備ができました。' : '初回の読み込みと保存が完了すると、オフラインでも起動できます。';
}
const pwa = initPwa({
  onInstallAvailable({ mode, installed }) {
    $('#install-button').hidden = installed;
    $('#install-button span').textContent = mode === 'prompt' ? 'インストール' : 'アプリに追加';
  },
  onOfflineReady() { offlineReady = true; updateOfflineStatus(); },
  onUpdateAvailable() { $('#pwa-update-button').hidden = false; syncControls(); },
  onInstalled() { $('#install-button').hidden = true; },
  onError(error) { console.warn('HASHI offline setup:', error.message); },
});
$('#install-button').addEventListener('click', async () => {
  if (updating || !allowAction('install')) return;
  // Keep this call in the original user gesture for browser install prompts.
  const installation = pwa.install();
  const result = await installation;
  if (['manual', 'unavailable'].includes(result.outcome)) { updateOfflineStatus(); openDialog($('#install-dialog')); }
});
$('#pwa-update-button').addEventListener('click', () => {
  if (updating || (hasStarted && !['aim', 'won'].includes(phase)) || !allowAction('update')) return;
  updating = true; clearInput(); syncControls();
  if (!pwa.applyUpdate()) { updating = false; syncControls(); }
});
window.addEventListener('online', updateOfflineStatus);
window.addEventListener('offline', updateOfflineStatus);

async function init() {
  try {
    physics = await createPhysics({ prizeType: activePrize.id });
    view = await createScene($('#stage'), { prizeType: activePrize.id });
    physics.setClawTarget(claw); view.setTarget(aim);
    for (let index = 0; index < 180; index++) physics.step(CONFIG.fixedStep);
    ready = true; setPhase('aim');
    $('#prize-start span').textContent = 'この箱でプレイ';
    $('#loading').style.opacity = '0'; setTimeout(() => $('#loading').hidden = true, 500);
    raf = requestAnimationFrame(frame);
    window.__HASHI__ = { getState: () => ({ ...physics.getState(), phase, attempts, aim: { ...aim } }), get renderer() { return view.renderer; } };
  } catch (error) {
    console.error('HASHI initialization failed', error);
    initializationFailed = true;
    $('#prize-dialog').close();
    $('#loading').classList.add('failed'); $('#loading').innerHTML = '<strong>3D画面を準備できませんでした</strong><span>WebGL 2 対応のブラウザで、ページを再読み込みしてください。</span><button onclick="location.reload()">再読み込み ↗</button>';
  }
}
window.addEventListener('pagehide', event => { cancelAnimationFrame(raf); if (!event.persisted) { view?.dispose(); physics?.dispose(); } });
window.addEventListener('pageshow', event => { if (event.persisted && ready) { last = 0; accumulator = 0; raf = requestAnimationFrame(frame); } });
best = readBest(); updateStats(); selectPendingPrize(activePrize.id); renderIcons(); openPrizePicker(); updateOfflineStatus(); init();
