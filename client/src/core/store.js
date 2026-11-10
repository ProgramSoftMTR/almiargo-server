import { CLASSES, EQUIP_SLOTS, ITEMS, decodeEntity, decodeSelf } from '@almiargo/shared';
import { Emitter } from './emitter.js';

/**
 * Estado del cliente: únicamente datos recibidos del servidor.
 * Nunca se modifica el inventario/oro localmente como fuente de verdad.
 */
class ClientStore extends Emitter {
  constructor() {
    super();
    this.connected = false;
    this.authenticated = false;
    this.player = null;
    this.self = null;
    this.world = null;
    this.catalog = ITEMS;
    this.serverConfig = null;
    this.classes = CLASSES;
    this.entities = new Map();
    this.bags = new Map();
    this.stalls = new Map();
    this.npcs = new Map();
    this.chatLog = [];
    this.zone = 'Ciudad';
    this.latency = 0;
    this.online = 1;
    this.monsters = {};
    this.token = localStorage.getItem('rucoy.token') || null;
    this.resourceStumps = new Set();
  }

  setAuth(msg) {
    this.authenticated = true;
    this.connected = true;
    this.player = msg.player;
    this.world = msg.world;
    this.catalog = msg.catalog ?? ITEMS;
    this.serverConfig = msg.config ?? null;
    this.classes = msg.config?.classes ?? CLASSES;
    this.monsters = msg.monsters ?? {};
    this.npcs.clear();
    for (const npc of msg.npcs ?? []) this.npcs.set(npc.id, { ...npc, kind: 2 });
    this.token = msg.token ?? this.token;
    this.emit('auth', msg);
  }

  applySnapshot(msg) {
    // El servidor usa claves cortas (self array, e/b/s/o). Normalizamos aquí
    // una sola vez para que el resto del cliente siga usando nombres legibles.
    const self = decodeSelf(msg.self);
    msg.self = self;
    msg.ents = msg.e ?? msg.ents ?? [];
    msg.bags = msg.b ?? msg.bags ?? [];
    msg.stalls = msg.s ?? msg.stalls ?? [];
    const online = msg.o ?? msg.online;
    if (typeof online === 'number') this.online = online;
    msg.online = this.online;

    this.self = self;
    if (this.player) {
      this.player.x = self.x;
      this.player.y = self.y;
      this.player.hp = self.hp;
      this.player.mp = self.mp;
      this.player.maxHp = self.maxHp;
      this.player.maxMp = self.maxMp;
      this.player.level = self.level;
      this.player.xp = self.xp;
      this.player.xpNext = self.xpNext;
      this.player.gold = self.gold;
      this.player.classId = self.classId;
      this.player.skull = self.skull;
      this.player.inStall = self.inStall;
      this.player.targetId = self.targetId;
      this.player.stats = { ...(this.player.stats ?? {}), moveMs: self.moveMs };
    }

    const seen = new Set();
    for (const raw of msg.ents) {
      const e = decodeEntity(raw);
      const existing = this.entities.get(e.id);
      if (existing && existing.kind !== e.kind) this.entities.delete(e.id);
      this.entities.set(e.id, e);
      seen.add(e.id);
    }
    for (const id of this.entities.keys()) {
      if (!seen.has(id) && !this.npcs.has(id)) this.entities.delete(id);
    }

    this.bags.clear();
    for (const bag of msg.bags) {
      this.bags.set(bag.i, {
        id: bag.i, x: bag.x, y: bag.y, ownerId: bag.o, gold: bag.g,
        itemCount: bag.n, freeAt: bag.f, expiresAt: bag.t,
      });
    }
    this.stalls.clear();
    for (const stall of msg.stalls) {
      this.stalls.set(stall.i, {
        id: stall.i, x: stall.x, y: stall.y, ownerName: stall.n,
        itemCount: stall.c, online: stall.on,
      });
    }

    this.emit('snapshot', msg);
  }

  applyProfile(player) {
    if (!player) return;
    this.player = player;
    if (this.self) {
      this.self.hp = player.hp;
      this.self.mp = player.mp;
      this.self.maxHp = player.maxHp;
      this.self.maxMp = player.maxMp;
      this.self.gold = player.gold;
      this.self.xp = player.xp;
      this.self.xpNext = player.xpNext;
      this.self.level = player.level;
      this.self.classId = player.classId;
      this.self.skull = player.skull;
      this.self.inStall = player.inStall;
      this.self.x = player.x;
      this.self.y = player.y;
      this.self.moveMs = player.stats?.moveMs ?? this.self.moveMs;
      if (player.outfit) this.player.outfit = player.outfit;
    }
    this.emit('profile', player);
  }

  applyEvent(msg) {
    if (msg.event === 'resource_states') {
      this.resourceStumps.clear();
      for (const r of msg.resources ?? []) {
        if (r?.state === 'stump' && Number.isInteger(r.x) && Number.isInteger(r.y)) this.resourceStumps.add(`${r.x},${r.y}`);
      }
    }
    if (msg.event === 'update_resource' && Number.isInteger(msg.x) && Number.isInteger(msg.y)) {
      const key = `${msg.x},${msg.y}`;
      if (msg.state === 'stump') this.resourceStumps.add(key);
      else this.resourceStumps.delete(key);
    }
    if (msg.event === 'profile' && msg.player) this.applyProfile(msg.player);
    if (msg.event === 'target_clear' && this.self) this.self.targetId = null;
    this.emit('game-event', msg);
  }

  pushChat(msg) {
    this.chatLog.push(msg);
    if (this.chatLog.length > 120) this.chatLog.shift();
    this.emit('chat', msg);
  }

  get target() {
    const id = this.self?.targetId;
    return id ? this.entities.get(id) ?? null : null;
  }

  get inSafeZone() {
    const p = this.player;
    const z = this.world?.zones?.safe;
    if (!p || !z) return false;
    return p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2;
  }

  get classDef() {
    return this.classes[this.player?.classId] ?? CLASSES.knight;
  }

  itemByUid(uid) {
    return this.player?.inventory?.find((it) => it?.uid === uid) ?? null;
  }

  findPotion(kind) {
    const id = kind === 'hp' ? 'potion_hp' : 'potion_mp';
    return this.player?.inventory?.find((it) => it?.itemId === id) ?? null;
  }

  get skillSummary() {
    return this.player?.skills ?? {};
  }
}

export const store = new ClientStore();
