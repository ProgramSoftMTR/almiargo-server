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
import { drawItemIcon } from '../ui/icons.js';
import { socket } from '../net/socket.js';
import { uiBus } from '../core/uiBus.js';
import { createEntityTextures, addZoneLabels, ensurePlayerTexture, createResourceTextures, createToolTextures, createWeaponTextures } from './textures.js';
import { createWorldTexture, regenerateWorldChunk } from './worldTexture.js';
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
    this.reconcile = null;
    this.navWorld = null;
    this.unsubscribers = [];
    this.tapStart = null;
    this.partyMenu = null;
    this.lastGroundTap = 0;
    this._fpsFrames = 0;
    this._fpsLast = 0;
    this.fps = 60;
  }

  create() {
    try {
    window.__setLoadingProgress?.(85, 'Cargando terreno...');
    this.worldSeed = store.world?.seed ?? 1337;
    this.worldMap = generateWorld(this.worldSeed);
    this.worldMap.chopped = new Set();
    this.rebuildNav();

    createEntityTextures(this);
    createResourceTextures(this);
    createToolTextures(this);
    createWeaponTextures(this);
    this.groundChunks = createWorldTexture(this, this.worldMap);
    this.syncResourceStumps();

    addZoneLabels(this, this.worldMap);

    this.setupLocalPlayer();
    uiBus.on('crafting', (msg) => {
      if (this.localCraftIcon) this.localCraftIcon.setVisible(!!msg?.open);
    });
    this.setupCamera();
    this.setupJoystick();
    this.setupInput();
    this.activeProjectiles = [];
    this.impactEffects = [];
    this.projectileGraphics = this.add.graphics().setDepth(1000);
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

    // Garantizar que el primer frame este pintado antes de ocultar la pantalla de carga.
    requestAnimationFrame(() => {
      window.__setLoadingProgress?.(100, 'Listo');
      this.cameras.main.setLerp(0.16, 0.16);
      window.__hideLoadingScreen?.();
    });
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
    this.localShadow = shadow;
    const localTexture = ensurePlayerTexture(this, 'base', p.outfit);
    this.localSprite = this.add.sprite(0, 0, localTexture);
    this.localSprite.setOrigin(0.5, 0.9);
    this.localWeapon = null;
    this.localAxe = this.add.image(10, -4, 'tool_axe').setOrigin(0.5, 0.9).setVisible(false);
    if (!this.textures.exists('craft_hammer_wrench')) {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      // Martillo (diagonal)
      ctx.save();
      ctx.translate(10, 8);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#8a6034';
      ctx.fillRect(0, 0, 4, 18); // mango
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(-6, -6, 16, 8); // cabeza
      ctx.fillStyle = '#6f8ce8';
      ctx.fillRect(-4, -4, 12, 4);
      ctx.restore();
      // Llave inglesa (diagonal opuesta)
      ctx.save();
      ctx.translate(22, 8);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#8a6034';
      ctx.fillRect(-2, 0, 4, 18); // mango
      ctx.fillStyle = '#b9c2cf';
      ctx.fillRect(-6, -6, 12, 8); // cabeza abierta
      ctx.fillStyle = '#5a6a7a';
      ctx.fillRect(-4, -4, 8, 4);
      ctx.fillRect(-2, -6, 4, 2);
      ctx.restore();
      this.textures.addCanvas('craft_hammer_wrench', c);
    }
    this.localCraftIcon = this.add.image(0, -46, 'craft_hammer_wrench').setOrigin(0.5).setScale(0.9).setVisible(false);

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
      shadow, this.localSprite, this.localAxe, this.localBarBg, this.localBarFill, this.localNameText, this.localCraftIcon,
    ].filter(Boolean));
    this.localContainer.setDepth(toWorld(this.localVisual.y) + (this.localSprite?.displayHeight ?? 0) / 2);
    this.updateLocalWeapon();
    this.updateLocalAxe();
    this.localKey = `player_${p.classId ?? 'adventurer'}`;
    this.localMoving = false;
  }

  setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.worldMap.width * TILE_SIZE, this.worldMap.height * TILE_SIZE);
    cam.setBackgroundColor('#0b0e14');
    // Posicionamiento instantaneo (sin lerp inicial).
    cam.setLerp(1, 1);
    cam.startFollow(this.localContainer, true, 1, 1);
    cam.setRoundPixels(false);
    const p = store.player ?? { x: this.localPred?.x ?? 0, y: this.localPred?.y ?? 0 };
    cam.centerOn((p.x ?? 0) * TILE_SIZE, (p.y ?? 0) * TILE_SIZE);
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

    const delta = msg.delta === true;
    const removed = Array.isArray(msg.removed) ? msg.removed : [];
    const seen = new Set();
    for (const raw of msg.ents) {
      const e = decodeEntity(raw);
      seen.add(e.id);
      const view = this.ensureEntityView(e);
      if (view) {
        view.kind = e.kind;
        view.data = e;
        // Guarda la posicion autoritativa del servidor como objetivo.
        view.serverX = toWorld(e.x);
        view.serverY = toWorld(e.y);
        this.updateEntityVisual(view, e);
      }
    }
    if (delta) {
      for (const id of removed) {
        const view = this.entityViews.get(id);
        if (view) { view.container.destroy(true); this.entityViews.delete(id); }
      }
    } else {
      for (const [id, view] of this.entityViews) {
        if (!seen.has(id) && store.entities.has(id) === false && !store.npcs.has(id)) {
          view.container.destroy(true);
          this.entityViews.delete(id);
        }
      }
    }

    const seenBags = new Set();
    for (const b of msg.bags) {
      seenBags.add(b.i);
      this.ensureBagView({
        id: b.i, x: b.x, y: b.y, ownerId: b.o, gold: b.g, itemCount: b.n, itemId: b.k,
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
    const recentInput = Date.now() - this.lastStepSentAt < 400;

    // Reconciliacion suave: evita teletransportes bruscos (snap) salvo
    // desincronizacion grave (>2.5 tiles) o bloqueo por colision.
    if (force) {
      this.localPred = { x: sx, y: sy };
      this.localVisual = { x: sx, y: sy };
      this.reconcile = null;
      this.path = [];
      this.pending = null;
      if (this.nextStepAt < Date.now()) this.nextStepAt = Date.now() + 40;
    } else if (dist > 2.5 && !recentInput) {
      // Desincronizacion grave: ajuste directo.
      this.localPred = { x: sx, y: sy };
      this.localVisual = { x: sx, y: sy };
      this.reconcile = null;
      this.path = [];
      this.pending = null;
      if (this.nextStepAt < Date.now()) this.nextStepAt = Date.now() + 40;
    } else if (!holding && !recent && dist > 0.05 && dist < 1.5) {
      // Desviacion pequena (<1.5 tiles): correccion gradual mediante lerp
      // suave durante 100-150 ms hacia la posicion autoritativa del servidor.
      this.reconcile = {
        fromX: this.localPred.x, fromY: this.localPred.y,
        toX: sx, toY: sy,
        start: Date.now(), duration: 120,
      };
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
    // Los tocones (árboles talados) no tienen colisión.
    for (const key of this.stumpViews.keys()) {
      const [sx, sy] = key.split(',').map((v) => Number.parseInt(v, 10));
      if (Number.isInteger(sx) && Number.isInteger(sy) && sx >= 0 && sy >= 0 && sx < nav.width && sy < nav.height) {
        nav.tiles[sy * nav.width + sx] = 0;
      }
    }
    this.navWorld = nav;
  }

  emitZone() {
    const p = this.localPred;
    const zones = store.world?.zones;
    let zone = 'TIERRAS SALVAJES';
    if (zones) {
      if (p.x >= zones.safe.x1 && p.x <= zones.safe.x2 && p.y >= zones.safe.y1 && p.y <= zones.safe.y2) zone = 'CIUDAD';
      else if (p.x >= zones.pvp.x1 && p.x <= zones.pvp.x2 && p.y >= zones.pvp.y1 && p.y <= zones.pvp.y2) zone = 'ARENA PVP';
      else {
        const tile = tileAt(this.worldMap, Math.round(p.x), Math.round(p.y));
        switch (tile) {
          case TILE.SAND: zone = 'PLAYA'; break;
          case TILE.FOREST: zone = 'BOSQUE'; break;
          case TILE.SWAMP: zone = 'PANTANO'; break;
          case TILE.SAVANNA: zone = 'SABANA'; break;
          case TILE.SNOW: zone = 'TIERRAS NEVADAS'; break;
          case TILE.MOUNTAIN: zone = 'MONTAÑAS'; break;
          case TILE.WATER: zone = 'OCÉANO'; break;
          default: zone = 'TIERRAS SALVAJES'; break;
        }
      }
    }
    if (this.lastBiomeLabel === zone) return;
    this.lastBiomeLabel = zone;
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
    container.setDepth(toWorld(e.y) + (sprite.displayHeight ?? 0) / 2);

    const displayHeight = sprite.displayHeight;
    view = {
      id: e.id,
      kind: e.kind,
      container,
      sprite,
      shadow,
      ring,
      nameText,
      barBg,
      barFill,
      displayHeight,
      buffer: quiet ? [] : [],
      serverX: toWorld(e.x),
      serverY: toWorld(e.y),
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
      if (view.label) {
        const isItemDrop = !!bag.itemId && !bag.gold && (bag.itemCount ?? 1) === 1;
        const isGoldDrop = bag.gold > 0 && !bag.itemId;
        let txt = '';
        if (isGoldDrop) {
          txt = bag.gold > 1 ? `${bag.gold}` : '';
        } else if (!isItemDrop) {
          txt = `${bag.gold > 0 ? `${bag.gold}◈` : ''}${bag.itemCount ? ` ${bag.itemCount}▣` : ''}` || 'Bolsa';
        }
        view.label.setText(txt);
      }
      return view;
    }
    const shadow = this.add.ellipse(0, 5, 20, 7, 0x000000, 0.3);
    let textureKey = 'bag';
    if (bag.gold > 0 && !bag.itemId) {
      textureKey = 'gold_coin';
      if (!this.textures.exists(textureKey)) {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        // pila de monedas doradas
        const drawCoin = (x, y, r) => {
          ctx.fillStyle = '#b8860b';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffd700';
          ctx.beginPath(); ctx.arc(x - 1, y - 1, r - 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff3a0';
          ctx.beginPath(); ctx.arc(x - 2, y - 2, r - 4, 0, Math.PI * 2); ctx.fill();
        };
        if (bag.gold > 5) {
          drawCoin(12, 22, 8);
          drawCoin(20, 18, 8);
          drawCoin(16, 14, 8);
        } else {
          drawCoin(16, 18, 9);
        }
        this.textures.addCanvas(textureKey, c);
      }
    } else if (bag.itemId && !bag.gold && (bag.itemCount ?? 1) === 1) {
      const def = ITEMS[bag.itemId];
      if (def) {
        textureKey = `item_${bag.itemId}`;
        if (!this.textures.exists(textureKey)) {
          const canvas = document.createElement('canvas');
          drawItemIcon(canvas, def, 32);
          this.textures.addCanvas(textureKey, canvas);
        }
      }
    }
    const sprite = this.add.image(0, 0, textureKey).setOrigin(0.5, 1);
    const isItemDrop = !!bag.itemId && !bag.gold && (bag.itemCount ?? 1) === 1;
    const isGoldDrop = bag.gold > 0 && !bag.itemId;
    const labelText = isItemDrop ? '' : (isGoldDrop ? (bag.gold > 1 ? `${bag.gold}` : '') : (bag.gold > 0 ? `${bag.gold}◈${bag.itemCount ? ` ${bag.itemCount}▣` : ''}` : 'Bolsa'));
    const label = this.add.text(0, -27, labelText, {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '8px', color: '#ffe08a',
      stroke: '#05070a', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    const container = this.add.container(toWorld(bag.x), toWorld(bag.y), [shadow, sprite, label]);
    container.setDepth(60 + bag.y);
    this.tweens.add({ targets: sprite, y: -3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    view = { container, sprite, label, data: bag };
    this.bagViews.set(bag.id, view);
    // Temporizador de respaldo de expiracion segun vida del servidor.
    if (bag.expiresAt) {
      const delay = Math.max(0, Number(bag.expiresAt) - Date.now());
      setTimeout(() => {
        const v = this.bagViews.get(bag.id);
        if (v) { v.container.destroy(true); this.bagViews.delete(bag.id); }
        store.bags.delete(bag.id);
      }, delay);
    }
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
    // Contador estable de FPS (actualiza cada 500 ms).
    this._fpsFrames += 1;
    const perfNow = performance.now();
    if (!this._fpsLast) this._fpsLast = perfNow;
    if (perfNow - this._fpsLast >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / (perfNow - this._fpsLast));
      this._fpsFrames = 0;
      this._fpsLast = perfNow;
      uiBus.emit('fps', this.fps);
    }
    if (!store.authenticated) return;

    this.handleMovementInput(now);
    this.updatePendingAction();

    // Reconciliacion gradual activa (100-150 ms) hacia posicion autoritativa.
    if (this.reconcile) {
      const r = this.reconcile;
      const t = Math.min(1, (Date.now() - r.start) / r.duration);
      this.localPred.x = r.fromX + (r.toX - r.fromX) * t;
      this.localPred.y = r.fromY + (r.toY - r.fromY) * t;
      if (t >= 1) this.reconcile = null;
    }

    // Predicción local suave
    const smooth = 1 - Math.pow(0.002, Math.min(delta, 50) / 1000);
    this.localVisual.x += (this.localPred.x - this.localVisual.x) * smooth;
    this.localVisual.y += (this.localPred.y - this.localVisual.y) * smooth;
    const lx = toWorld(this.localVisual.x);
    const ly = toWorld(this.localVisual.y);
    this.localContainer.setPosition(lx, ly);
    // Y-sorting: profundidad basada en la posición inferior (pies) de la entidad.
    this.localContainer.setDepth(toWorld(this.localVisual.y) + (this.localSprite?.displayHeight ?? 0) / 2);
    this.localMoving = Math.hypot(this.localPred.x - this.localVisual.x, this.localPred.y - this.localVisual.y) > 0.05
      || (this.joystick?.active && this.joystick.dir && now < this.nextStepAt + this.moveMs);
    const localBreathPhase = Math.sin(performance.now() * 0.0032);
    const localBreathOffset = this.localMoving ? 0 : (localBreathPhase * 1.2);
    this.localSprite.y = 2 - (this.localMoving ? Math.abs(Math.sin(now / 120)) * 1.8 : 0) - localBreathOffset;
    if (this.localShadow) this.localShadow.scaleX = 1 + (this.localMoving ? 0 : (localBreathPhase * 0.02));
    this.updateLocalOverhead();

    // Interpolación de entidades remotas hacia serverX/serverY con deltaTime.
    const remoteSmooth = 1 - Math.pow(0.001, Math.min(delta, 50) / 1000);
    for (const view of this.entityViews.values()) {
      if (!Number.isFinite(view.serverX)) view.serverX = view.container.x;
      if (!Number.isFinite(view.serverY)) view.serverY = view.container.y;
      view.container.x += (view.serverX - view.container.x) * remoteSmooth;
      view.container.y += (view.serverY - view.container.y) * remoteSmooth;
      const moved = Math.hypot(view.container.x - view.lastX, view.container.y - view.lastY) > 0.15;
      view.moving = moved;
      view.lastX = view.container.x; view.lastY = view.container.y;
      // Y-sorting: mayor Y (pies más abajo) se dibuja delante.
      view.container.setDepth(view.container.y + (view.displayHeight ?? 0) * 0.5);
      const breathSeed = (view.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 0.37;
      const remoteBreathPhase = Math.sin((performance.now() + breathSeed) * 0.0032);
      const remoteBreathOffset = moved ? 0 : (remoteBreathPhase * 1.2);
      view.sprite.y = 2 - (moved ? Math.abs(Math.sin(now / 110 + view.id.length)) * 1.6 : 0) - remoteBreathOffset;
      if (view.shadow) view.shadow.scaleX = 1 + (moved ? 0 : (remoteBreathPhase * 0.02));
    }

    // Proyectiles de arena (mobs a distancia)
    const pg = this.projectileGraphics;
    if (pg) {
      pg.clear();
      const nowMs = Date.now();
      for (let i = this.activeProjectiles.length - 1; i >= 0; i -= 1) {
        const p = this.activeProjectiles[i];
        const elapsed = nowMs - p.start;
        const t = Math.min(1, elapsed / p.travelMs);
        // Interpolar hacia posicion actual del objetivo si es el jugador local.
        let toX = p.toX, toY = p.toY;
        if (p.targetId === store.player?.id && store.self) {
          toX = store.self.x; toY = store.self.y;
        }
        const x = Phaser.Math.Linear(p.fromX, toX, t);
        const y = Phaser.Math.Linear(p.fromY, toY, t);
        // Actualizar destino final para impacto
        p.curX = x; p.curY = y;
        if (t >= 1) {
          // Impacto: 6 particulas de polvo
          for (let k = 0; k < 6; k += 1) {
            const ang = (Math.PI * 2 * k) / 6;
            this.impactEffects.push({
              x: toX * TILE_SIZE, y: toY * TILE_SIZE,
              vx: Math.cos(ang) * 40, vy: Math.sin(ang) * 40 - 20,
              start: nowMs, life: 300,
            });
          }
          this.activeProjectiles.splice(i, 1);
          continue;
        }
        // Estela
        for (let k = 1; k <= 4; k += 1) {
          const tt = Math.max(0, t - k * 0.05);
          const tx = Phaser.Math.Linear(p.fromX, toX, tt) * TILE_SIZE;
          const ty = Phaser.Math.Linear(p.fromY, toY, tt) * TILE_SIZE;
          pg.fillStyle(0xb8863b, 0.4 - k * 0.08);
          pg.fillCircle(tx, ty, 2);
        }
        // Proyectil principal
        pg.fillStyle(0xf0d399, 1);
        pg.fillCircle(x * TILE_SIZE, y * TILE_SIZE, 4);
        pg.fillStyle(0xd4a359, 1);
        pg.fillCircle(x * TILE_SIZE - 1, y * TILE_SIZE - 1, 2);
        pg.fillStyle(0xb8863b, 1);
        pg.fillCircle(x * TILE_SIZE + 1, y * TILE_SIZE + 1, 1);
      }
      // Impact effects
      for (let i = this.impactEffects.length - 1; i >= 0; i -= 1) {
        const e = this.impactEffects[i];
        const age = nowMs - e.start;
        if (age >= e.life) { this.impactEffects.splice(i, 1); continue; }
        const alpha = 1 - age / e.life;
        const px = e.x + e.vx * (age / 1000);
        const py = e.y + e.vy * (age / 1000) + 0.5 * 200 * (age / 1000) ** 2;
        pg.fillStyle(0xd4a359, alpha);
        pg.fillCircle(px, py, 3);
        pg.fillStyle(0xf0d399, alpha * 0.7);
        pg.fillCircle(px - 1, py - 1, 1.5);
      }
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

    // El input del jugador tiene prioridad sobre la reconciliacion pendiente.
    if ((this.joystick?.active && this.joystick.dir) || this.pathGoal) this.reconcile = null;

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

    if (this.pathGoal) {
      if (now < this.nextStepAt) return;

      // Actualiza el destino si se persigue una entidad móvil.
      if (this.pending?.type === 'attack') {
        const e = store.entities.get(this.pending.id);
        if (e) this.pathGoal = { x: Math.round(e.x), y: Math.round(e.y) };
      } else if (this.pending?.type === 'bag') {
        const b = store.bags.get(this.pending.id);
        if (b) this.pathGoal = { x: Math.round(b.x), y: Math.round(b.y) };
      } else if (this.pending?.type === 'stall') {
        const s = store.stalls.get(this.pending.id);
        if (s) this.pathGoal = { x: Math.round(s.x), y: Math.round(s.y) };
      } else if (this.pending?.type === 'npc') {
        const n = store.npcs.get(this.pending.id) ?? store.entities.get(this.pending.id);
        if (n) this.pathGoal = { x: Math.round(n.x), y: Math.round(n.y) };
      }

      this.rebuildNav();
      const cx = Math.round(this.localPred.x);
      const cy = Math.round(this.localPred.y);

      // Llegada al destino.
      if (cx === this.pathGoal.x && cy === this.pathGoal.y) {
        this.path = [];
        this.pathGoal = null;
        return;
      }

      // Detección de encierro: las 4 casillas cardinales bloqueadas.
      if (this.isTrapped(cx, cy)) {
        if (!this._trappedToastShown) {
          this._trappedToastShown = true;
          uiBus.emit('toast', { text: 'Encerrado: sin salida', type: 'error' });
        }
        this.path = [];
        this.nextStepAt = now + 120;
        return;
      }
      this._trappedToastShown = false;

      // Re-pathfinding continuo (A*) considerando mobs/jugadores como obstáculos.
      const path = findPath(this.navWorld, cx, cy, this.pathGoal.x, this.pathGoal.y, 5000);
      if (!path.length) {
        this.path = [];
        this.nextStepAt = now + 120;
        return;
      }
      this.path = path;

      const next = this.path[0];
      const dx = Math.sign(next.x - cx);
      const dy = Math.sign(next.y - cy);
      if (dx === 0 && dy === 0) {
        this.path.shift();
        this.nextStepAt = now + 20;
        return;
      }
      if (Math.abs(next.x - this.localPred.x) > 1.5 || Math.abs(next.y - this.localPred.y) > 1.5) {
        this.recomputePath();
        return;
      }
      if (!this.clientCanWalk(cx + dx, cy + dy, dx, dy)) {
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

  isTrapped(x, y) {
    if (!this.navWorld) return false;
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    return dirs.every(([dx, dy]) => !isWalkable(this.navWorld, x + dx, y + dy));
  }

  recomputePath() {
    this.path = [];
    const goal = this.pathGoal;
    if (!goal) return;
    this.rebuildNav();
    const start = { x: Math.round(this.localPred.x), y: Math.round(this.localPred.y) };
    const path = findPath(this.navWorld, start.x, start.y, goal.x, goal.y, 5000);
    if (path.length) {
      this.path = path;
      this.nextStepAt = Date.now() + this.moveMs + 60;
    } else {
      // Mantiene el destino activo para reanudar cuando se libere una casilla.
      this.nextStepAt = Date.now() + 120;
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

    this.hidePartyMenu();
    if (picked?.type === 'entity') {
      const e = picked.view.data;
      if (!e) return;
      if (e.kind === ENTITY_KIND.PLAYER && e.id !== store.player?.id) {
        this.showInteractionPanel(picked.view, e);
        return;
      }
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

    // Tala de arboles: solo si el tile es arbol y NO es un tocón (stump).
    const treeTileX = Math.floor(wx);
    const treeTileY = Math.floor(wy);
    const treeTile = tileAt(this.worldMap, treeTileX, treeTileY);
    const isTreeTile = [TILE.TREE, TILE.TREE_PALM, TILE.TREE_PINE, TILE.TREE_ACACIA, TILE.TREE_DEAD].includes(treeTile);
    const stumpKey = `${treeTileX},${treeTileY}`;
    if (isTreeTile && !this.stumpViews.has(stumpKey)) {
      const p = this.localPred;
      const dist = Math.hypot(treeTileX + 0.5 - p.x, treeTileY + 0.5 - p.y);
      if (dist <= 2.0) {
        socket.send('chop_tree', { id: stumpKey });
      } else {
        this.moveToInteract({ x: treeTileX, y: treeTileY }, { type: 'chop', x: treeTileX, y: treeTileY, range: 1.8 });
      }
      return;
    }
    // Si es tocón, caer a movimiento normal (tile transitable).

    // Throttle de toques repetidos al suelo (60-80 ms).
    const nowTap = Date.now();
    if (nowTap - this.lastGroundTap < 70) return;
    this.lastGroundTap = nowTap;

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
      // Silenciado: no mostrar toast redundante de ruta.
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
    const ex = Math.round(e.x);
    const ey = Math.round(e.y);
    const candidates = [];
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const x = ex + ox;
        const y = ey + oy;
        if (isWalkable(this.navWorld, x, y)) candidates.push({ x, y });
      }
    }
    if (isWalkable(this.navWorld, ex, ey)) candidates.push({ x: ex, y: ey });

    let best = null;
    let bestLen = Infinity;
    for (const c of candidates) {
      const path = findPath(this.navWorld, Math.round(p.x), Math.round(p.y), c.x, c.y, 5000);
      if (path.length && path.length < bestLen) { bestLen = path.length; best = { path, goal: c }; }
    }
    if (!best) {
      uiBus.emit('toast', { text: 'No puedes alcanzar al objetivo', type: 'error' });
      return;
    }
    this.path = best.path;
    this.pathGoal = best.goal;
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
    this.rebuildNav();
  }

  addStump(x, y, key) {
    if (this.stumpViews.has(key)) return;
    const tile = tileAt(this.worldMap, x, y);
    const texKey = tile === TILE.SAND ? 'palm_stump' : 'tree_stump';
    // Marca el tile como talado y regenera el chunk para quitar el árbol original.
    this.worldMap.chopped.add(`${x},${y}`);
    const chunkSize = 64;
    regenerateWorldChunk(this, this.worldMap, Math.floor(x / chunkSize), Math.floor(y / chunkSize));
    const sprite = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, texKey)
      .setOrigin(0.5, 0.5).setDepth(-50);
    this.stumpViews.set(key, { container: null, sprite, cover: null });
  }

  removeStump(key) {
    const view = this.stumpViews.get(key);
    if (view) {
      if (view.sprite) view.sprite.destroy();
      this.stumpViews.delete(key);
    }
    const [sx, sy] = String(key).split(',').map((v) => Number.parseInt(v, 10));
    if (Number.isInteger(sx) && Number.isInteger(sy)) {
      this.worldMap.chopped?.delete(`${sx},${sy}`);
      const chunkSize = 64;
      regenerateWorldChunk(this, this.worldMap, Math.floor(sx / chunkSize), Math.floor(sy / chunkSize));
    }
  }

  syncResourceStumps() {
    if (!store.resourceStumps) return;
    for (const key of store.resourceStumps) {
      const [x, y] = key.split(',').map((v) => Number.parseInt(v, 10));
      if (Number.isInteger(x) && Number.isInteger(y)) this.addStump(x, y, key);
    }
    this.rebuildNav();
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

  showPartyMenu(view, entity) {
    this.hidePartyMenu();
    const menu = document.createElement('div');
    menu.className = 'party-menu';
    const btn = document.createElement('button');
    btn.className = 'party-invite-btn';
    btn.textContent = 'Invite to Party';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      socket.send('party_invite', { targetId: entity.id });
      this.hidePartyMenu();
    });
    menu.appendChild(btn);
    document.body.appendChild(menu);
    const pos = this.cameras.main.worldToScreen(view.container.x, view.container.y - 20);
    menu.style.left = `${Math.max(8, pos.x - 60)}px`;
    menu.style.top = `${Math.max(8, pos.y - 40)}px`;
    this.partyMenu = menu;
    setTimeout(() => this.hidePartyMenu(), 6000);
  }

  hidePartyMenu() {
    if (this.partyMenu) {
      this.partyMenu.remove();
      this.partyMenu = null;
    }
  }

  showInteractionPanel(view, entity) {
    this.hidePartyMenu();
    if (this.interactionPanel) this.interactionPanel.remove();
    const menu = document.createElement('div');
    menu.className = 'interaction-panel';
    menu.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:300px;max-width:90vw;background:rgba(10,12,18,.95);border:2px solid #fff;border-radius:8px;padding:12px;z-index:100;color:#fff;font-family:monospace;';
    const level = entity.level ?? 1;
    const cls = entity.classId ?? 'adventurer';
    const className = (CLASSES?.[cls]?.name) ?? cls;
    menu.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:40px;height:40px;background:#333;border:1px solid #888;"></div>
        <div>
          <div style="font-weight:bold;font-size:14px;">${entity.name ?? ''}</div>
          <div style="font-size:11px;color:#aaa;">Lv. ${level}</div>
          <div style="font-size:11px;color:#ffd700;">${className}</div>
        </div>
        <button id="ipClose" style="margin-left:auto;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button data-act="message" style="padding:8px;background:#7b5aa6;border:none;color:#fff;border-radius:4px;cursor:pointer;">Message</button>
        <button data-act="follow" style="padding:8px;background:#3a8a4a;border:none;color:#fff;border-radius:4px;cursor:pointer;">Follow</button>
        <button data-act="trade" style="padding:8px;background:#3a8a4a;border:none;color:#fff;border-radius:4px;cursor:pointer;">Trade</button>
        <button data-act="gift" style="padding:8px;background:#3a6ea8;border:none;color:#fff;border-radius:4px;cursor:pointer;">Gift</button>
        <button data-act="invite" style="padding:8px;background:#c9a227;border:none;color:#000;border-radius:4px;cursor:pointer;">Invite to team</button>
        <button data-act="friend" style="padding:8px;background:#3a8a4a;border:none;color:#fff;border-radius:4px;cursor:pointer;">Add friend</button>
      </div>
    `;
    document.body.appendChild(menu);
    this.interactionPanel = menu;
    menu.querySelector('#ipClose').addEventListener('click', (ev) => { ev.stopPropagation(); this.hideInteractionPanel(); });
    menu.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'message') {
          const text = prompt('Mensaje privado:');
          if (text) socket.send('private_message', { targetId: entity.id, text });
        } else if (act === 'follow') {
          this.followTargetId = entity.id;
          uiBus.emit('toast', { text: 'Siguiendo a ' + entity.name, type: 'good' });
        } else if (act === 'trade') {
          socket.send('trade_request', { targetId: entity.id });
        } else if (act === 'gift') {
          const t = prompt('Regalar oro (número) o itemId:cantidad');
          if (t) socket.send('gift', { targetId: entity.id, payload: t });
        } else if (act === 'invite') {
          socket.send('team_invite', { targetId: entity.id });
        } else if (act === 'friend') {
          socket.send('friend_add', { targetId: entity.id });
        }
        this.hideInteractionPanel();
      });
    });
  }

  hideInteractionPanel() {
    if (this.interactionPanel) {
      this.interactionPanel.remove();
      this.interactionPanel = null;
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
      case 'remove_bag':
      case 'loot_removed':
      case 'loot_expired':
        // El servidor removió la bolsa (timeout, pickup o inexistente).
        // Eliminar el sprite visual de la bolsa silenciosamente.
        const bagId = msg?.bagId ?? msg?.id;
        const bagView = this.bagViews.get(bagId);
        if (bagView) {
          bagView.container.destroy(true);
          this.bagViews.delete(bagId);
        }
        if (bagId != null) store.bags.delete(bagId);
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
      case 'mob_ranged_attack': {
        const proj = {
          mobId: msg.mobId,
          targetId: msg.targetId,
          fromX: Number(msg.fromX), fromY: Number(msg.fromY),
          toX: Number(msg.toX), toY: Number(msg.toY),
          travelMs: Number(msg.travelMs ?? 350),
          start: Date.now(),
          done: false,
        };
        this.activeProjectiles.push(proj);
        // Retroceso/vibracion del castillo.
        const view = this.entityViews.get(msg.mobId);
        if (view?.sprite) {
          this.tweens.add({ targets: view.sprite, x: '+=4', duration: 50, yoyo: true, repeat: 1 });
        }
        break;
      }
      default:
        break;
    }
  }

  handleMoveReject(msg) {
    const sx = Number(msg.x);
    const sy = Number(msg.y);
    this.localPred = { x: sx, y: sy };
    // Bloqueo por colision: ajuste directo.
    this.localVisual = { x: sx, y: sy };
    this.reconcile = null;
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
