import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  CLASSES,
  CONSTANTS,
  ITEMS,
  MAX_CHAT_PER_10S,
  MAX_MESSAGES_PER_SECOND,
  MONSTERS,
  NPCS,
  SPAWN_POINT,
  TILE,
  ZONES,
  addItem,
  hasSpaceFor,
  tileAt,
  encodeSelf,
  isPvPZone,
  isSafeZone,
} from '../../shared/index.js';
import {
  CHARACTER_NAME_RE,
  EMAIL_RE,
  normalizeEmail,
  signToken,
  verifyToken,
} from '../auth.js';
import { GoogleTokenVerifier, OAuthError } from '../googleAuth.js';
import { AppleTokenVerifier } from '../appleAuth.js';
import { ADMIN_CHARACTER_NAME, ADMIN_NAME_COLOR, normalizeAdminEmails } from '../admin.js';
import { executeAdminAction, adminState } from '../game/admin.js';
import { World } from '../game/world.js';
import { ResourceManager } from '../game/resourceManager.js';
import { PlayerState, createCharacterState } from '../game/player.js';
import { updateMonsters } from '../game/ai.js';
import {
  handleAttackIntent,
  performPlayerAttack,
  performSpecial,
  respawnPlayer,
} from '../game/combat.js';
import { handleChat } from '../game/chat.js';
import {
  buyStallListing,
  closeStall,
  npcBuy,
  npcSell,
  openStall,
  shopPayload,
} from '../game/economy.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * Servidor autoritativo. Todo el estado del juego vive aquí; el cliente sólo
 * envía intenciones (mover, atacar, comprar) y pinta snapshots.
 */
export class GameServer {
  constructor({ store, config, seed = undefined, googleAuth = null, appleAuth = null }) {
    this.store = store;
    this.config = config;
    this.world = new World({ seed });
    this.resources = new ResourceManager({
      world: this.world,
      onRegrow: (x, y) => this.broadcastResource(x, y, 'alive'),
    });
    this.sessions = new Map();
    this.sessionsByPlayer = new Map();
    this.sessionsByAccount = new Map();
    // La autenticación es exclusivamente por WebSocket: el primer payload
    // incluye el ID token de Google/Apple y aquí se valida contra el proveedor.
    this.googleAuth = googleAuth ?? new GoogleTokenVerifier({ clientIds: config.googleClientIds });
    this.appleAuth = appleAuth ?? new AppleTokenVerifier({ clientIds: config.appleClientIds });
    // Correos con privilegios, resueltos desde el token OAuth verificado.
    this.adminEmails = new Set(normalizeAdminEmails(config.adminEmails));
    this.saveChains = new Map();
    this.tickCount = 0;
    this.lastTickAt = 0;
    this.lastTickMs = 0;
    this.maxTickMs = 0;
    this.tickLagMs = 0;
    this.startedAt = 0;
    this.httpServer = null;
    this.wss = null;
    this.timers = [];
    this.port = config.port;
    this.stopping = false;
  }

  // ── Ciclo de vida ────────────────────────────────────────────
  async start() {
    this.world.spawnInitialMonsters(Date.now());
    await this.loadOfflineStalls();
    this.httpServer = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((err) => {
        console.error('[http] error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ ok: false, message: 'Error interno del servidor' }));
      });
    });
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: CONSTANTS.MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      clientTracking: false,
    });
    this.wss.on('connection', (socket, req) => this.handleConnection(socket, req));
    this.httpServer.on('upgrade', (req, socket, head) => {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* ignore */ }
      if (pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });

    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.port = this.httpServer.address().port;
        resolve();
      });
    });

    if (!this.googleAuth.configured) {
      console.warn('[auth] GOOGLE_CLIENT_ID no configurado: los inicios de sesión con Google serán rechazados.');
    }
    if (!this.appleAuth.configured) {
      console.warn('[auth] APPLE_CLIENT_ID no configurado: Sign in with Apple será rechazado.');
    }

    this.startedAt = Date.now();
    this.timers.push(setInterval(() => this.tick(), this.config.tickMs));
    this.timers.push(setInterval(() => this.saveAll(), CONSTANTS.SAVE_INTERVAL_MS));
    this.timers.push(setInterval(() => this.heartbeat(), 30000));
    console.log(`[server] escuchando en ws://${this.config.host}:${this.port}/ws · tick ${this.config.tickRate}Hz · ${this.world.monsters.size} monstruos`);
    return this;
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.resources?.clear();
    for (const session of [...this.sessions.values()]) {
      try { session.socket.close(1001, 'Servidor apagándose'); } catch { /* ignore */ }
      await this.closeSession(session, { save: true });
    }
    await this.saveAll(true);
    await new Promise((resolve) => this.wss?.close(() => resolve()));
    await new Promise((resolve) => this.httpServer?.close(() => resolve()));
    await this.store.close?.();
  }

  // ── HTTP: salud + cliente web estático (la autenticación es sólo WS) ─
  async handleHttp(req, res) {
    let pathname = '/';
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { /* ignore */ }

    if (pathname === '/health' || pathname === '/api/health') {
      const body = JSON.stringify({
        ok: true,
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
        players: this.sessionsByPlayer.size,
        monsters: [...this.world.monsters.values()].filter((m) => m.alive).length,
        tick: this.tickCount,
        tickRate: this.config.tickRate,
        tickMs: this.lastTickMs,
        maxTickMs: this.maxTickMs,
        tickLagMs: this.tickLagMs,
        entities: this.world.entities.size,
        interest: `${this.config.viewHalfW ?? 18}x${this.config.viewHalfH ?? 11}`,
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }

    if (pathname.startsWith('/api/')) {
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: false, message: 'La autenticación es sólo por WebSocket' }));
      return;
    }

    const dist = this.config.clientDist;
    if (!fs.existsSync(dist)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Almiargo Online server running. WebSocket: /ws · Health: /health');
      return;
    }

    let filePath = path.normalize(path.join(dist, pathname === '/' ? 'index.html' : pathname));
    if (!filePath.startsWith(dist)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dist, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=604800',
    });
    fs.createReadStream(filePath).on('error', () => res.end()).pipe(res);
  }

  // ── Red / sesiones ───────────────────────────────────────────
  handleConnection(socket, req) {
    if (this.sessionsByPlayer.size >= this.config.maxPlayers) {
      socket.close(1013, 'Servidor lleno');
      return;
    }
    const session = {
      id: crypto.randomUUID(),
      socket,
      ip: req.socket.remoteAddress,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      authed: false,
      authing: false,
      authAttempts: 0,
      player: null,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      alive: true,
      msgWindowStart: Date.now(),
      msgCount: 0,
      chatTimes: [],
      closed: false,
    };
    this.sessions.set(session.id, session);
    // Visibilidad para depurar el login desde el teléfono: la IP del cliente
    // aparece aquí antes de cualquier intento de autenticación.
    console.log(`[net] conexión desde ${session.ip}`);

    socket.on('message', (data) => {
      this.handleMessage(session, data).catch((err) => {
        console.error('[ws] error de mensaje:', err);
        this.sendError(session, 'Error interno del servidor');
      });
    });
    socket.on('pong', () => { session.alive = true; });
    socket.on('close', () => { this.closeSession(session).catch((err) => console.error('[ws] close:', err)); });
    socket.on('error', () => { /* close se encarga */ });

    this.send(session, {
      type: 'hello',
      serverTime: Date.now(),
      tickRate: this.config.tickRate,
      snapshotRate: this.config.snapshotRate,
    });
  }

  send(session, payload) {
    const socket = session?.socket;
    if (!socket || socket.readyState !== 1) return false;
    if (socket.bufferedAmount > 512 * 1024 && payload.type === 'snapshot') return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  sendError(session, message) {
    this.send(session, { type: 'event', event: 'error', message });
  }

  sendEvent(player, event, data = {}) {
    const session = this.sessionsByPlayer.get(player?.id);
    if (!session) return;
    this.send(session, { type: 'event', event, ...data });
  }

  sendProfile(player) {
    this.sendEvent(player, 'profile', { player: player.toProfile() });
  }

  broadcastNear(x, y, radius, payload, exceptPlayerId = null) {
    const { type: event, ...rest } = payload;
    const r2 = radius * radius;
    // Usa el indice espacial en lugar de recorrer todas las sesiones: solo
    // reciben el evento los jugadores del mismo sector/viewport.
    const nearby = this.world.entityIndex.queryCircle(
      x,
      y,
      radius,
      (entity) => entity.kind === 0 && entity.id !== exceptPlayerId,
    );
    for (const p of nearby) {
      if (p.x < x - radius || p.x > x + radius) continue;
      if (p.y < y - radius || p.y > y + radius) continue;
      if ((p.x - x) ** 2 + (p.y - y) ** 2 > r2) continue;
      const session = this.sessionsByPlayer.get(p.id);
      if (session) this.send(session, { type: 'event', event, ...rest });
    }
  }

  sendChat(session, payload) {
    this.send(session, { type: 'chat', ...payload });
  }

  sendChatToPlayer(player, payload) {
    const session = this.sessionsByPlayer.get(player.id);
    if (session) this.sendChat(session, payload);
  }

  broadcastAllChat(payload) {
    for (const session of this.sessionsByPlayer.values()) this.sendChat(session, payload);
  }

  broadcastLocalChat(x, y, radius, payload) {
    const r2 = radius * radius;
    for (const session of this.sessionsByPlayer.values()) {
      const p = session.player;
      if (!p) continue;
      if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) this.sendChat(session, payload);
    }
  }

  broadcastClanChat(clan, payload) {
    for (const session of this.sessionsByPlayer.values()) {
      if (session.player?.clan === clan) this.sendChat(session, payload);
    }
  }

  findPlayerByName(name) {
    const needle = String(name ?? '').toLowerCase();
    for (const player of this.world.players.values()) {
      if (player.name.toLowerCase() === needle) return player;
    }
    return null;
  }

  // ── Autenticación ────────────────────────────────────────────
  async handleMessage(session, raw) {
    if (session.closed) return;
    const now = Date.now();
    session.lastSeen = now;

    if (now - session.msgWindowStart >= 1000) {
      session.msgWindowStart = now;
      session.msgCount = 0;
    }
    session.msgCount += 1;
    if (session.msgCount > MAX_MESSAGES_PER_SECOND) {
      if (session.msgCount === MAX_MESSAGES_PER_SECOND + 1) this.sendError(session, 'Demasiadas acciones');
      return;
    }

    let msg;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (text.length > CONSTANTS.MAX_MESSAGE_BYTES) return;
      msg = JSON.parse(text);
    } catch {
      this.sendError(session, 'Mensaje inválido');
      return;
    }
    if (Array.isArray(msg)) msg = this.decodeCompactMessage(msg);
    if (!msg || typeof msg.type !== 'string') return;

    if (!session.authed && msg.type !== 'auth') {
      this.sendError(session, 'Debes autenticarte');
      return;
    }

    switch (msg.type) {
      case 'auth': await this.handleAuth(session, msg); break;
      case 'create_character': await this.handleCreateCharacter(session, msg); break;
      case 'move': this.handleMove(session, msg); break;
      case 'stop': if (session.player) { session.player.targetId = null; this.sendEvent(session.player, 'target_clear', {}); } break;
      case 'target': this.handleTarget(session, msg); break;
      case 'attack': this.handleAttack(session, msg); break;
      case 'special': this.handleSpecial(session); break;
      case 'use_item': this.handleUseItem(session, msg); break;
      case 'equip': this.handleEquip(session, msg); break;
      case 'unequip': this.handleUnequip(session, msg); break;
      case 'chop_tree': await this.handleChopTree(session, msg); break;
      case 'set_outfit': await this.handleSetOutfit(session, msg); break;
      case 'drop': await this.handleDrop(session, msg); break;
      case 'pickup': await this.handlePickup(session, msg); break;
      case 'chat': this.handleChatMessage(session, msg); break;
      case 'shop_open': this.handleShopOpen(session, msg); break;
      case 'shop_buy': await this.handleShopBuy(session, msg); break;
      case 'shop_sell': await this.handleShopSell(session, msg); break;
      case 'stall_open': await this.handleStallOpen(session, msg); break;
      case 'stall_close': await this.handleStallClose(session); break;
      case 'stall_view': this.handleStallView(session, msg); break;
      case 'stall_buy': await this.handleStallBuy(session, msg); break;
      case 'admin_action': this.handleAdminAction(session, msg); break;
      case 'ping': this.send(session, { type: 'pong', t: msg.t ?? 0, serverTime: Date.now() }); break;
      default: this.sendError(session, 'Acción desconocida');
    }
  }

  /**
   * Mensajes cortos para el trafico mas frecuente. Ejemplos:
   *   [1, dx, dy, seq]  -> mover
   *   [2, timestamp]    -> ping
   * El resto de acciones sigue usando objetos JSON legibles.
   */
  decodeCompactMessage(arr) {
    switch (arr[0]) {
      case 1:
        return {
          type: 'move',
          dir: [Number(arr[1]), Number(arr[2])],
          seq: Number(arr[3]) || 0,
        };
      case 2:
        return { type: 'ping', t: Number(arr[1]) || 0 };
      default:
        return null;
    }
  }

  async handleAuth(session, msg) {
    if (session.authed || session.authing) return;
    session.authing = true;
    session.authAttempts += 1;
    if (session.authAttempts > 8) {
      this.send(session, { type: 'auth_error', message: 'Demasiados intentos' });
      session.socket.close(4003, 'Demasiados intentos');
      session.authing = false;
      return;
    }

    try {
      const provider = String(msg.provider ?? 'session').toLowerCase();
      if (provider === 'google') {
        console.log(`[auth] intento Google desde ${session.ip}`);
      }
      let payload = null;
      let account = null;

      if (provider === 'google' || provider === 'apple') {
        // El primer payload del WebSocket trae el ID token del proveedor.
        const identity = provider === 'google'
          ? await this.googleAuth.verify(msg.token)
          : await this.appleAuth.verify(msg.token);
        account = await this.resolveOAuthAccount(identity);
        session.authProvider = provider;
      } else {
        // Token de sesión interno para reconexiones automáticas tras un corte.
        payload = verifyToken(String(msg.token ?? ''), this.config.jwtSecret);
        if (!payload) {
          this.send(session, { type: 'auth_error', message: 'Sesión expirada' });
          return;
        }
        account = await this.resolveAccountFromToken(payload);
        if (!account) {
          this.send(session, { type: 'auth_error', message: 'Cuenta no encontrada' });
          return;
        }
      }

      let character = payload?.characterId
        ? await this.store.loadCharacter(payload.characterId)
        : null;
      if (!character) character = await this.store.getCharacterByAccount(account.id);
      await this.store.touchLogin(account.id);

      // Una cuenta = una sesión. La conexión nueva toma el control y la
      // anterior recibe un aviso explicito antes de cerrarse.
      await this.claimAccountSession(session, account);

      session.authed = true;
      session.accountId = account.id;
      session.email = account.email;
      this.sessionsByAccount.set(account.id, session);

      if (!character) {
        this.send(session, {
          type: 'auth_ok',
          needsCharacter: true,
          provider: session.authProvider ?? 'session',
          token: this.issueToken(account, null),
          account: { id: account.id, email: account.email },
          admin: this.isAdminAccount(account),
          online: this.sessionsByPlayer.size,
        });
        return;
      }

      await this.attachPlayer(session, account, character);
    } catch (err) {
      if (err?.public) {
        // La causa interna (por ejemplo, audience incorrecta) sólo va al log
        // del servidor; el cliente recibe un mensaje seguro y visible.
        // Se redactan JWTs y se trunca para no volcar credenciales al log.
        const causeText = String(err.cause?.message ?? '')
          .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '<jwt>')
          .slice(0, 240);
        const cause = causeText ? ` | causa: ${causeText}` : '';
        console.warn(
          `[auth] fallo provider=${String(msg.provider ?? 'session')} desde ${session.ip}: `
          + `${err.message}${cause}`,
        );
        this.send(session, { type: 'auth_error', message: err.message });
        return;
      }
      console.error('[auth] error:', err);
      this.send(session, { type: 'auth_error', message: 'No se pudo iniciar sesión' });
    } finally {
      session.authing = false;
    }
  }

  async resolveOAuthAccount(identity) {
    const email = normalizeEmail(identity?.email);
    if (!EMAIL_RE.test(email)) {
      throw new OAuthError('El proveedor no devolvió un correo válido');
    }

    // UID del proveedor (Google sub / Apple sub): clave primaria del documento
    // en Firestore; el correo se usa como respaldo de busqueda.
    const uid = identity?.subject ? String(identity.subject) : null;

    let account = await this.store.getAccountByEmail(email, { uid });
    if (!account) {
      try {
        account = await this.store.createAccount({ email, username: email, passwordHash: '', uid });
      } catch (err) {
        // Otra conexión pudo crear la misma cuenta entre la lectura y la escritura.
        account = await this.store.getAccountByEmail(email, { uid });
        if (!account) throw err;
      }
    }
    if (!account) throw new OAuthError('No se pudo crear la cuenta');
    return account;
  }

  /** ¿La cuenta pertenece a la lista de administradores? Correo ya verificado. */
  isAdminAccount(account) {
    const email = normalizeEmail(account?.email ?? '');
    return Boolean(email) && this.adminEmails.has(email);
  }

  /**
   * Garantiza que un personaje administrador tenga sus privilegios y su color
   * aunque el guardado sea anterior a esta función. Devuelve true si cambió algo.
   */
  syncAdminFlags(player, isAdmin) {
    if (!isAdmin) return false;
    let changed = false;
    if (player.isAdmin !== true) {
      player.isAdmin = true;
      changed = true;
    }
    if (player.nameColor !== ADMIN_NAME_COLOR) {
      player.nameColor = ADMIN_NAME_COLOR;
      changed = true;
    }
    return changed;
  }

  async resolveAccountFromToken(payload) {
    if (!payload) return null;
    if (payload.email && this.store.getAccountByEmail) {
      const byEmail = await this.store.getAccountByEmail(payload.email);
      if (byEmail) return byEmail;
    }
    if (payload.accountId && this.store.getAccountById) {
      const byId = await this.store.getAccountById(payload.accountId);
      if (byId) return byId;
    }
    if (payload.characterId && this.store.getAccountById) {
      const character = await this.store.loadCharacter(payload.characterId);
      if (character?.accountId) return this.store.getAccountById(character.accountId);
    }
    return null;
  }

  issueToken(account, character) {
    return signToken(
      {
        accountId: account.id,
        characterId: character?.id ?? null,
        email: account.email,
      },
      this.config.jwtSecret,
      this.config.tokenTtlMs,
    );
  }

  async claimAccountSession(session, account) {
    const existing = this.sessionsByAccount.get(account.id);
    if (!existing || existing === session) return;
    try {
      this.send(existing, {
        type: 'event',
        event: 'session_replaced',
        message: 'Desconectado por nueva sesión',
      });
    } catch { /* ignore */ }
    try { existing.socket.close(4001, 'Desconectado por nueva sesión'); } catch { /* ignore */ }
    await this.closeSession(existing, { save: true });
  }

  async attachPlayer(session, account, character) {
    character = await this.store.loadCharacter(character.id);
    if (!character) throw new Error('Personaje desapareció');

    const player = new PlayerState(character);
    // Los privilegios admin se re-aplican en cada login (por si el guardado es
    // anterior a esta función) y se persisten en el siguiente guardado.
    const adminSync = this.syncAdminFlags(player, this.isAdminAccount(account));
    const stallRestore = await this.restoreStallOnLogin(player);

    // Reposiciona si el guardado quedó sobre un obstáculo.
    const px = Math.round(player.x);
    const py = Math.round(player.y);
    if (!this.world.canWalk(px, py) || !this.world.isInside(px, py)) {
      const spot = this.world.findFreeAdjacent(SPAWN_POINT.x, SPAWN_POINT.y);
      this.world.moveEntity(player, spot.x, spot.y);
    }
    player.recalc();
    player.hp = Math.max(1, Math.min(player.maxHp, player.hp));
    player.mp = Math.min(player.maxMp, player.mp);
    player.sessionId = session.id;
    player.nextRegenAt = Date.now() + 3000;
    player.dirty = !!stallRestore || adminSync;

    session.player = player;
    session.authed = true;
    session.accountId = account.id;
    session.email = account.email;
    this.sessionsByPlayer.set(player.id, session);
    this.world.addPlayer(player);

    const token = this.issueToken(account, player);

    this.sendEvent(player, 'resource_states', { resources: this.resources.stumps() });

    this.send(session, {
      type: 'auth_ok',
      token,
      needsCharacter: false,
      provider: session.authProvider ?? 'session',
      account: { id: account.id, email: account.email },
      player: player.toProfile(),
      world: {
        seed: this.world.seed,
        width: this.world.width,
        height: this.world.height,
        spawn: this.world.spawnPoint,
        zones: ZONES,
      },
      catalog: ITEMS,
      monsters: MONSTERS,
      npcs: [...this.world.npcs.values()].map((npc) => ({
        id: npc.id, name: npc.name, x: npc.x, y: npc.y,
      })),
      config: {
        tickRate: this.config.tickRate,
        snapshotRate: this.config.snapshotRate,
        aoiRadius: this.config.aoiRadius,
        viewHalfW: this.config.viewHalfW,
        viewHalfH: this.config.viewHalfH,
        classes: CLASSES,
        constants: CONSTANTS,
      },
      online: this.sessionsByPlayer.size,
    });
    this.sendChat(session, {
      channel: 'system',
      from: 'Sistema',
      text: `Bienvenido, ${player.name}. Toca el suelo para moverte y los enemigos para atacar.`,
      at: Date.now(),
    });
    if (stallRestore) {
      if (stallRestore.leftovers.length > 0) {
        this.world.createBag({
          x: player.x,
          y: player.y,
          ownerId: player.id,
          items: stallRestore.leftovers,
          gold: 0,
          freeAt: 0,
          expiresAt: Date.now() + CONSTANTS.BAG_EXPIRE_MS,
        });
      }
      this.sendEvent(player, 'notice', {
        text: stallRestore.leftovers.length
          ? 'Tu tienda AFK se cerró. La mochila estaba llena: el resto quedó en una bolsa a tus pies.'
          : 'Tu tienda AFK se cerró y recuperaste los ítems',
      });
    }
    this.broadcastLocalChat(player.x, player.y, 12, {
      channel: 'local', from: 'Sistema', text: `${player.name} se conectó`, at: Date.now(), system: true,
    });
    console.log(`[auth] ${player.name} (nivel ${player.level}) conectado desde ${session.ip}${player.isAdmin ? ' [admin]' : ''}`);
  }

  async handleCreateCharacter(session, msg) {
    if (!session.authed || session.player) return;
    if (!session.accountId) {
      this.send(session, { type: 'character_error', message: 'Sesión no válida' });
      return;
    }

    try {
      const account = await this.store.getAccountById?.(session.accountId)
        ?? { id: session.accountId, email: session.email };
      const admin = this.isAdminAccount(account);
      // Para el administrador el nombre es fijo: lo que escriba el cliente se ignora.
      const name = admin
        ? ADMIN_CHARACTER_NAME
        : String(msg.name ?? '').trim().replace(/\s+/g, ' ');

      if (!admin && !CHARACTER_NAME_RE.test(name)) {
        this.send(session, {
          type: 'character_error',
          message: 'Nombre inválido: 3-16 letras, números, espacios o _',
        });
        return;
      }
      if (!admin && name.toLowerCase() === ADMIN_CHARACTER_NAME.toLowerCase()) {
        this.send(session, { type: 'character_error', message: 'Ese nombre está reservado' });
        return;
      }

      const already = await this.store.getCharacterByName(name);
      if (already) {
        this.send(session, { type: 'character_error', message: 'Ese nombre ya está en uso' });
        return;
      }

      const current = await this.store.getCharacterByAccount(session.accountId);
      if (current) {
        await this.attachPlayer(session, account, current);
        return;
      }

      const state = createCharacterState(name, crypto.randomUUID());
      // Sólo el servidor decide quién es admin; nunca se acepta del cliente.
      if (admin) Object.assign(state, { isAdmin: true, nameColor: ADMIN_NAME_COLOR });
      const character = await this.store.createCharacter(session.accountId, state);
      console.log(`[auth] personaje nuevo: ${name}${admin ? ' (admin)' : ''}`);
      await this.attachPlayer(session, account, character);
    } catch (err) {
      console.error('[auth] error creando personaje:', err);
      this.send(session, {
        type: 'character_error',
        message: 'No se pudo crear el personaje. Prueba con otro nombre.',
      });
    }
  }

  /**
   * Cierra la tienda AFK al entrar: devuelve los ítems, elimina el puesto y
   * devuelve los que no quepan en la mochila para dejarlos en una bolsa.
   */
  async restoreStallOnLogin(player) {
    if (!player.stall) return null;
    this.world.removeStall(`stall_${player.id}`);
    const leftovers = [];
    for (const item of player.stall.items ?? []) {
      const res = addItem(player.inventory, item.itemId, item.qty, item.uid);
      if (res.left > 0) {
        leftovers.push({ uid: item.uid, itemId: item.itemId, qty: res.left });
      }
    }
    player.stall = null;
    player.dirty = true;
    await this.store.deleteStall(player.id);
    return { leftovers };
  }

  // ── Handlers de juego ────────────────────────────────────────
  async handleSetOutfit(session, msg) {
    const player = session.player;
    if (!player) return;
    const outfit = msg?.outfit;
    if (!outfit || typeof outfit !== 'object') {
      this.sendError(session, 'Outfit inválido');
      return;
    }
    const ALLOWED = new Set([
      '#FF0000', '#FF7F00', '#FFFF00', '#7FFF00', '#00FF00', '#00FF7F',
      '#00FFFF', '#007FFF', '#0000FF', '#7F00FF', '#FF00FF', '#FF007F',
      '#010101', '#FFFFFF', '#5C3317', '#8B0000', '#CC5500', '#808000',
      '#006400', '#004D26', '#008B8B', '#00008B', '#4B0082', '#8B008B',
      '#FFDAB9', '#8D5524',
    ]);
    const colors = {};
    for (const key of ['color1', 'color2', 'color3', 'color4', 'color5']) {
      let c = String(outfit[key] ?? '').toUpperCase();
      if (c === '#000000') c = '#010101';
      if (!ALLOWED.has(c)) {
        this.sendError(session, 'Color no permitido');
        return;
      }
      colors[key] = c;
    }
    player.outfit = colors;
    player.dirty = true;
    await this.savePlayer(player);
    this.sendEvent(player, 'profile', { player: player.toProfile() });
    this.forceSnapshot(player);
  }

  // ---- Recoleccion de madera (arboles en memoria) ----
  hasAxe(player) {
    // Estricto: solo cuenta si el hacha esta equipada en la ranura tool.
    return player?.equipment?.mano?.itemId === 'axe';
  }

  async handleChopTree(session, msg) {
    const player = session.player;
    if (!player || player.isDead) return;
    if (player.stall) return this.sendError(session, 'No puedes talar con una tienda abierta');

    const parts = String(msg?.id ?? '').split(',');
    const x = Number.parseInt(parts[0], 10);
    const y = Number.parseInt(parts[1], 10);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return this.sendError(session, 'Arbol invalido');
    }
    if (!this.resources.isTree(x, y)) {
      return this.sendError(session, 'Ahi no hay un arbol');
    }

    const now = Date.now();
    if (now < (player.nextChopAt ?? 0)) return;
    if (Math.hypot(player.x - x, player.y - y) > CONSTANTS.CHOP_RANGE) {
      return this.sendEvent(player, 'system_message', { message: 'Estas demasiado lejos del arbol.' });
    }
    if (!this.resources.isAlive(x, y)) {
      return this.sendEvent(player, 'system_message', { message: 'Ese arbol ya fue talado. Espera a que vuelva a crecer.' });
    }
    if (!this.hasAxe(player)) {
      return this.sendEvent(player, 'system_message', { message: 'Debes equiparte el hacha para talar.' });
    }
    if (!hasSpaceFor(player.inventory, 'wood', CONSTANTS.WOOD_PER_CHOP)) {
      return this.sendEvent(player, 'system_message', { message: 'Inventario lleno.' });
    }

    const result = this.resources.chop(x, y);
    if (!result) {
      return this.sendEvent(player, 'system_message', { message: 'Ese arbol ya fue talado.' });
    }

    const amount = Math.random() < 0.05
      ? 9
      : Math.floor(Math.random() * (5 - 2 + 1)) + 2;
    addItem(player.inventory, 'wood', amount);
    player.nextChopAt = now + CONSTANTS.CHOP_COOLDOWN_MS;
    player.dirty = true;
    this.sendProfile(player);
    await this.savePlayer(player);
    this.sendEvent(player, 'notice', { text: `+${amount} Madera` });
    this.broadcastResource(x, y, 'stump');
  }

  broadcastResource(x, y, state) {
    this.broadcastNear(x + 0.5, y + 0.5, 24, {
      type: 'update_resource',
      id: `${x},${y}`,
      resource: 'tree',
      state,
      x,
      y,
    });
  }

  handleMove(session, msg) {
    const player = session.player;
    if (!player || player.isDead) return;
    if (player.stall) return;
    const now = Date.now();
    // Tolerancia de lag: un paquete que llega hasta 120 ms antes del
    // proximo movimiento permitido no se rechaza; se procesa y se reprograma
    // el temporizador desde el momento actual para no acumular retraso.
    if (now < player.nextMoveAt - 120) return;

    const dir = msg.dir;
    if (!Array.isArray(dir) || dir.length !== 2) return;
    const dx = Number(dir[0]);
    const dy = Number(dir[1]);
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;

    const nx = Math.round(player.x) + dx;
    const ny = Math.round(player.y) + dy;
    let allowed = this.world.canWalk(nx, ny);
    // No atravesar esquinas en diagonal.
    if (allowed && dx !== 0 && dy !== 0) {
      allowed = this.world.canWalk(Math.round(player.x) + dx, Math.round(player.y))
        && this.world.canWalk(Math.round(player.x), Math.round(player.y) + dy);
    }
    if (!allowed) {
      this.sendEvent(player, 'move_reject', { seq: msg.seq ?? null, x: player.x, y: player.y });
      return;
    }

    this.world.moveEntity(player, nx, ny);
    player.dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    const diagonal = dx !== 0 && dy !== 0;
    player.nextMoveAt = Math.max(now, player.nextMoveAt) + Math.round(player.moveMs * (diagonal ? 1.18 : 1));
    player.dirty = true;

    // Cancela auto-ataque si el objetivo queda fuera de alcance y la clase es melee.
    if (player.targetId) {
      const target = this.world.getEntity(player.targetId);
      if (!target || target.isDead) {
        player.targetId = null;
        this.sendEvent(player, 'target_clear', {});
      }
    }
  }

  handleTarget(session, msg) {
    const player = session.player;
    if (!player || player.isDead) return;
    const target = this.world.getEntity(String(msg.id ?? ''));
    if (!target || target.kind === 2) {
      this.sendError(session, 'Objetivo inválido');
      return;
    }
    if (target.kind === 0 && target.id === player.id) return;
    player.targetId = target.id;
  }

  handleAttack(session, msg) {
    const player = session.player;
    if (!player) return;
    const target = this.world.getEntity(String(msg.id ?? ''));
    if (!target) return;
    const result = handleAttackIntent(this, player, target.id);
    if (!result.ok && !result.silent) this.sendError(session, result.error);
  }

  handleSwitchClass(session, msg) {
    const player = session.player;
    if (!player || player.isDead) return;
    const result = player.switchClass(String(msg.classId ?? ''), Date.now());
    if (!result.ok) {
      this.sendError(session, result.error);
      return;
    }
    this.sendEvent(player, 'class_switch', { classId: player.classId, weapon: player.equipment.mano });
    this.sendProfile(player);
    this.savePlayer(player);
  }

  handleSpecial(session) {
    const player = session.player;
    if (!player) return;
    const result = performSpecial(this, player, Date.now());
    if (!result.ok) this.sendError(session, result.error);
  }

  handleUseItem(session, msg) {
    const player = session.player;
    if (!player) return;
    const result = player.useConsumable(String(msg.uid ?? ''), Date.now());
    if (!result.ok) {
      this.sendError(session, result.error);
      return;
    }
    this.sendEvent(player, 'heal', { hp: result.healed, mp: result.healedMp, itemId: result.itemId });
    this.sendProfile(player);
    this.savePlayer(player);
  }

  handleEquip(session, msg) {
    const player = session.player;
    if (!player) return;
    const result = player.equipUid(String(msg.uid ?? ''), Date.now());
    if (!result.ok) {
      this.sendError(session, result.error);
      return;
    }
    if (result.slot === 'weapon') {
      this.sendEvent(player, 'class_switch', { classId: player.classId, weapon: player.equipment.mano });
    }
    this.sendProfile(player);
    this.savePlayer(player);
  }

  handleUnequip(session, msg) {
    const player = session.player;
    if (!player) return;
    const result = player.unequipSlot(String(msg.slot ?? ''), Date.now());
    if (!result.ok) {
      this.sendError(session, result.error);
      return;
    }
    if (msg.slot === 'weapon') {
      this.sendEvent(player, 'class_switch', { classId: player.classId, weapon: player.equipment.mano });
    }
    this.sendProfile(player);
    this.savePlayer(player);
  }

  async handleDrop(session, msg) {
    const player = session.player;
    if (!player) return;
    const uid = String(msg.uid ?? '');
    const inst = player.findInventoryUid(uid);
    if (!inst) return this.sendError(session, 'Ítem no encontrado');
    const qty = Math.max(1, Math.min(inst.qty, Math.floor(Number(msg.qty) || 1)));
    const removed = player.removeItemUid(uid, qty);
    if (removed.removed <= 0) return;
    const now = Date.now();
    const bag = this.world.createBag({
      x: player.x,
      y: player.y,
      ownerId: null,
      items: [{ uid: removed.item.uid, itemId: removed.item.itemId, qty: removed.removed }],
      gold: 0,
      freeAt: 0,
      expiresAt: now + CONSTANTS.BAG_EXPIRE_MS,
    });
    // Iniciar timer de desaparición automática de 60 segundos
    bag.despawnTimeout = setTimeout(() => {
      this.world.removeBag(bag.id);
      this.broadcastNear(bag.x, bag.y, 30, {
        type: 'drop_despawn', bagId: bag.id,
      });
      bag.despawnTimeout = null;
    }, 60000);
    player.dirty = true;
    this.sendProfile(player);
    await this.savePlayer(player);
  }

  async handlePickup(session, msg) {
    const player = session.player;
    if (!player || player.isDead) return;
    const bag = this.world.bags.get(String(msg.id ?? ''));
    if (!bag) return this.sendError(session, 'Bolsa no encontrada');
    if ((bag.x - player.x) ** 2 + (bag.y - player.y) ** 2 > 2.2 ** 2) {
      return this.sendError(session, 'Acércate a la bolsa');
    }
    const now = Date.now();
    if (now < bag.freeAt && bag.ownerId && bag.ownerId !== player.id) {
      return this.sendError(session, 'Esta bolsa pertenece a otro jugador');
    }

    // Limpiar timeout de auto-desaparecimiento si existía
    if (bag.despawnTimeout) {
      clearTimeout(bag.despawnTimeout);
      bag.despawnTimeout = null;
    }

    let gold = 0;
    if (bag.gold > 0) {
      gold = Math.min(bag.gold, CONSTANTS.MAX_GOLD - player.gold);
      player.gold += gold;
      bag.gold -= gold;
    }

    const picked = [];
    for (const item of [...bag.items]) {
      const res = addItem(player.inventory, item.itemId, item.qty, item.uid);
      if (res.added > 0) {
        picked.push({ itemId: item.itemId, qty: res.added });
        item.qty -= res.added;
      }
      if (item.qty <= 0) bag.items.splice(bag.items.indexOf(item), 1);
    }

    if (gold > 0 || picked.length > 0) {
      this.sendEvent(player, 'loot_pickup', { gold, items: picked });
      this.sendEvent(player, 'notice', {
        text: `Recogiste ${gold} oro${picked.length ? ` y ${picked.length} ítem(s)` : ''}`,
      });
      player.dirty = true;
      this.sendProfile(player);
      await this.savePlayer(player);
    } else {
      this.sendError(session, 'Inventario lleno o bolsa vacía');
    }

    if (bag.gold <= 0 && bag.items.length === 0) {
      // Notificar a todos los clientes que la bolsa desaparece
      this.broadcastNear(bag.x, bag.y, 20, {
        type: 'drop_despawn', bagId: bag.id,
      });
      this.world.removeBag(bag.id);
    }
  }

  handleChatMessage(session, msg) {
    const result = handleChat(this, session, msg, Date.now());
    if (!result.ok) this.sendError(session, result.error);
  }

  handleAdminAction(session, msg) {
    const player = session.player;
    if (!player) return;
    // Doble validación: flag del personaje + correo verificado de la cuenta.
    if (!player.isAdmin) {
      this.sendError(session, 'No tienes permisos de administrador');
      return;
    }
    const account = session.email ? { email: session.email } : null;
    if (!account || !this.isAdminAccount(account)) {
      this.sendError(session, 'No tienes permisos de administrador');
      return;
    }
    const action = String(msg.action ?? '');
    const result = executeAdminAction(this, player, action);
    if (result.ok) {
      this.sendEvent(player, 'admin_result', { action, ok: true, message: result.message });
      this.sendEvent(player, 'admin_state', adminState(player));
    } else {
      this.sendError(session, result.error || 'Acción de admin fallida');
    }
  }

  handleShopOpen(session, msg) {
    const player = session.player;
    if (!player) return;
    const npc = this.world.npcs.get(String(msg.npcId ?? ''));
    if (!npc) return this.sendError(session, 'NPC no encontrado');
    if ((npc.x - player.x) ** 2 + (npc.y - player.y) ** 2 > 3.5 ** 2) {
      return this.sendError(session, 'Acércate al mercader');
    }
    this.sendEvent(player, 'shop', { shop: shopPayload(npc) });
  }

  async handleShopBuy(session, msg) {
    const player = session.player;
    if (!player) return;
    const result = npcBuy(this, player, String(msg.npcId ?? ''), String(msg.itemId ?? ''), Number(msg.qty ?? 1));
    if (!result.ok) this.sendError(session, result.error);
    else await this.savePlayer(player);
  }

  async handleShopSell(session, msg) {
    const player = session.player;
    if (!player) return;
    const result = npcSell(this, player, String(msg.uid ?? ''), Number(msg.qty ?? 1));
    if (!result.ok) this.sendError(session, result.error);
    else await this.savePlayer(player);
  }

  async handleStallOpen(session, msg) {
    const player = session.player;
    if (!player) return;
    const result = await openStall(this, player, msg.items);
    if (!result.ok) this.sendError(session, result.error);
  }

  async handleStallClose(session) {
    const player = session.player;
    if (!player) return;
    const result = await closeStall(this, player);
    if (!result.ok) this.sendError(session, result.error);
  }

  handleStallView(session, msg) {
    const player = session.player;
    if (!player) return;
    const stall = this.world.stalls.get(String(msg.id ?? ''));
    if (!stall) return this.sendError(session, 'Tienda no encontrada');
    if ((stall.x - player.x) ** 2 + (stall.y - player.y) ** 2 > 2.6 ** 2) {
      return this.sendError(session, 'Acércate a la tienda');
    }
    this.sendEvent(player, 'stall', {
      stall: {
        id: stall.id,
        ownerName: stall.ownerName,
        x: stall.x,
        y: stall.y,
        items: stall.items,
      },
    });
  }

  async handleStallBuy(session, msg) {
    const player = session.player;
    if (!player) return;
    const stallId = String(msg.stallId ?? '');
    const stall = this.world.stalls.get(stallId);
    const stallMeta = stall ? { ownerName: stall.ownerName, x: stall.x, y: stall.y } : null;
    const result = await buyStallListing(this, player, stallId, String(msg.itemUid ?? ''));
    if (!result.ok) {
      this.sendError(session, result.error);
      return;
    }
    await this.savePlayer(player);
    if (result.stallClosed) {
      this.sendEvent(player, 'stall_closed', { stallId });
    } else if (stallMeta) {
      this.sendEvent(player, 'stall', {
        stall: { id: stallId, ...stallMeta, items: result.remainingItems },
      });
    }
  }

  logTransaction(entry) {
    Promise.resolve(this.store.logTransaction?.(entry)).catch(() => { });
  }

  markDirty(player) {
    if (player) player.dirty = true;
  }

  // ── Tick autoritativo ────────────────────────────────────────
  tick() {
    const started = performance.now();
    const now = Date.now();
    if (this.lastTickAt) {
      this.tickLagMs = Math.max(0, now - this.lastTickAt - this.config.tickMs);
    }
    this.lastTickAt = now;
    this.tickCount += 1;
    try {
      updateMonsters(this, now);

      for (const player of this.world.players.values()) {
        // Blindaje: el HP nunca puede quedar negativo y toda muerte debe
        // tener un temporizador valido. Si por cualquier motivo (estado
        // cargado, daño externo o un tick perdido) `deadUntil` esta a 0,
        // programamos el respawn en lugar de dejar al jugador congelado.
        if (player.hp < 0) player.hp = 0;
        if (player.hp <= 0 || player.isDead) {
          if (!player.deadUntil) player.deadUntil = now + CONSTANTS.PLAYER_RESPAWN_MS;
          if (now >= player.deadUntil) respawnPlayer(this, player, now);
          continue;
        }

        // Expiración de calavera
        if (player.skull !== 'none' && player.skullUntil <= now) {
          player.skull = 'none';
          player.skullUntil = 0;
          this.sendProfile(player);
        }

        // Regeneración pasiva
        if (now >= player.nextRegenAt) {
          const safe = isSafeZone(Math.round(player.x), Math.round(player.y));
          player.nextRegenAt = now + (safe ? CONSTANTS.SAFE_REGEN_INTERVAL_MS : CONSTANTS.WILD_REGEN_INTERVAL_MS);
          const hpPct = safe ? 0.03 : 0.012;
          const mpPct = safe ? 0.04 : 0.02;
          if (player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + Math.max(1, Math.round(player.maxHp * hpPct)));
          if (player.mp < player.maxMp) player.mp = Math.min(player.maxMp, player.mp + Math.max(1, Math.round(player.maxMp * mpPct)));
        }

        // Auto-ataque mientras haya objetivo
        if (player.targetId && !player.stall) {
          const target = this.world.getEntity(player.targetId);
          if (!target || target.kind === 2 || target.isDead) {
            player.targetId = null;
            this.sendEvent(player, 'target_clear', {});
          } else if (target.kind === 0 && !isPvPZone(Math.round(target.x), Math.round(target.y))) {
            player.targetId = null;
            this.sendEvent(player, 'target_clear', {});
          } else {
            const range = (CLASSES[player.classId]?.range ?? 1.35) + 0.35;
            if ((target.x - player.x) ** 2 + (target.y - player.y) ** 2 <= range * range) {
              performPlayerAttack(this, player, target, now);
            }
          }
        }
      }
    } catch (err) {
      console.error('[tick] error:', err);
    }

    if (this.tickCount % this.config.snapshotEveryTicks === 0) this.broadcastSnapshots(now);
    if (this.tickCount % (this.config.tickRate * 2) === 0) this.cleanup(now);

    this.lastTickMs = Math.round((performance.now() - started) * 100) / 100;
    this.maxTickMs = Math.max(this.maxTickMs, this.lastTickMs);
    if (this.lastTickMs > this.config.tickMs && this.tickCount % this.config.tickRate === 0) {
      console.warn(`[tick] trabajo ${this.lastTickMs}ms > ${this.config.tickMs}ms (lag ${this.tickLagMs}ms)`);
    }
  }

  broadcastSnapshots(now) {
    for (const session of this.sessionsByPlayer.values()) {
      const player = session.player;
      if (!player) continue;
      this.sendSnapshot(session, player, now);
    }
  }

  /** Construye el snapshot compacto (claves cortas + self como array). */
  createSnapshotPayload(player, now) {
    // Garantiza que el cliente siempre reciba la propiedad weaponTexture.
    player.weaponTexture = player?.classId ? `weapon_${player.classId}` : null;
    const snap = this.world.snapshotFor(
      player,
      this.config.viewHalfW,
      this.config.viewHalfH,
    );
    return {
      type: 'snapshot',
      t: now,
      self: encodeSelf(player),
      e: snap.entities,
      b: snap.bags,
      s: snap.stalls,
      o: this.sessionsByPlayer.size,
    };
  }

  sendSnapshot(session, player, now) {
    return this.send(session, this.createSnapshotPayload(player, now));
  }

  /**
   * Fuerza un snapshot inmediato (respawn, teleport). Evita que la cámara y el
   * sprite esperen hasta el siguiente tick de snapshots.
   */
  forceSnapshot(player, now = Date.now()) {
    const session = this.sessionsByPlayer.get(player.id);
    if (!session) return false;
    return this.sendSnapshot(session, player, now);
  }

  cleanup(now) {
    for (const [id, bag] of this.world.bags) {
      if (bag.expiresAt && now > bag.expiresAt) this.world.removeBag(id);
    }
    for (const session of this.sessions.values()) {
      if (!session.authed && now - session.createdAt > 30000) {
        try { session.socket.close(4008, 'Timeout de autenticación'); } catch { /* ignore */ }
      }
      if (!session.alive && now - session.lastSeen > 60000) {
        try { session.socket.terminate(); } catch { /* ignore */ }
      }
    }
  }

  heartbeat() {
    for (const session of this.sessions.values()) {
      if (session.closed) continue;
      if (!session.alive) {
        try { session.socket.terminate(); } catch { /* ignore */ }
        continue;
      }
      session.alive = false;
      try { session.socket.ping(); } catch { /* ignore */ }
    }
  }

  // ── Tiendas offline / persistencia ───────────────────────────
  async loadOfflineStalls() {
    try {
      const stalls = await this.store.listStalls();
      for (const s of stalls) {
        this.world.addStall({
          id: `stall_${s.characterId}`,
          characterId: s.characterId,
          ownerName: s.ownerName,
          x: Math.round(s.x),
          y: Math.round(s.y),
          items: s.items ?? [],
          online: false,
          createdAt: s.createdAt,
        });
      }
      if (stalls.length) console.log(`[stalls] ${stalls.length} tiendas offline restauradas`);
    } catch (err) {
      console.error('[stalls] no se pudieron cargar:', err.message);
    }
  }

  savePlayer(player) {
    if (!player) return Promise.resolve();
    player.dirty = false;
    const state = player.toState();
    const prev = this.saveChains.get(player.id) ?? Promise.resolve();
    const next = prev
      .then(() => this.store.saveCharacter(state))
      .catch((err) => {
        console.error(`[save] ${player.name}:`, err.message);
        player.dirty = true;
      })
      .finally(() => {
        if (this.saveChains.get(player.id) === next) this.saveChains.delete(player.id);
      });
    this.saveChains.set(player.id, next);
    return next;
  }

  async saveAll(force = false) {
    const tasks = [];
    for (const player of this.world.players.values()) {
      if (player.dirty || force) tasks.push(this.savePlayer(player));
    }
    await Promise.allSettled(tasks);
  }

  async closeSession(session, { save = true } = {}) {
    if (!session || session.closed) return;
    session.closed = true;
    this.sessions.delete(session.id);
    if (session.accountId && this.sessionsByAccount.get(session.accountId) === session) {
      this.sessionsByAccount.delete(session.accountId);
    }
    const player = session.player;
    session.player = null;
    if (!player) return;

    if (this.sessionsByPlayer.get(player.id) === session) this.sessionsByPlayer.delete(player.id);
    player.sessionId = null;

    const stall = this.world.stalls.get(`stall_${player.id}`);
    if (stall) {
      stall.online = false;
      player.stall = { items: stall.items, createdAt: stall.createdAt };
    }
    this.world.removePlayer(player.id);
    if (save) {
      await this.savePlayer(player);
      // Persistencia inmediata en Firestore al desconectarse (si el store lo soporta).
      await this.store.flushCharacter?.(player.id);
    }
    if (stall) {
      this.broadcastLocalChat(player.x, player.y, 16, {
        channel: 'local', from: 'Sistema',
        text: `${player.name} dejó su tienda abierta (AFK)`, at: Date.now(), system: true,
      });
    }
    console.log(`[auth] ${player.name} desconectado`);
  }
}
