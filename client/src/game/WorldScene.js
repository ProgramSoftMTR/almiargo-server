import Phaser from 'phaser';
import {
  CLASSES,
  ENTITY_KIND,
  INTERPOLATION_MS,
  TILE,
  TILE_SIZE,
  decodeEntity,
  findPath,
  generateWorld,
  isWalkable,
  tileAt,
  ITEMS,
} from '@almiargo/shared';
import { store } from '../core/store.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { createEntityTextures, createWorldTexture, addZoneLabels, ensurePlayerTexture, createResourceTextures, createToolTextures, createWeaponTextures } from './textures.js';
import { VirtualJoystick } from '../input/Joystick.js';

const TILE_CENTER = TILE_SIZE / 2;
const toWorld = (tile) => tile * TILE_SIZE + TILE_CENTER;

function handTextureKey(handItem) {
  if (!handItem) return null;
  const direct = handItem.spriteId || handItem.textureKey || handItem.texture || null;
  if (direct) return direct;
  const id = handItem.itemId || handItem.id || null;
  if (!id) return null;
  const directMap = {
    axe: 'tool_axe',
    pickaxe: 'tool_pickaxe',
  };
  if (directMap[id]) return directMap[id];
  const catalog = (typeof window !== 'undefined' && window.__ITEMS__) ? window.__ITEMS__ : ITEMS;
  const def = (catalog && catalog[id]) || ITEMS?.[id] || null;
  const wc = def?.weaponClass ?? null;
  if (wc === 'knight') return 'weapon_knight';
  if (wc === 'archer') return 'weapon_archer';
  if (wc === 'mage') return 'weapon_mage';
  if (wc === 'adventurer') return id === 'pickaxe' ? 'tool_pickaxe' : 'tool_axe';
  if (id.startsWith('sword')) return 'weapon_knight';
  if (id.startsWith('bow')) return 'weapon_archer';
  if (id.startsWith('staff')) return 'weapon_mage';
  return null;
}

/**
 * Escena única del mundo. El servidor manda posiciones; aquí sólo se
 * interpolan entidades remotas y se predice el movimiento local.
 */
export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'world' });
    this.entityViews = new Map();
    this.stumpViews = new Map();
    this.bagViews = new Map();
    this.stallViews = new Map();
    this.path = [];
    this.pathGoal = null;
    this.pending = null;
    this.moveSeq = 0;
    this.nextStepAt = 0;
    this.lastStepSentAt = 0;
    this.moveMs = 260;
    this.localPred = { x: 40, y: 42 };
    this.localVisual = { x: 40, y: 42 };
    this.navWorld = null;
    this.unsubscribers = [];
    this.tapStart = null;
  }

  create() {
    try {
    this.worldSeed = store.world?.seed ?? 1337;
    this.worldMap = generateWorld(this.worldSeed);
    this.rebuildNav();

    createEntityTextures(this);
    createResourceTextures(this);
    createToolTextures(this);
    createWeaponTextures(this);
    createWorldTexture(this, this.worldMap);
    this.syncResourceStumps();

    this.ground = this.add.image(0, 0, 'world_ground').setOrigin(0, 0).setDepth(-100);
    addZoneLabels(this, this.worldMap);

    this.setupLocalPlayer();
    this.setupCamera();
    this.setupJoystick();
    this.setupInput();
    this.updateZoom();

    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.onShutdown());

    this.unsubscribers.push(socket.on('snapshot', (msg) => this.onSnapshot(msg)));
    this.unsubscribers.push(store.on('game-event', (msg) => this.onGameEvent(msg)));
    this.unsubscribers.push(socket.on('status', (status) => {
      if (status.state === 'offline' || status.state === 'reconnecting') {
        this.joystick?.end({ preventDefault() {} });
      }
    }));

    this.game.registry.set('worldScene', this);

    // Primer render con el estado ya autenticado.
    this.syncLocal(true);
    this.syncFromStore();
    } catch (err) {
      console.error('WORLDSCENE CREATE ERROR', err);
      this.add.text(10, 10, 'WORLDSCENE ERROR: ' + (err?.message || err), { color: '#ff0000', fontSize: '14px' }).setDepth(9999);
    }
  }

  // ── Setup ────────────────────────────────────────────────────
  setupLocalPlayer() {
    const p = store.player ?? { x: 40, y: 42, classId: 'knight' };
    const playerWeaponTexture = (p && p.weaponTexture) ? p.weaponTexture : null;
    this.localPred = { x: Number(p.x), y: Number(p.y) };
    this.localVisual = { ...this.localPred };
    this.moveMs = p.stats?.moveMs ?? 260;

    const shadow = this.add.ellipse(0, 8, 24, 9, 0x000000, 0.35);
    const localTexture = ensurePlayerTexture(this, 'base', p.outfit);
    this.localSprite = this.add.sprite(0, 0, localTexture);
    this.localSprite.setOrigin(0.5, 0.9);
    this.localWeapon = null;
    this.localAxe = this.add.image(10, -4, 'tool_axe').setOrigin(0.5, 0.9).setVisible(false);

    // Name tag + barra de vida del jugador local (mismo diseño que enemigos).
    this.localBarBg = this.add.rectangle(0, -30, 30, 4, 0x05070a, 0.7).setOrigin(0.5);
    this.localBarFill = this.add.rectangle(-15, -30, 30, 2.5, 0xd85a5a).setOrigin(0, 0.5);
    this.localNameText = this.add.text(0, -35, p.name ?? '', {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '9px',
      color: p.nameColor || '#7ef29b',
      stroke: '#05070a',
      strokeThickness: 3,
    }).setOrigin(0.5, 1);

    const top = 2 - this.localSprite.displayHeight * 0.9;
    this.localNameText.y = top - 4;
    this.localBarBg.y = top - 1;
    this.localBarFill.y = top - 1;

    this.localContainer = this.add.container(toWorld(this.localVisual.x), toWorld(this.localVisual.y), [
      shadow, this.localSprite, this.localAxe, this.localBarBg, this.localBarFill, this.localNameText,
    ].filter(Boolean));
    this.localContainer.setDepth(1000);
    this.updateLocalWeapon();
    this.updateLocalAxe();
    this.localKey = `player_${p.classId ?? 'adventurer'}`;
    this.localMoving = false;
  }

  setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.worldMap.width * TILE_SIZE, this.worldMap.height * TILE_SIZE);
    cam.setBackgroundColor('#0b0e14');
    cam.startFollow(this.localContainer, true, 0.16, 0.16);
    cam.setRoundPixels(true);
  }

  setupJoystick() {
    const el = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    if (!el || !knob) return;
    this.joystick = new VirtualJoystick(el, knob, {
      onStart: () => {
        this.path = [];
        this.pathGoal = null;
        this.pending = null;
      },
    });
  }

  setupInput() {
    this.input.on('pointerdown', (pointer) => {
      this.tapStart = { x: pointer.x, y: pointer.y, time: Date.now() };
    });
    this.input.on('pointerup', (pointer) => {
      if (!this.tapStart) return;
      const moved = Math.hypot(pointer.x - this.tapStart.x, pointer.y - this.tapStart.y);
      const elapsed = Date.now() - this.tapStart.time;
      this.tapStart = null;
      if (moved > 18 || elapsed > 700) return;
      if (document.querySelector('.sheet:not(.hidden)')
        || !document.getElementById('login').classList.contains('hidden')
        || !document.getElementById('characterModal').classList.contains('hidden')) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.onTap(world.x / TILE_SIZE, world.y / TILE_SIZE);
    });
    this.input.on('pointerupoutside', () => { this.tapStart = null; });
  }

  onResize() {
    this.updateZoom();
  }

  updateZoom() {
    const w = this.scale.width;
    const h = this.scale.height;
    const portrait = h > w;
    const targetW = portrait ? 12 : 17;
    const targetH = portrait ? 19 : 9.5;
    const raw = Math.min(w / (targetW * TILE_SIZE), h / (targetH * TILE_SIZE));
    const zoom = Phaser.Math.Clamp(Math.round(raw * 4) / 4, 1, 2.5);
    this.cameras.main.setZoom(zoom);
  }

  // ── Sincronización ───────────────────────────────────────────
  syncFromStore() {
    for (const npc of store.npcs.values()) this.ensureEntityView(npc, true);
    for (const e of store.entities.values()) this.ensureEntityView(e, true);
    for (const bag of store.bags.values()) this.ensureBagView(bag);
    for (const stall of store.stalls.values()) this.ensureStallView(stall);
  }

  onSnapshot(msg) {
    this.syncLocal();
    this.moveMs = msg.self.moveMs ?? this.moveMs;
    const receivedAt = Date.now();

    const seen = new Set();
    for (const raw of msg.ents) {
      const e = decodeEntity(raw);
      seen.add(e.id);
      const view = this.ensureEntityView(e);
      if (view) {
        view.kind = e.kind;
        view.data = e;
        // Usamos la hora de RECEPCIÓN del cliente, no msg.t del servidor:
        // los relojes del móvil y del servidor pueden estar desincronizados.
        view.buffer.push({ t: receivedAt, x: toWorld(e.x), y: toWorld(e.y) });
        if (view.buffer.length > 8) view.buffer.shift();
        this.updateEntityVisual(view, e);
      }
    }
    for (const [id, view] of this.entityViews) {
      if (!seen.has(id) && store.entities.has(id) === false && !store.npcs.has(id)) {
        view.container.destroy(true);
        this.entityViews.delete(id);
      }
    }

    const seenBags = new Set();
    for (const b of msg.bags) {
      seenBags.add(b.i);
      this.ensureBagView({
        id: b.i, x: b.x, y: b.y, ownerId: b.o, gold: b.g, itemCount: b.n,
      });
    }
    for (const [id, view] of this.bagViews) {
      if (!seenBags.has(id)) { view.destroy(true); this.bagViews.delete(id); }
    }

    const seenStalls = new Set();
    for (const s of msg.stalls) {
      seenStalls.add(s.i);
      this.ensureStallView({
        id: s.i, x: s.x, y: s.y, ownerName: s.n, itemCount: s.c, online: s.on,
      });
    }
    for (const [id, view] of this.stallViews) {
      if (!seenStalls.has(id)) { view.destroy(true); this.stallViews.delete(id); }
    }
    this.rebuildNav();
    if (this.path.length > 0 && this.pathGoal) {
      const next = this.path[0];
      if (!isWalkable(this.navWorld, next.x, next.y)) this.recomputePath();
    }
    this.emitZone();
  }

  syncLocal(force = false) {
    const self = store.self;
    const p = store.player;
    const sx = Number(self?.x ?? p?.x ?? this.localPred.x);
    const sy = Number(self?.y ?? p?.y ?? this.localPred.y);
    const dist = Math.hypot(sx - this.localPred.x, sy - this.localPred.y);
    const holding = (this.joystick?.active && this.joystick.dir) || this.path.length > 0;
    const recent = Date.now() - this.lastStepSentAt < this.moveMs * 1.8;

    // Reconciliacion suave: solo teletransporta si la diferencia es grande.
    // Con latencia (~200 ms) el servidor va por detras de la prediccion
    // local; un snap directo produce rubberbanding. Para diferencias pequenas
    // se corrige la prediccion con una interpolacion gradual.
    if (force) {
      this.localPred = { x: sx, y: sy };
      this.localVisual = { x: sx, y: sy };
      this.path = [];
      this.pending = null;
      if (this.nextStepAt < Date.now()) this.nextStepAt = Date.now() + 40;
    } else if (dist > 2.0) {
      // Desincronizacion grande: teleport instantaneo.
      this.localPred = { x: sx, y: sy };
      this.localVisual = { x: sx, y: sy };
      this.path = [];
      this.pending = null;
      if (this.nextStepAt < Date.now()) this.nextStepAt = Date.now() + 40;
    } else if (!holding && !recent && dist > 0.05) {
      // Correccion suave hacia la posicion autoritativa del servidor.
      const k = dist > 1.0 ? 0.35 : 0.18;
      this.localPred.x += (sx - this.localPred.x) * k;
      this.localPred.y += (sy - this.localPred.y) * k;
      if (this.nextStepAt < Date.now()) this.nextStepAt = Date.now() + 40;
    }
    // La apariencia base depende solo del outfit; el arma se dibuja como overlay.
  }

  rebuildNav() {
    const tiles = Uint8Array.from(this.worldMap.tiles);
    const nav = { width: this.worldMap.width, height: this.worldMap.height, tiles };
    const block = (x, y) => {
      if (x >= 0 && y >= 0 && x < nav.width && y < nav.height) tiles[y * nav.width + x] = 4;
    };
    for (const npc of store.npcs.values()) block(Math.round(npc.x), Math.round(npc.y));
    for (const e of store.entities.values()) {
      if (e.kind === ENTITY_KIND.NPC || e.kind === ENTITY_KIND.MONSTER || e.kind === ENTITY_KIND.PLAYER) {
        block(Math.round(e.x), Math.round(e.y));
      }
    }
    for (const stall of store.stalls.values()) block(Math.round(stall.x), Math.round(stall.y));
    this.navWorld = nav;
  }

  emitZone() {
    const p = this.localPred;
    const zones = store.world?.zones;
    let zone = 'Tierras salvajes';
    if (zones) {
      if (p.x >= zones.safe.x1 && p.x <= zones.safe.x2 && p.y >= zones.safe.y1 && p.y <= zones.safe.y2) zone = 'Ciudad segura';
      else if (p.x >= zones.pvp.x1 && p.x <= zones.pvp.x2 && p.y >= zones.pvp.y1 && p.y <= zones.pvp.y2) zone = 'Arena PvP';
    }
    if (store.zone !== zone) {
      store.zone = zone;
      store.emit('zone', zone);
    }
  }

  // ── Entidades visuales ───────────────────────────────────────
  ensureEntityView(e, quiet = false) {
    if (!e || e.id === store.player?.id) return null;
    const entityWeaponTexture = (e && e.weaponTexture) ? e.weaponTexture : null;
    let view = this.entityViews.get(e.id);
    if (view) return view;

    const isMonster = e.kind === ENTITY_KIND.MONSTER;
    const monsterDef = isMonster ? store.monsters?.[e.classId] : null;
    let texture = 'npc_merchant';
    if (isMonster) {
      texture = `monster_${e.classId}`;
      if (!this.textures.exists(texture)) texture = 'monster_slime';
    } else if (e.kind === ENTITY_KIND.PLAYER) {
      texture = ensurePlayerTexture(this, 'base', e.outfit);
    }

    const size = monsterDef?.size ?? 1;
    const ring = this.add.ellipse(0, 3, 32, 17).setStrokeStyle(2, 0xf2c94c, 0.95).setVisible(false);
    const shadow = this.add.ellipse(0, 8, 24 * size, 9 * size, 0x000000, 0.33);
    const sprite = this.add.sprite(0, 2, texture).setOrigin(0.5, 0.9).setScale(size);
    const handItem = e?.equipment?.mano ?? null;
    const weaponKey = handTextureKey(handItem);
    const isTool = weaponKey === 'tool_axe' || weaponKey === 'tool_pickaxe';
    const weaponSprite = (weaponKey && this.textures.exists(weaponKey))
      ? this.add.image(isTool ? 10 * size : 0, 2, weaponKey).setOrigin(0.5, 0.9).setScale(size)
      : null;
    // Sprite legacy de hacha: desactivado para evitar duplicados.
    const axeSprite = null;
    const barBg = this.add.rectangle(0, -30, 30, 4, 0x05070a, 0.7).setOrigin(0.5);
    const barFill = this.add.rectangle(-15, -30, 30, 2.5, 0xd85a5a).setOrigin(0, 0.5);
    const nameText = this.add.text(0, -35, e.name ?? '', {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '9px',
      color: e.nameColor
        || (e.kind === ENTITY_KIND.PLAYER ? '#7ef29b' : (isMonster ? '#f0dcc0' : '#9fd0ff')),
      stroke: '#05070a',
      strokeThickness: 3,
    }).setOrigin(0.5, 1);

    const top = 2 - sprite.displayHeight * 0.9;
    nameText.y = top - 4;
    barBg.y = top - 1;
    barFill.y = top - 1;

    const container = this.add.container(toWorld(e.x), toWorld(e.y), [
      ring, shadow, sprite, weaponSprite, axeSprite, barBg, barFill, nameText,
    ].filter(Boolean));
    container.setDepth(100 + e.y * 10);

    const displayHeight = sprite.displayHeight;
    view = {
      id: e.id,
      kind: e.kind,
      container,
      sprite,
      ring,
      nameText,
      barBg,
      barFill,
      displayHeight,
      buffer: quiet ? [] : [{ t: Date.now(), x: toWorld(e.x), y: toWorld(e.y) }],
      axeSprite,
      weaponSprite,
      data: e,
      lastX: toWorld(e.x),
      lastY: toWorld(e.y),
      moving: false,
      size,
    };
    this.entityViews.set(e.id, view);
    this.updateEntityVisual(view, e);
    return view;
  }

  updateLocalWeapon() {
    const handItem = store.player?.equipment?.mano ?? null;
    if (!handItem) {
      if (this.localWeapon) { this.localWeapon.destroy(); this.localWeapon = null; }
      return;
    }
    const key = handTextureKey(handItem);
    if (!key || !this.textures.exists(key)) {
      if (this.localWeapon) { this.localWeapon.destroy(); this.localWeapon = null; }
      return;
    }
    const isTool = key === 'tool_axe' || key === 'tool_pickaxe';
    const ox = isTool ? 10 : 0;
    if (!this.localWeapon) {
      this.localWeapon = this.add.image(ox, 2, key).setOrigin(0.5, 0.9);
      if (this.localContainer) this.localContainer.add(this.localWeapon);
    } else {
      if (this.localWeapon.texture && this.localWeapon.texture.key !== key) this.localWeapon.setTexture(key);
      this.localWeapon.setPosition(ox, 2);
      this.localWeapon.setVisible(true);
    }
  }

  updateLocalAxe() {
    // El render de la mano se centraliza en updateLocalWeapon/localWeapon.
    if (this.localAxe) this.localAxe.setVisible(false);
  }

  updateEntityVisual(view, e) {
    view.data = e;
    const isMonster = e.kind === ENTITY_KIND.MONSTER;
    let texture = 'npc_merchant';
    if (isMonster) {
      texture = `monster_${e.classId}`;
      if (!this.textures.exists(texture)) texture = 'monster_slime';
    } else if (e.kind === ENTITY_KIND.PLAYER) {
      texture = ensurePlayerTexture(this, e.classId || 'knight', e.outfit);
    }
    if (view.sprite.texture.key !== texture) view.sprite.setTexture(texture);
    const handItem = e?.equipment?.mano ?? view?.data?.equipment?.mano ?? null;
    const weaponKey = handTextureKey(handItem);
    if (view.weaponSprite) {
      if (weaponKey && this.textures.exists(weaponKey)) {
        if (view.weaponSprite.texture.key !== weaponKey) view.weaponSprite.setTexture(weaponKey);
        const isTool = weaponKey === 'tool_axe' || weaponKey === 'tool_pickaxe';
        view.weaponSprite.setPosition(isTool ? 10 * (view.size ?? 1) : 0, 2);
        view.weaponSprite.setVisible(true);
      } else {
        view.weaponSprite.setVisible(false);
      }
    }
    if (view.axeSprite) view.axeSprite.setVisible(false);
    const name = e.kind === ENTITY_KIND.PLAYER ? `${e.name}` : e.name;
    view.nameText.setText(name ?? '');
    if (e.kind === ENTITY_KIND.PLAYER) {
      // Verde por defecto; el servidor puede imponer un color propio (admin).
      view.nameText.setColor(e.nameColor || '#7ef29b');
      if (e.skull && e.skull !== 'none') {
        view.ring.setStrokeStyle(2, e.skull === 'red' ? 0xff4a4a : 0xf2c94c, 0.95);
      }
    } else {
      view.nameText.setColor(isMonster ? '#f0dcc0' : '#9fd0ff');
    }
    const pct = Phaser.Math.Clamp((e.hpPct ?? 100) / 100, 0, 1);
    view.barFill.displayWidth = Math.max(0.1, 30 * pct);
    // Jugadores y enemigos muestran la barra roja siempre, incluso a vida completa.
    const showBar = e.kind === ENTITY_KIND.PLAYER
      || e.kind === ENTITY_KIND.MONSTER
      || pct < 1;
    view.barBg.setVisible(showBar);
    view.barFill.setVisible(showBar);
  }

  ensureBagView(bag) {
    let view = this.bagViews.get(bag.id);
    if (view) {
      if (view.label) view.label.setText(`${bag.gold > 0 ? `${bag.gold}◈` : ''}${bag.itemCount ? ` ${bag.itemCount}▣` : ''}` || 'Bolsa');
      return view;
    }
    const shadow = this.add.ellipse(0, 5, 20, 7, 0x000000, 0.3);
    const sprite = this.add.image(0, 0, 'bag').setOrigin(0.5, 1);
    const label = this.add.text(0, -27, bag.gold > 0 ? `${bag.gold}◈${bag.itemCount ? ` ${bag.itemCount}▣` : ''}` : 'Bolsa', {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '8px', color: '#ffe08a',
      stroke: '#05070a', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    const container = this.add.container(toWorld(bag.x), toWorld(bag.y), [shadow, sprite, label]);
    container.setDepth(60 + bag.y);
    this.tweens.add({ targets: sprite, y: -3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    view = { container, sprite, label, data: bag };
    this.bagViews.set(bag.id, view);
    return view;
  }

  removeBag(bagId) {
    const view = this.bagViews.get(bagId);
    if (view) {
      view.sprite.destroy(true);
      view.label.destroy(true);
      this.bagViews.delete(bagId);
    }
  }

  ensureStallView(stall) {
    const existing = this.stallViews.get(stall.id);
    if (existing) {
      existing.data = stall;
      existing.label.setText(stall.ownerName ?? 'Tienda');
      existing.sub.setText(`${stall.itemCount ?? 0} ítems`);
      return existing;
    }
    let view = null;
    const shadow = this.add.ellipse(0, 10, 42, 12, 0x000000, 0.32);
    const sprite = this.add.image(0, 4, 'stall').setOrigin(0.5, 1);
    const label = this.add.text(0, -42, stall.ownerName ?? 'Tienda', {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '9px', color: '#ffd979',
      stroke: '#05070a', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    const sub = this.add.text(0, -32, `${stall.itemCount ?? 0} ítems`, {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '7px', color: '#c9d3e2',
      stroke: '#05070a', strokeThickness: 2,
    }).setOrigin(0.5, 1);
    const container = this.add.container(toWorld(stall.x), toWorld(stall.y), [shadow, sprite, label, sub]);
    container.setDepth(50 + stall.y);
    view = { container, sprite, label, sub, data: stall };
    this.stallViews.set(stall.id, view);
    return view;
  }

  // ── Update loop ──────────────────────────────────────────────
  update(time, delta) {
    try {
    const now = Date.now();
    if (!store.authenticated) return;

    this.handleMovementInput(now);
    this.updatePendingAction();

    // Predicción local suave
    const smooth = 1 - Math.pow(0.002, Math.min(delta, 50) / 1000);
    this.localVisual.x += (this.localPred.x - this.localVisual.x) * smooth;
    this.localVisual.y += (this.localPred.y - this.localVisual.y) * smooth;
    const lx = toWorld(this.localVisual.x);
    const ly = toWorld(this.localVisual.y);
    this.localContainer.setPosition(lx, ly);
    this.localContainer.setDepth(1000 + this.localVisual.y * 10);
    this.localMoving = Math.hypot(this.localPred.x - this.localVisual.x, this.localPred.y - this.localVisual.y) > 0.05
      || (this.joystick?.active && this.joystick.dir && now < this.nextStepAt + this.moveMs);
    this.localSprite.y = 2 - (this.localMoving ? Math.abs(Math.sin(now / 120)) * 1.8 : 0);
    this.updateLocalOverhead();

    // Interpolación de entidades remotas
    const renderTime = now - INTERPOLATION_MS;
    for (const view of this.entityViews.values()) {
      const buf = view.buffer;
      if (buf.length === 0) continue;
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i += 1) {
        if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) { a = buf[i]; b = buf[i + 1]; break; }
      }
      let alpha = 1;
      if (b.t !== a.t) alpha = Phaser.Math.Clamp((renderTime - a.t) / (b.t - a.t), 0, 1);
      const x = Phaser.Math.Linear(a.x, b.x, alpha);
      const y = Phaser.Math.Linear(a.y, b.y, alpha);
      const moved = Math.hypot(x - view.lastX, y - view.lastY) > 0.15;
      view.moving = moved;
      view.lastX = x; view.lastY = y;
      view.container.setPosition(x, y);
      view.container.setDepth(100 + (y / TILE_SIZE) * 10);
      view.sprite.y = 2 - (moved ? Math.abs(Math.sin(now / 110 + view.id.length)) * 1.6 : 0);
      while (buf.length > 2 && renderTime - buf[0].t > 1500) buf.shift();
    }

    // Anillo de objetivo
    const targetId = store.self?.targetId;
    for (const view of this.entityViews.values()) {
      view.ring.setVisible(view.id === targetId);
      if (view.id === targetId) {
        view.ring.setScale(1 + Math.sin(now / 180) * 0.6, 1 + Math.sin(now / 180) * 0.6);
      }
    }

    } catch (err) {
      console.error('WORLDSCENE UPDATE ERROR', err);
      if (!this._errShown) { this._errShown = true; this.add.text(10, 10, 'UPDATE ERROR: ' + (err?.message || err), { color: '#ff0000', fontSize: '14px' }).setDepth(9999); }
    }
  }

  updateLocalOverhead() {
    if (!this.localBarFill || !this.localNameText) return;
    const p = store.player;
    const maxHp = Math.max(1, Number(store.self?.maxHp ?? p?.maxHp ?? 1));
    const hp = Number(store.self?.hp ?? p?.hp ?? maxHp);
    const pct = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    this.localBarFill.displayWidth = Math.max(0.1, 30 * pct);
    if (p?.name && this.localNameText.text !== p.name) this.localNameText.setText(p.name);
  }

  handleMovementInput(now) {
    const self = store.self;
    if (!self || self.deadUntil > now || self.inStall) return;

    if (this.joystick?.active && this.joystick.dir) {
      if (now < this.nextStepAt) return;
      const [dx, dy] = this.joystick.dir;
      const nx = Math.round(this.localPred.x) + dx;
      const ny = Math.round(this.localPred.y) + dy;
      if (!this.clientCanWalk(nx, ny, dx, dy)) {
        this.nextStepAt = now + 80;
        return;
      }
      this.sendStep(dx, dy, now);
      this.localPred = { x: nx, y: ny };
      return;
    }

    if (this.path.length > 0) {
      if (now < this.nextStepAt) return;
      const next = this.path[0];
      const dx = Math.sign(next.x - Math.round(this.localPred.x));
      const dy = Math.sign(next.y - Math.round(this.localPred.y));
      if (dx === 0 && dy === 0) {
        this.path.shift();
        this.nextStepAt = now + 20;
        return;
      }
      if (Math.abs(next.x - this.localPred.x) > 1.5 || Math.abs(next.y - this.localPred.y) > 1.5) {
        this.recomputePath();
        return;
      }
      if (!this.clientCanWalk(Math.round(this.localPred.x) + dx, Math.round(this.localPred.y) + dy, dx, dy)) {
        this.recomputePath();
        return;
      }
      this.sendStep(dx, dy, now);
      this.localPred = { x: this.localPred.x + dx, y: this.localPred.y + dy };
      if (Math.round(this.localPred.x) === next.x && Math.round(this.localPred.y) === next.y) this.path.shift();
    }
  }

  sendStep(dx, dy, now) {
    this.moveSeq += 1;
    // Payload compacto [1, dx, dy, seq] en lugar de un objeto JSON.
    socket.sendMove(dx, dy, this.moveSeq);
    const diagonal = dx !== 0 && dy !== 0;
    this.nextStepAt = now + this.moveMs * (diagonal ? 1.18 : 1) + 45;
    this.lastStepSentAt = now;
  }

  clientCanWalk(x, y, dx, dy) {
    if (!this.navWorld) return false;
    if (!isWalkable(this.navWorld, x, y)) return false;
    if (dx !== 0 && dy !== 0) {
      return isWalkable(this.navWorld, Math.round(this.localPred.x) + dx, Math.round(this.localPred.y))
        && isWalkable(this.navWorld, Math.round(this.localPred.x), Math.round(this.localPred.y) + dy);
    }
    return true;
  }

  recomputePath() {
    this.path = [];
    const goal = this.pathGoal;
    if (!goal) return;
    const start = { x: Math.round(this.localPred.x), y: Math.round(this.localPred.y) };
    const path = findPath(this.navWorld, start.x, start.y, goal.x, goal.y, 5000);
    if (path.length) {
      this.path = path;
      this.nextStepAt = Date.now() + this.moveMs + 60;
    } else {
      this.pathGoal = null;
      this.pending = null;
    }
  }

  // ── Tap-to-move / tap-to-attack ──────────────────────────────
  onTap(wx, wy) {
    const now = Date.now();
    const self = store.self;
    if (!self || self.deadUntil > now || self.inStall) return;
    const p = this.localPred;

    // Entidades bajo el dedo
    let picked = null;
    let bestDist = Infinity;
    for (const view of this.entityViews.values()) {
      const dx = wx * TILE_SIZE - view.container.x;
      const dy = wy * TILE_SIZE - (view.container.y - view.displayHeight * 0.35);
      const d = dx * dx + dy * dy;
      if (d < 30 * 30 && d < bestDist) { bestDist = d; picked = { type: 'entity', view }; }
    }
    for (const view of this.bagViews.values()) {
      const dx = wx * TILE_SIZE - view.container.x;
      const dy = wy * TILE_SIZE - (view.container.y - 10);
      const d = dx * dx + dy * dy;
      if (d < 24 * 24 && d < bestDist) { bestDist = d; picked = { type: 'bag', view }; }
    }
    for (const view of this.stallViews.values()) {
      const dx = wx * TILE_SIZE - view.container.x;
      const dy = wy * TILE_SIZE - (view.container.y - 18);
      const d = dx * dx + dy * dy;
      if (d < 28 * 28 && d < bestDist) { bestDist = d; picked = { type: 'stall', view }; }
    }

    if (picked?.type === 'entity') {
      const e = picked.view.data;
      if (!e) return;
      if (e.kind === ENTITY_KIND.NPC) {
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (dist <= 3.1) socket.send('shop_open', { npcId: e.id });
        else this.moveToInteract(e, { type: 'npc', id: e.id, range: 2.9 });
        return;
      }
      if (e.kind === ENTITY_KIND.PLAYER || e.kind === ENTITY_KIND.MONSTER) {
        const range = (store.classDef?.range ?? 1.35) + 0.45;
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (store.self) store.self.targetId = e.id;
        if (dist <= range) {
          socket.send('attack', { id: e.id });
          this.pending = null;
        } else {
          this.startChase(e, range);
        }
      }
      return;
    }

    if (picked?.type === 'bag') {
      const bag = picked.view.data;
      const dist = Math.hypot(bag.x - p.x, bag.y - p.y);
      if (dist <= 2.0) socket.send('pickup', { id: bag.id });
      else this.moveToInteract(bag, { type: 'bag', id: bag.id, range: 1.9 });
      return;
    }

    if (picked?.type === 'stall') {
      const stall = picked.view.data;
      const dist = Math.hypot(stall.x - p.x, stall.y - p.y);
      if (dist <= 2.4) socket.send('stall_view', { id: stall.id });
      else this.moveToInteract(stall, { type: 'stall', id: stall.id, range: 2.2 });
      return;
    }

    // Tala de arboles: si se toca un tile de arbol, talar en lugar de mover.
    const treeTileX = Math.floor(wx);
    const treeTileY = Math.floor(wy);
    if (tileAt(this.worldMap, treeTileX, treeTileY) === TILE.TREE) {
      const key = `${treeTileX},${treeTileY}`;
      if (this.stumpViews.has(key)) {
        uiBus.emit('toast', { text: 'Este arbol ya fue talado', type: 'error' });
        return;
      }
      const p = this.localPred;
      const dist = Math.hypot(treeTileX + 0.5 - p.x, treeTileY + 0.5 - p.y);
      if (dist <= 2.0) {
        socket.send('chop_tree', { id: key });
      } else {
        this.moveToInteract({ x: treeTileX, y: treeTileY }, { type: 'chop', x: treeTileX, y: treeTileY, range: 1.8 });
      }
      return;
    }

    // Tap al suelo: mover y romper objetivo
    if (store.self?.targetId) {
      socket.send('stop', {});
      store.self.targetId = null;
    }
    const tile = this.nearestWalkable(Math.floor(wx), Math.floor(wy), 3);
    if (!tile) {
      uiBus.emit('toast', { text: 'No puedes caminar ahí', type: 'error' });
      return;
    }
    const path = findPath(this.navWorld, Math.round(p.x), Math.round(p.y), tile.x, tile.y, 5000);
    if (!path.length) {
      if (tile.x === Math.round(p.x) && tile.y === Math.round(p.y)) return;
      uiBus.emit('toast', { text: 'Sin camino hacia ese punto', type: 'error' });
      return;
    }
    this.path = path;
    this.pathGoal = tile;
    this.pending = null;
    this.nextStepAt = now + 30;
  }

  startChase(e, range) {
    if (!e) return;
    const p = this.localPred;
    const path = findPath(this.navWorld, Math.round(p.x), Math.round(p.y), Math.round(e.x), Math.round(e.y), 5000);
    if (!path.length) {
      uiBus.emit('toast', { text: 'No puedes alcanzar al objetivo', type: 'error' });
      return;
    }
    this.path = path;
    this.pathGoal = { x: Math.round(e.x), y: Math.round(e.y) };
    this.pending = { type: 'attack', id: e.id, range };
    this.nextStepAt = Date.now() + 30;
  }

  moveToInteract(target, pending) {
    const p = this.localPred;
    let best = null;
    let bestLen = Infinity;
    const candidates = [];
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const x = Math.round(target.x) + ox;
        const y = Math.round(target.y) + oy;
        if (isWalkable(this.navWorld, x, y)) candidates.push({ x, y });
      }
    }
    if (isWalkable(this.navWorld, Math.round(target.x), Math.round(target.y))) {
      candidates.push({ x: Math.round(target.x), y: Math.round(target.y) });
    }
    for (const c of candidates) {
      const path = findPath(this.navWorld, Math.round(p.x), Math.round(p.y), c.x, c.y, 5000);
      if (path.length && path.length < bestLen) { bestLen = path.length; best = path; }
    }
    if (!best || !best.length) {
      uiBus.emit('toast', { text: 'No hay camino hasta ahí', type: 'error' });
      return;
    }
    this.path = best;
    this.pathGoal = best[best.length - 1];
    this.pending = pending;
    this.nextStepAt = Date.now() + 30;
  }

  handleUpdateResource(msg) {
    if (msg?.resource !== 'tree') return;
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    const key = `${x},${y}`;
    if (msg.state === 'stump') this.addStump(x, y, key);
    else this.removeStump(key);
  }

  addStump(x, y, key) {
    if (this.stumpViews.has(key)) return;
    const sprite = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 'tree_stump')
      .setOrigin(0.5, 0.5).setDepth(-50);
    this.stumpViews.set(key, sprite);
  }

  removeStump(key) {
    const sprite = this.stumpViews.get(key);
    if (sprite) { sprite.destroy(); this.stumpViews.delete(key); }
  }

  syncResourceStumps() {
    if (!store.resourceStumps) return;
    for (const key of store.resourceStumps) {
      const [x, y] = key.split(',').map((v) => Number.parseInt(v, 10));
      if (Number.isInteger(x) && Number.isInteger(y)) this.addStump(x, y, key);
    }
  }

  updatePendingAction() {
    if (!this.pending) return;
    const p = this.localPred;
    if (this.pending.type === 'chop') {
      const dist = Math.hypot(this.pending.x + 0.5 - p.x, this.pending.y + 0.5 - p.y);
      if (dist <= (this.pending.range ?? 1.8)) {
        socket.send('chop_tree', { id: `${this.pending.x},${this.pending.y}` });
        this.pending = null;
        this.path = [];
        this.pathGoal = null;
      }
      return;
    }
    let entity = null;
    if (this.pending.type === 'attack') entity = store.entities.get(this.pending.id);
    if (this.pending.type === 'bag') entity = store.bags.get(this.pending.id);
    if (this.pending.type === 'stall') entity = store.stalls.get(this.pending.id);
    if (this.pending.type === 'npc') entity = store.npcs.get(this.pending.id) ?? store.entities.get(this.pending.id);
    if (!entity) { this.pending = null; this.path = []; return; }

    const dist = Math.hypot(entity.x - p.x, entity.y - p.y);
    if (dist <= this.pending.range) {
      const type = this.pending.type;
      const id = this.pending.id;
      this.pending = null;
      this.path = [];
      this.pathGoal = null;
      if (type === 'attack') socket.send('attack', { id });
      else if (type === 'npc') socket.send('shop_open', { npcId: id });
      else if (type === 'bag') socket.send('pickup', { id });
      else if (type === 'stall') socket.send('stall_view', { id });
    }
  }

  nearestWalkable(tx, ty, radius = 2) {
    if (isWalkable(this.navWorld, tx, ty)) return { x: tx, y: ty };
    let best = null;
    let bestD = Infinity;
    for (let r = 1; r <= radius; r += 1) {
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const x = tx + ox;
          const y = ty + oy;
          if (!isWalkable(this.navWorld, x, y)) continue;
          const d = ox * ox + oy * oy;
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      }
      if (best) return best;
    }
    return best;
  }

  // ── Eventos y efectos ────────────────────────────────────────
  onGameEvent(msg) {
    switch (msg.event) {
      case 'damage':
        this.floatDamage(msg);
        break;
      case 'special':
        this.playSpecial(msg);
        break;
      case 'death':
        this.playDeath(msg);
        break;
      case 'level_up':
        this.playLevelUp();
        break;
      case 'heal':
        if (msg.hp > 0) this.floatText(`+${msg.hp}`, this.localContainer.x, this.localContainer.y - 40, '#7ef29b');
        if (msg.mp > 0) this.floatText(`+${msg.mp} MP`, this.localContainer.x, this.localContainer.y - 52, '#82b4ff');
        break;
      case 'loot_pickup':
        if (msg.gold > 0) this.floatText(`+${msg.gold}◈`, this.localContainer.x, this.localContainer.y - 40, '#f2c94c');
        break;
      case 'drop_despawn':
        // El servidor removió la bolsa temporalmente (timeout 60s o pickup)
        // Eliminar el sprite visual de la bolsa
        const bagView = this.bagViews.get(msg.bagId);
        if (bagView) {
          bagView.container.destroy(true);
          this.bagViews.delete(msg.bagId);
        }
        break;
      case 'move_reject':
        this.handleMoveReject(msg);
        break;
      case 'respawn':
        if (msg.id === store.player?.id) this.applyRespawn(msg);
        break;
      case 'profile':
        if (msg.player?.outfit && this.localSprite) {
          const newKey = ensurePlayerTexture(this, 'base', msg.player.outfit);
          if (this.localSprite.texture.key !== newKey) this.localSprite.setTexture(newKey);
          if (store.player) store.player.outfit = msg.player.outfit;
        }
        this.updateLocalAxe();
        this.updateLocalWeapon();
        break;
      case 'update_resource':
        this.handleUpdateResource(msg);
        break;
      case 'resource_states':
        for (const r of (msg.resources || [])) {
          if (r?.state === 'stump') this.addStump(r.x, r.y, `${r.x},${r.y}`);
        }
        break;
      default:
        break;
    }
  }

  handleMoveReject(msg) {
    const sx = Number(msg.x);
    const sy = Number(msg.y);
    const dist = Math.hypot(sx - this.localPred.x, sy - this.localPred.y);
    this.localPred = { x: sx, y: sy };
    // Solo teletransporta la visual si la diferencia es grande; si no, la
    // interpolacion suave del bucle de render corrige sin rubberbanding.
    if (dist > 2.0) this.localVisual = { x: sx, y: sy };
    this.nextStepAt = Date.now() + this.moveMs + 80;
    if (this.pathGoal) {
      const goal = this.pathGoal;
      const path = findPath(this.navWorld, Math.round(this.localPred.x), Math.round(this.localPred.y), goal.x, goal.y, 5000);
      this.path = path;
      if (!path.length) this.pathGoal = null;
    }
  }

  floatDamage(msg) {
    const isSelf = msg.tid === store.player?.id;
    const color = isSelf ? '#ff8080' : (msg.crit ? '#ffe066' : '#ffffff');
    const size = msg.crit ? 17 : 13;
    this.floatText(`${isSelf ? '-' : ''}${msg.amount}${msg.crit ? '!' : ''}`, toWorld(msg.x), toWorld(msg.y) - 22, color, size);
    if (msg.crit) this.cameras.main.shake(60, 0.0018);
  }

  floatText(text, x, y, color = '#fff', size = 13) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color,
      stroke: '#05070a',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(8000);
    this.tweens.add({
      targets: label,
      y: y - 30,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.out',
      onComplete: () => label.destroy(),
    });
  }

  playSpecial(msg) {
    const ring = this.add.ellipse(toWorld(msg.x), toWorld(msg.y), 20, 14)
      .setStrokeStyle(4, 0xffd36e, 0.9).setDepth(7000);
    this.tweens.add({
      targets: ring,
      scale: (msg.radius ?? 2) * 2.1,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.out',
      onComplete: () => ring.destroy(),
    });
    this.cameras.main.shake(100, 0.0025);
  }

  applyRespawn(msg) {
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const self = store.self;
    if (self) {
      self.x = x;
      self.y = y;
      self.hp = msg.hp ?? self.maxHp;
      self.mp = msg.mp ?? self.maxMp;
      self.maxHp = msg.maxHp ?? self.maxHp;
      self.maxMp = msg.maxMp ?? self.maxMp;
      self.deadUntil = 0;
      self.targetId = null;
    }
    const player = store.player;
    if (player) {
      player.x = x;
      player.y = y;
      player.hp = msg.hp ?? player.maxHp;
      player.mp = msg.mp ?? player.maxMp;
    }

    this.localPred = { x, y };
    this.localVisual = { x, y };
    this.path = [];
    this.pathGoal = null;
    this.pending = null;
    this.moveSeq = Number.isFinite(this.moveSeq) ? this.moveSeq : 0;
    const wx = toWorld(x);
    const wy = toWorld(y);
    if (this.localContainer) {
      this.localContainer.setPosition(wx, wy);
      this.localContainer.setDepth(1000 + y * 10);
    }
    // La cámara sigue al contenedor local; centrarla ya evita un barrido largo
    // desde la posición de muerte hasta la ciudad.
    this.cameras.main.centerOn(wx, wy);
    this.syncLocal(true);
    this.nextStepAt = 0;
    this.lastStepSentAt = 0;
  }

  playDeath(msg) {
    const x = toWorld(msg.x);
    const y = toWorld(msg.y);
    for (let i = 0; i < 7; i += 1) {
      const dot = this.add.circle(x, y - 12, 2 + Math.random() * 3, msg.kind === 'player' ? 0xff6b6b : 0xd8b46a, 0.9).setDepth(7500);
      this.tweens.add({
        targets: dot,
        x: x + (Math.random() - 0.5) * 46,
        y: y - 12 + (Math.random() - 0.7) * 34,
        alpha: 0,
        duration: 420 + Math.random() * 260,
        ease: 'Cubic.out',
        onComplete: () => dot.destroy(),
      });
    }
  }

  playLevelUp() {
    if (!this.localContainer) return;
    const ring = this.add.ellipse(this.localContainer.x, this.localContainer.y, 26, 16)
      .setStrokeStyle(3, 0xa6e35f, 0.95).setDepth(7600);
    this.tweens.add({
      targets: ring, scale: 3.5, alpha: 0, duration: 700, ease: 'Cubic.out',
      onComplete: () => ring.destroy(),
    });
    this.floatText('¡NIVEL!', this.localContainer.x, this.localContainer.y - 54, '#b8ff7a', 16);
  }

  onShutdown() {
    this.scale.off('resize', this.onResize, this);
    for (const unsub of this.unsubscribers) unsub?.();
    this.unsubscribers = [];
    this.joystick = null;
  }
}
