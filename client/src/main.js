import Phaser from 'phaser';
import { CLASSES, SKILLS } from '@almiargo/shared';
import './styles.css';
import { store } from './core/store.js';
import { socket } from './net/socket.js';
import { signInWithGoogle, googleOAuthConfigured } from './auth/oauth.js';
import { WorldScene } from './game/WorldScene.js';
import { Hud } from './ui/Hud.js';
import { ChatUI } from './ui/ChatUI.js';
import { InventoryUI } from './ui/InventoryUI.js';
import { ShopUI } from './ui/ShopUI.js';
import { StallUI } from './ui/StallUI.js';

const $ = (id) => document.getElementById(id);

// ── Paneles ───────────────────────────────────────────────────
const shopUI = new ShopUI();
const stallUI = new StallUI();
const chatUI = new ChatUI();
const inventoryUI = new InventoryUI({ onStall: () => stallUI.openEditor() });
const hud = new Hud({
  onInventory: () => inventoryUI.toggle(),
  onChat: () => chatUI.toggle(),
  onStall: () => stallUI.openEditor(),
});
window.__hud = hud;

let game = null;

// ── Login OAuth (sólo Google) ──────────────────────────────────
const loginScreen = $('login');
const googleSignInBtn = $('googleSignInBtn');
const loginError = $('loginError');
const loginStatus = $('loginStatus');

const characterModal = $('characterModal');
const characterForm = $('characterForm');
const characterName = $('characterName');
const createCharacterBtn = $('createCharacterBtn');
const characterError = $('characterError');
const characterStatus = $('characterStatus');

// ── Ajustes (Settings) ────────────────────────────────────────
const btnToggleControls = $('btnToggleControls');
const btnLogout = $('btnLogout');
let controlMode = localStorage.getItem('rucoy.controls') || 'joystick';
btnToggleControls.textContent = controlMode === 'joystick'
  ? '🎮 Controles: Joystick'
  : '👆 Controles: Tocar pantalla';

// Settings gear button and dropdown (top-right, next to minimap)
const btnSettingsGear = $('btnSettings');

// ── Panel de administrador ────────────────────────────────────
const btnAdmin = $('btnAdmin');
const adminPanel = $('adminPanel');
const adminStatus = $('adminStatus');

let isAdmin = false;
let adminState = { invisible: false, godMode: false };

// Track whether we've already shown the character creator for this account.
const accountSeenKey = `rucoy.accountSeen_${location.hostname}`;
let accountSeen = localStorage.getItem(accountSeenKey);

let loginBusy = false;

function setLoginStatus(text) {
  loginStatus.textContent = text || '';
  loginStatus.classList.toggle('hidden', !text);
}

function setLoginBusy(busy, text = null) {
  loginBusy = busy;
  if (googleSignInBtn) googleSignInBtn.disabled = busy;
  if (text !== null) setLoginStatus(text);
}

function showLogin(message = '') {
  hideCharacterCreator();
  loginScreen.classList.remove('hidden');
  loginError.textContent = message;
  setLoginBusy(false);
}

function hideLogin() {
  loginScreen.classList.add('hidden');
  loginError.textContent = '';
  setLoginBusy(false);
}

async function handleOAuth() {
  if (loginBusy) return;
  console.log('Iniciando Google Auth...');
  console.log('[login] click en Continuar con Google');
  loginError.textContent = '';
  setLoginBusy(true, 'Abriendo cuentas de Google...');

  try {
    const result = await signInWithGoogle();
    const token = String(result?.token ?? '');
    console.log('[login] credencial recibida, token length:', token.length);
    if (!token) throw new Error('Google no devolvio un idToken.');

    setLoginStatus('Token verificado. Conectando al servidor...');
    socket.connect({ provider: result.provider, token });
  } catch (err) {
    console.error('[login] error:', err);
    setLoginBusy(false);
    if (err?.cancelled) {
      setLoginStatus('');
      loginError.textContent = 'Inicio de sesion cancelado';
      return;
    }
    loginError.textContent = err?.message || 'No se pudo iniciar sesion';
  }
}

// Reconexión del evento al botón personalizado de Google (sin tocar el HTML/CSS).
if (googleSignInBtn) {
  googleSignInBtn.addEventListener('click', () => {
    console.log('Iniciando Google Auth...');
    console.log('[UI] click googleSignInBtn');
    handleOAuth();
  });
}

// Callback global esperado por Google Identity Services (g_id_onload).
// Evita errores de "handleGoogleCredential is not defined" en consola.
window.handleGoogleCredential = (response) => {
  console.log('Iniciando Google Auth...');
  try {
    const token = response?.credential;
    if (!token) throw new Error('Google no devolvió una credencial');
    if (loginBusy) return;
    loginError.textContent = '';
    setLoginBusy(true, 'Token verificado. Conectando al servidor...');
    socket.connect({ provider: 'google', token });
  } catch (err) {
    console.error('[login] error:', err);
    setLoginBusy(false);
    loginError.textContent = err?.message || 'No se pudo iniciar sesión';
  }
};


// ── Creación de personaje ─────────────────────────────────────
function setCharacterBusy(busy) {
  createCharacterBtn.disabled = busy;
  createCharacterBtn.textContent = busy ? 'CREANDO…' : 'ENTRAR AL MUNDO';
  characterStatus.textContent = busy ? 'Creando personaje…' : '';
  characterStatus.classList.toggle('hidden', !busy);
}

function showCharacterCreator() {
  hideLogin();
  characterError.textContent = '';
  setCharacterBusy(false);
  characterModal.classList.remove('hidden');
  setTimeout(() => characterName.focus(), 120);
}

function hideCharacterCreator() {
  if (!characterModal) return;
  characterModal.classList.add('hidden');
  setCharacterBusy(false);
  characterError.textContent = '';
  characterName.value = '';
  characterName.readOnly = false;
}

characterForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = characterName.value.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9_ ]{3,16}$/.test(name)) {
    characterError.textContent = 'Nombre inválido: 3-16 letras, números, espacios o _';
    return;
  }
  characterError.textContent = '';
  setCharacterBusy(true);
  const sent = socket.send('create_character', { name });
  if (!sent) {
    setCharacterBusy(false);
    characterError.textContent = 'Sin conexión con el servidor';
  }
});

// ── Estado de conexión ────────────────────────────────────────
socket.on('status', (status) => {
  hud.setConnectionBadge(status.state);
  const loginVisible = !loginScreen.classList.contains('hidden');

  if (status.state === 'connecting') {
    if (loginVisible) setLoginBusy(true, 'Conectando al servidor…');
  } else if (status.state === 'connected') {
    if (loginVisible) setLoginBusy(true, 'Autenticando…');
  } else if (status.state === 'error') {
    if (loginVisible) {
      setLoginBusy(false);
      loginError.textContent = status.message || 'No se pudo conectar al servidor';
    }
  } else if (status.state === 'offline') {
    if (status.code === 4001) {
      showLogin(status.reason || 'Desconectado por nueva sesión.');
      return;
    }
    if (!socket.authenticated && store.authenticated) {
      // Se perdió una sesión ya establecida: la reconexión la gestiona socket.
      return;
    }
    if (loginVisible) {
      setLoginBusy(false);
      loginError.textContent = 'No se pudo conectar al servidor. Inténtalo de nuevo.';
    }
  } else if (status.state === 'failed') {
    store.authenticated = false;
    showLogin('No se pudo reconectar. Vuelve a entrar.');
  }
});

socket.on('auth_error', (msg) => {
  const text = msg?.message === 'Sesión expirada'
    ? 'Tu sesión expiró. Vuelve a entrar.'
    : (msg?.message || 'No se pudo iniciar sesión');
  showLogin(text);
});

socket.on('account_ready', (msg) => {
  // Determinar si esta cuenta es el admin por defecto
  const isAdminEmail = msg.accountEmail === 'alejoargumedo.edu@gmail.com'
    || msg.account?.email === 'alejoargumedo.edu@gmail.com';

  // Si el servidor indica que necesita crear personaje
  if (msg.needsCharacter) {
    if (isAdminEmail) {
      // Para el admin por correo: crear personaje automáticamente con nombre ChiwiADMIN
      hideLogin();
      setLoginBusy(true, 'Creando personaje administrador…');
      // Usar nombre reservado y color morado
      socket.send('create_character', { name: 'ChiwiADMIN' });
    } else if (msg.admin) {
      // Admin flag ya establecido por el servidor
      hideLogin();
      setLoginBusy(true, 'Creando personaje de administrador…');
      socket.send('create_character', { name: 'ChiwiADMIN' });
    } else {
      // Primera vez que esta cuenta entra: mostrar selector de nombre
      accountSeen = '1';
      localStorage.setItem(accountSeenKey, '1');
      showCharacterCreator();
    }
  } else {
    // El personaje ya existe: entrar directo al mundo (omitir pantalla de nombre)
    hideLogin();
    setLoginBusy(true, 'Conectando al mundo…');
  }
});

socket.on('character_error', (msg) => {
  setCharacterBusy(false);
  characterError.textContent = msg?.message || 'No se pudo crear el personaje';
});

socket.on('session_replaced', (msg) => {
  store.authenticated = false;
  store.connected = false;
  store.player = null;
  store.self = null;
  store.entities.clear();
  if (game) {
    game.destroy(true);
    game = null;
  }
  showLogin(msg?.message || 'Desconectado por nueva sesión');
});

socket.on('hello', (msg) => {
  if (msg?.version && !loginScreen.classList.contains('hidden')) {
    setLoginStatus(`Servidor v${msg.version}`);
    setTimeout(() => {
      if (!loginScreen.classList.contains('hidden') && !loginBusy) setLoginStatus('');
    }, 1400);
  }
});

// ── Entrada al mundo ──────────────────────────────────────────
store.on('auth', (msg) => {
  hideCharacterCreator();
  hideLogin();
  hud.setOnline(msg.online ?? 1);

  // Detectar si el jugador es admin y actualizar botón
  const player = msg.player;
  const accountEmail = msg.account?.email ?? '';
  updateAdminButton(accountEmail);

  if (player?.isAdmin) {
    isAdmin = true;
    btnAdmin.classList.remove('hidden');
    if (player.nameColor) {
      $('playerName').style.color = player.nameColor;
    }
  } else {
    isAdmin = false;
    btnAdmin.classList.add('hidden');
    const playerName = $('playerName');
    if (playerName) {
      playerName.style.color = '';
    }
  }

  try {
    startGame();
  } catch (err) {
    showLogin(`No se pudo iniciar el juego: ${err?.message || err}`);
    return;
  }
  requestWakeLock();
});

// Mantiene la pantalla encendida durante la partida (usa WAKE_LOCK en Android).
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Algunos WebViews no permiten wake lock; el juego sigue funcionando.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.authenticated) requestWakeLock();
});

function startGame() {
  if (game) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0b0e14',
    banner: false,
    audio: { noAudio: true },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    render: {
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      powerPreference: 'high-performance',
    },
    input: { activePointers: 3 },
    scene: [WorldScene],
  });
  window.__rucoyGame = game;
}

// ── Avisos de juego ───────────────────────────────────────────
store.on('game-event', (msg) => {
  switch (msg.event) {
    case 'error':
      hud.toast(msg.message || 'Acción rechazada', 'error');
      break;
    case 'notice':
      hud.toast(msg.text || '', '');
      break;
    case 'system_message':
      hud.toast(msg.message || msg.text || '', 'error');
      break;
    case 'death':
      hud.showDeathInfo(msg);
      break;
    case 'respawn':
      hud.hideDeath();
      break;
    case 'level_up':
      hud.toast(`¡Subiste al nivel ${msg.level}!`, 'good');
      break;
    case 'skill_up': {
      const skill = SKILLS[msg.skill]?.name ?? msg.skill;
      hud.toast(`${skill} subió a nivel ${msg.level}`, 'good');
      break;
    }
    case 'pvp':
      if (msg.action === 'kill') {
        if (msg.targetId && msg.attackerId === store.player?.id) {
          hud.toast('Mataste a un jugador. Ahora tienes calavera roja.', 'error');
        } else if (msg.targetId && msg.skull === 'red') {
          hud.toast('Un PK ha matado a un jugador cerca de ti.', 'error');
        }
      }
      break;
    case 'class_switch':
      if (msg.classId && CLASSES[msg.classId]) {
        hud.toast(`Clase: ${CLASSES[msg.classId].name}`, '');
      }
      break;
    default:
      break;
  }
});

// ── Eventos de administrador ──────────────────────────────────
store.on('game-event', (msg) => {
  if (msg.event === 'admin_state') {
    adminState = { invisible: !!msg.invisible, godMode: !!msg.godMode };
    const btnInvis = $('btnInvisible');
    const btnGod = $('btnGodMode');
    if (btnInvis) btnInvis.classList.toggle('active', adminState.invisible);
    if (btnGod) btnGod.classList.toggle('active', adminState.godMode);
  }
  if (msg.event === 'admin_result') {
    if (msg.ok && msg.message) {
      adminStatus.textContent = msg.message;
      hud.toast(msg.message, 'good');
      setTimeout(() => { adminStatus.textContent = ''; }, 3000);
    }
  }
});

// Configurar visibilidad del botón admin basándose en cuenta + flag
function updateAdminButton(accountEmail) {
  const isAdminEmail = accountEmail === 'alejoargumedo.edu@gmail.com';
  if (isAdminEmail || isAdmin) {
    btnAdmin.classList.remove('hidden');
    // Aplicar nombre color morado para admin
    const playerName = $('playerName');
    if (playerName) {
      if (isAdminEmail) {
        playerName.style.color = '#800080'; // morado admin
      } else if (isAdmin && playerName.style.color !== '#800080') {
        // Ya estaba morado por otra razón, mantener
      }
    }
  } else {
    btnAdmin.classList.add('hidden');
    const playerName = $('playerName');
    if (playerName) {
      playerName.style.color = '';
    }
  }
}

// ── Menú de ajustes (engrane arriba a la derecha) ─────────────
btnSettingsGear?.addEventListener('click', (e) => {
  e.stopPropagation();
  openOutfitModal();
});

// Alternar entre joystick y táctil
btnToggleControls.addEventListener('click', () => {
  controlMode = controlMode === 'joystick' ? 'touch' : 'joystick';
  localStorage.setItem('rucoy.controls', controlMode);
  btnToggleControls.textContent = controlMode === 'joystick'
    ? '🎮 Controles: Joystick'
    : '👆 Controles: Tocar pantalla';
  hud.toast(
    controlMode === 'joystick'
      ? 'Controles: Joystick activado'
      : 'Controles: Tocar pantalla activado',
    '',
  );
  // Publicar el cambio para que WorldScene lo aplique
  store.emit('control-mode', controlMode);
});

// Cerrar sesión: borrar datos locales y forzar recarga a login
btnLogout.addEventListener('click', () => {
  // Cerrar modales abiertos antes de volver al login.
  document.getElementById('outfitModal')?.classList.add('hidden');
  document.getElementById('mapModal')?.classList.add('hidden');
  // Borrar sesión local (token y cuenta)
  localStorage.removeItem('rucoy.token');
  localStorage.removeItem('rucoy.account');
  // Desconectar socket
  socket.disconnect();
  socket.token = null;
  store.authenticated = false;
  store.connected = false;
  store.player = null;
  store.self = null;
  store.entities.clear();
  // Limpiar admin
  isAdmin = false;
  btnAdmin.classList.add('hidden');
  adminPanel.classList.add('hidden');
  adminState = { invisible: false, godMode: false };
  // Destruir juego
  if (game) {
    game.destroy(true);
    game = null;
  }
  // Reset HUD
  hud.hide();
  $('playerName').style.color = '';
  showLogin('Sesión cerrada correctamente');
});

// ── Panel de Administrador ────────────────────────────────────
btnAdmin.addEventListener('click', () => {
  adminPanel.classList.toggle('hidden');
});

// Admin action buttons
for (const btn of document.querySelectorAll('.admin-action-btn')) {
  btn.addEventListener('click', () => {
    if (!isAdmin) return;
    const action = btn.dataset.action;
    const sent = socket.send('admin_action', { action });
    if (!sent) {
      hud.toast('Sin conexión con el servidor', 'error');
    }
  });
}

// Cerrar paneles con su botón de cierre
for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => {
    const target = $(btn.dataset.close);
    if (target) target.classList.add('hidden');
  });
}

// ── Outfit (personalización) + Mapa completo ───────────────────────────
const OUTFIT_COLORS = ['#FF0000','#FF7F00','#FFFF00','#7FFF00','#00FF00','#00FF7F','#00FFFF','#007FFF','#0000FF','#7F00FF','#FF00FF','#FF007F','#010101','#FFFFFF','#5C3317','#8B0000','#CC5500','#808000','#006400','#004D26','#008B8B','#00008B','#4B0082','#8B008B'];
const SKIN_COLORS = ['#FFDAB9','#8D5524'];
const outfitModal = $('outfitModal');
const outfitPreview = $('outfitPreview');
const outfitPalette = $('outfitPalette');
const outfitStatus = $('outfitStatus');
const outfitSaveBtn = $('outfitSaveBtn');
const mapModal = $('mapModal');
const mapCanvas = $('mapCanvas');
const minimapWrap = $('minimapWrap');

let activeOutfitPart = 'color1';
let currentOutfit = { color1: '#c84b4b', color2: '#2a2f3a', color3: '#4a3520', color4: '#d8a37b', color5: '#FFDAB9' };

function drawOutfitPreview() {
  if (!outfitPreview) return;
  const ctx = outfitPreview.getContext('2d');
  const w = outfitPreview.width, h = outfitPreview.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, w, h);
  const sc = 2;
  const ox = (w - 32 * sc) / 2;
  const oy = (h - 36 * sc) / 2;
  const c1 = currentOutfit.color1, c2 = currentOutfit.color2, c3 = currentOutfit.color3, c4 = currentOutfit.color4, c5 = currentOutfit.color5 || '#FFDAB9';
  // piernas
  ctx.fillStyle = c2; ctx.fillRect(ox + 8*sc, oy + 25*sc, 5*sc, 9*sc); ctx.fillRect(ox + 15*sc, oy + 25*sc, 5*sc, 9*sc);
  ctx.fillStyle = c4; ctx.fillRect(ox + 7*sc, oy + 33*sc, 7*sc, 2*sc); ctx.fillRect(ox + 14*sc, oy + 33*sc, 7*sc, 2*sc);
  // torso
  ctx.fillStyle = c1; ctx.fillRect(ox + 8*sc, oy + 15*sc, 12*sc, 12*sc);
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(ox + 9*sc, oy + 16*sc, 3*sc, 9*sc);
  // cinturon
  ctx.fillStyle = c4; ctx.fillRect(ox + 8*sc, oy + 24*sc, 12*sc, 2*sc);
  // brazos
  ctx.fillStyle = c1; ctx.fillRect(ox + 5*sc, oy + 16*sc, 4*sc, 9*sc); ctx.fillRect(ox + 19*sc, oy + 16*sc, 4*sc, 9*sc);
  ctx.fillStyle = c5; ctx.fillRect(ox + 5*sc, oy + 24*sc, 4*sc, 3*sc); ctx.fillRect(ox + 19*sc, oy + 24*sc, 4*sc, 3*sc);
  // cabeza
  ctx.fillStyle = c5; ctx.fillRect(ox + 9*sc, oy + 5*sc, 10*sc, 10*sc);
  ctx.fillStyle = c5; ctx.fillRect(ox + 9*sc, oy + 12*sc, 10*sc, 3*sc);
  // cabello
  ctx.fillStyle = c3; ctx.fillRect(ox + 8*sc, oy + 3*sc, 12*sc, 5*sc); ctx.fillRect(ox + 8*sc, oy + 6*sc, 2*sc, 4*sc); ctx.fillRect(ox + 18*sc, oy + 6*sc, 2*sc, 4*sc);
  // ojos
  ctx.fillStyle = '#15181e'; ctx.fillRect(ox + 11*sc, oy + 9*sc, 2*sc, 2*sc); ctx.fillRect(ox + 15*sc, oy + 9*sc, 2*sc, 2*sc);
}

function renderOutfitPalette() {
  if (!outfitPalette) return;
  outfitPalette.innerHTML = '';
  const colors = (activeOutfitPart === 'color5') ? SKIN_COLORS : OUTFIT_COLORS;
  outfitPalette.classList.toggle('skin-palette', activeOutfitPart === 'color5');
  for (const c of colors) {
    const sw = document.createElement('div');
    sw.className = 'outfit-swatch' + (currentOutfit[activeOutfitPart] === c ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      currentOutfit[activeOutfitPart] = c;
      renderOutfitPalette();
      drawOutfitPreview();
    });
    outfitPalette.appendChild(sw);
  }
}

function openOutfitModal() {
  if (store.player?.outfit) {
    const normalized = { ...store.player.outfit };
    for (const k of ['color1','color2','color3','color4','color5']) if (String(normalized[k] ?? '').toUpperCase() === '#000000') normalized[k] = '#010101';
    currentOutfit = { color1:'#c84b4b', color2:'#2a2f3a', color3:'#4a3520', color4:'#d8a37b', color5:'#FFDAB9', ...normalized };
  }
  activeOutfitPart = 'color1';
  document.querySelectorAll('.outfit-part').forEach((b) => b.classList.toggle('active', b.dataset.part === activeOutfitPart));
  renderOutfitPalette();
  drawOutfitPreview();
  outfitModal?.classList.remove('hidden');
  if (outfitStatus) { outfitStatus.textContent = ''; outfitStatus.classList.add('hidden'); }
}

document.querySelectorAll('.outfit-part').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeOutfitPart = btn.dataset.part;
    document.querySelectorAll('.outfit-part').forEach((b) => b.classList.toggle('active', b === btn));
    renderOutfitPalette();
  });
});

if (outfitSaveBtn) {
  outfitSaveBtn.addEventListener('click', () => {
    socket.send('set_outfit', { outfit: currentOutfit });
    if (outfitStatus) { outfitStatus.textContent = 'Guardado'; outfitStatus.classList.remove('hidden'); }
    if (store.player) store.player.outfit = { ...currentOutfit };
    drawOutfitPreview();
    setTimeout(() => outfitModal?.classList.add('hidden'), 400);
  });
}

// El boton de ajustes abre directamente el modal de Outfit.

// minimap enlarge
if (minimapWrap) {
  minimapWrap.addEventListener('click', () => {
    mapModal?.classList.remove('hidden');
    renderFullMap();
  });
}
if (mapModal) {
  mapModal.addEventListener('click', (e) => {
    if (e.target === mapModal) mapModal.classList.add('hidden');
  });
}
function renderFullMap() {
  if (!mapCanvas || !store.world) return;
  const ctx = mapCanvas.getContext('2d');
  const w = mapCanvas.width, h = mapCanvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, w, h);
  const mm = window.__hud?.minimap;
  if (mm && mm.base) {
    ctx.drawImage(mm.base, 0, 0, w, h);
  }
  // draw entities
  if (mm && mm.world) {
    const sx = w / mm.world.width, sy = h / mm.world.height;
    const dot = (x, y, color, size = 3) => { ctx.fillStyle = color; ctx.fillRect(x*sx - size/2, y*sy - size/2, size, size); };
    for (const e of store.entities.values()) {
      if (e.kind === 1) dot(e.x, e.y, '#e05a5a', 3);
      else if (e.kind === 0) dot(e.x, e.y, e.skull === 'red' ? '#ff5a5a' : '#8fd1ff', 3.5);
    }
    for (const stall of store.stalls.values()) dot(stall.x, stall.y, '#6fe0c8', 3);
    const p = store.player;
    if (p) { ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x*sx - 2, p.y*sy - 2, 4, 4); }
  }
}


// ── Arranque: SIEMPRE eliminar token guardado y forzar login ──
// La app nunca debe entrar automáticamente al mapa si se cerró antes.
// El jugador debe pasar siempre por la pantalla de "Continuar con Google".
localStorage.removeItem('rucoy.token');
localStorage.removeItem('rucoy.account');

async function initAppOnStart() {
  setLoginBusy(false);
  if (!googleOAuthConfigured) {
    const message = 'Google Sign-In no está configurado en este APK. Recompila con -GoogleClientId.';
    loginError.textContent = message;
  }
  setTimeout(() => googleSignInBtn.focus(), 120);
}

initAppOnStart();

if (import.meta.env && import.meta.env.DEV) {
  setTimeout(() => {
    try {
      store.setAuth({
        player: { id: 'dev', name: 'Dev', level: 1, classId: 'knight', x: 40, y: 42, hp: 100, maxHp: 100, mp: 50, maxMp: 50, gold: 100, xp: 0, xpNext: 120, skills: {}, equipment: { weapon: null }, inventory: [], skull: 'none', nameColor: null, outfit: { color1: '#c84b4b', color2: '#2a2f3a', color3: '#4a3520', color4: '#d8a37b', color5: '#e0b08a' }, stats: { defense: 0, bonusAtk: 0, moveMs: 260 } },
        world: { seed: 1337, width: 80, height: 80, spawn: { x: 40, y: 42 }, zones: { safe: { x1: 30, y1: 30, x2: 50, y2: 50 }, pvp: { x1: 6, y1: 6, x2: 24, y2: 24 } } },
        catalog: {},
        config: { classes: CLASSES, tickRate: 20, snapshotRate: 10, aoiRadius: 20, viewHalfW: 18, viewHalfH: 11 },
        npcs: [],
        monsters: {},
        token: 'dev',
        online: 1,
      });
    } catch (e) { console.error('DEV AUTOSTART ERROR', e); }
  }, 1500);
}
