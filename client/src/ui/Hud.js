import { CLASSES, ITEMS } from '@almiargo/shared';
import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { Minimap } from './Minimap.js';

const $ = (id) => document.getElementById(id);

/**
 * HUD móvil: barras, minimapa, acciones rápidas, objetivo, muerte y toasts.
 */
export class Hud {
  constructor({ onInventory, onChat, onStall }) {
    this.onInventory = onInventory;
    this.onChat = onChat;
    this.onStall = onStall;
    this.hud = $('hud');
    this.formatted = '';
    this.feed = [];
    this.deathInterval = null;
    this.minimap = new Minimap($('minimap'));

    this.bind();
    this.subscribe();

    this.minimapTimer = setInterval(() => {
      if (store.authenticated) this.minimap.render();
    }, 300);
    this.updateTimer = setInterval(() => this.updateTarget(), 250);
  }

  show() {
    this.hud.classList.remove('hidden');
    this.minimap.render();
  }

  hide() {
    this.hud.classList.add('hidden');
  }

  bind() {
    $('btnHp').addEventListener('click', () => this.usePotion('hp'));
    $('btnMp').addEventListener('click', () => this.usePotion('mp'));
    $('btnSpecial').addEventListener('click', () => {
      socket.send('special', {});
    });
    $('btnInventory').addEventListener('click', () => this.onInventory?.());
    $('btnChat').addEventListener('click', () => this.onChat?.());
    $('btnStall').addEventListener('click', () => this.onStall?.());
    $('chatFeed').addEventListener('click', () => this.onChat?.());

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'q' || e.key === 'Q') this.usePotion('hp');
      if (e.key === 'w' || e.key === 'W') this.usePotion('mp');
      if (e.code === 'Space') { e.preventDefault(); socket.send('special', {}); }
      if (e.key === 'i' || e.key === 'I') this.onInventory?.();
      if (e.key === 'Enter') this.onChat?.();
    });

    uiBus.on('toast', (t) => this.toast(t.text, t.type));
    uiBus.on('open-inventory', () => this.onInventory?.());
    uiBus.on('open-chat', () => this.onChat?.());
  }

  subscribe() {
    store.on('auth', () => {
      this.minimap.build(store.world);
      this.show();
      this.update(true);
    });
    store.on('snapshot', () => this.update());
    store.on('profile', () => this.update(true));
    store.on('zone', (zone) => { $('zoneLabel').textContent = zone; });
    store.on('chat', (msg) => this.addFeed(msg));
  }

  usePotion(kind) {
    const potion = store.findPotion(kind);
    if (!potion) {
      this.toast(`No tienes pociones de ${kind === 'hp' ? 'vida' : 'maná'}`, 'error');
      return;
    }
    socket.send('use_item', { uid: potion.uid });
  }

  update(profile = false) {
    const p = store.player;
    const self = store.self;
    if (!p) return;
    const hp = self?.hp ?? p.hp ?? 0;
    const maxHp = self?.maxHp ?? p.maxHp ?? 1;
    const mp = self?.mp ?? p.mp ?? 0;
    const maxMp = self?.maxMp ?? p.maxMp ?? 1;
    const xp = self?.xp ?? p.xp ?? 0;
    const xpNext = self?.xpNext ?? p.xpNext ?? 1;

    const playerNameEl = $('playerName');
    if (playerNameEl) { playerNameEl.textContent = p.name; if (p.nameColor) playerNameEl.style.color = p.nameColor; }
    const levelBadgeEl = $('levelBadge'); if (levelBadgeEl) levelBadgeEl.textContent = p.level;
    const classDef = CLASSES[p.classId] ?? CLASSES.knight;
    const classLabelEl = $('classLabel'); if (classLabelEl) classLabelEl.textContent = classDef.name;
    const hpFillEl = $('hpFill'); if (hpFillEl) hpFillEl.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
    const mpFillEl = $('mpFill'); if (mpFillEl) mpFillEl.style.width = `${Math.max(0, Math.min(100, (mp / maxMp) * 100))}%`;
    const hpTextEl = $('hpText'); if (hpTextEl) hpTextEl.textContent = `${Math.ceil(hp)} / ${maxHp}`;
    const mpTextEl = $('mpText'); if (mpTextEl) mpTextEl.textContent = `${Math.ceil(mp)} / ${maxMp}`;
    const xpFill = $('xpFill');
    const xpText = $('xpText');
    if (xpFill) xpFill.style.width = `${Math.max(0, Math.min(100, (xp / Math.max(1, xpNext)) * 100))}%`;
    if (xpText) xpText.textContent = `${xp} / ${xpNext} XP`;
    const skull = self?.skull ?? p.skull ?? 'none';
    const skullIcon = $('skullIcon');
    if (skullIcon) skullIcon.classList.toggle('hidden', !skull || skull === 'none');
    const goldTextEl = $('goldText'); if (goldTextEl) goldTextEl.textContent = p.gold ?? 0;
    $('onlineText').textContent = `● ${store.online ?? 1}${store.latency ? ` · ${store.latency}ms` : ''}`;

    for (const btn of document.querySelectorAll('.class-btn')) {
      btn.classList.toggle('active', btn.dataset.class === p.classId);
    }

    const hpPot = store.findPotion('hp');
    const mpPot = store.findPotion('mp');
    const hpPotCountEl = $('hpPotCount'); if (hpPotCountEl) hpPotCountEl.textContent = hpPot?.qty ?? 0;
    const mpPotCountEl = $('mpPotCount'); if (mpPotCountEl) mpPotCountEl.textContent = mpPot?.qty ?? 0;

    const selfData = self ?? p;
    const specialReady = !selfData.nextSpecialAt || selfData.nextSpecialAt < Date.now();
    const btnSpecialEl = $('btnSpecial'); if (btnSpecialEl) btnSpecialEl.classList.toggle('ready', specialReady);
    if (btnSpecialEl) btnSpecialEl.classList.toggle('cooling', !specialReady);

    const deadUntil = self?.deadUntil ?? 0;
    if (deadUntil > Date.now()) this.showDeath(deadUntil);
    else { const deathOverlayEl = $('deathOverlay'); if (deathOverlayEl && !deathOverlayEl.classList.contains('hidden')) this.hideDeath(); }

    this.updateTarget();
    if (profile) this.emitProfile();
  }

  emitProfile() {
    const p = store.player;
    if (!p) return;
  }

  updateTarget() {
    const target = store.target;
    const plate = $('targetPlate');
    if (!plate) return;
    if (!target) { plate.classList.add('hidden'); return; }
    plate.classList.remove('hidden');
    $('targetName').textContent = `${target.name} · ${target.level}`;
    const pct = Math.max(0, Math.min(100, target.hpPct));
    const targetFillEl = $('targetFill'); if (targetFillEl) targetFillEl.style.width = `${pct}%`;
  }

  addFeed(msg) {
    if (msg.channel === 'private') {
      this.feed.push({ text: `[MP] ${msg.from}: ${msg.text}`, color: '#ef9bff' });
    } else if (msg.channel === 'clan') {
      this.feed.push({ text: `[Clan] ${msg.from}: ${msg.text}`, color: '#8ff0b5' });
    } else {
      this.feed.push({
        text: msg.channel === 'system' ? msg.text : `${msg.from}: ${msg.text}`,
        color: msg.channel === 'global' ? '#ffd479' : (msg.channel === 'local' ? '#d7e3ff' : '#aab2c0'),
      });
    }
    if (this.feed.length > 4) this.feed.shift();
    const feedEl = $('chatFeed');
    if (!feedEl) return;
    feedEl.textContent = '';
    for (const line of this.feed) {
      const div = document.createElement('div');
      div.className = 'feed-line';
      div.style.color = line.color;
      div.textContent = line.text;
      feedEl.appendChild(div);
    }
  }

  setOnline(count) {
    store.online = count;
    $('onlineText').textContent = `● ${count}${store.latency ? ` · ${store.latency}ms` : ''}`;
  }

  toast(text, type = '') {
    if (!text) return;
    const box = $('toasts');
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = text;
    box.appendChild(div);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => {
      div.style.transition = 'opacity .25s';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 260);
    }, 2800);
  }

  showDeath(until) {
    const overlay = $('deathOverlay');
    if (overlay.classList.contains('hidden')) overlay.classList.remove('hidden');
    this.deathUntil = until;
    if (this.deathInterval) return;
    this.deathInterval = setInterval(() => {
      const left = Math.max(0, Math.ceil((this.deathUntil - Date.now()) / 1000));
      $('deathTimer').textContent = left;
      if (left <= 0) {
        this.hideDeath();
        $('deathInfo').textContent = 'Regresando a la ciudad…';
      }
    }, 200);
  }

  hideDeath() {
    $('deathOverlay').classList.add('hidden');
    if (this.deathInterval) clearInterval(this.deathInterval);
    this.deathInterval = null;
  }

  showDeathInfo(info) {
    const parts = [];
    if (info.xpLoss) parts.push(`-${info.xpLoss} XP`);
    if (info.goldLoss) parts.push(`-${info.goldLoss} oro`);
    if (info.dropped) parts.push('¡Perdiste equipamiento!');
    $('deathInfo').textContent = parts.length ? parts.join(' · ') : 'Regresando a la ciudad…';
    this.showDeath(info.respawnAt);
  }

  setConnectionBadge(state) {
    const badge = $('connectionBadge');
    if (state === 'offline' || state === 'reconnecting' || state === 'connecting') {
      badge.textContent = state === 'reconnecting' ? 'Reconectando…' : 'Conectando…';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}
