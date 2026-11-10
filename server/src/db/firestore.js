import { MemoryStore } from './memory.js';

/**
 * Persistencia en Firebase Firestore.
 *
 * El juego corre 100% en RAM (hereda de MemoryStore). Firestore sólo se toca en:
 *   1. Login / reconexión: lectura del jugador y creación del documento base.
 *   2. Desconexión: vuelco inmediato del jugador (flushCharacter).
 *   3. Auto-guardado global cada 5 minutos para jugadores activos (dirty).
 *   4. SIGTERM / cierre del servidor: vuelco final de la memoria (close -> flush).
 *
 * NUNCA se escribe a Firestore dentro del bucle de tick (20 Hz): saveCharacter
 * sólo actualiza la RAM y marca la cuenta como "dirty".
 *
 * Colección: `players/{uid}` con la cuenta, el personaje y el puesto (stall).
 */

const COLLECTION = 'players';
const AUTOSAVE_MS = 5 * 60 * 1000;

/** Firestore rechaza `undefined`; se normaliza recursivamente a `null`. */
function sanitize(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (value instanceof Map || value instanceof Set) return sanitize([...value]);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v);
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

/**
 * Parsea FIREBASE_SERVICE_ACCOUNT de forma segura. El copy-paste (Render, CI)
 * suele entregar la private_key con los saltos de línea escapados como \n
 * literal; aquí se devuelven a saltos reales antes de JSON.parse/normalizar.
 */
export function parseServiceAccount(raw = process.env.FIREBASE_SERVICE_ACCOUNT) {
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT no está configurado');
  const parsed = JSON.parse(String(raw).trim());
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

/** Inicializa el Admin SDK con cert(serviceAccount) y devuelve el Firestore. */
export async function initFirebaseAdmin(raw = process.env.FIREBASE_SERVICE_ACCOUNT) {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const serviceAccount = parseServiceAccount(raw);
  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

export class FirestoreStore extends MemoryStore {
  constructor({ db = null, autosaveMs = AUTOSAVE_MS } = {}) {
    super();
    this.db = db;
    this.autosaveMs = autosaveMs;
    this.dirty = new Set(); // accountIds pendientes de volcar a Firestore
    this.timer = null;
  }

  async init() {
    if (!this.db) this.db = await initFirebaseAdmin();
    this.initialized = true;
    // Auto-guardado global: cada 5 minutos vuelca los jugadores activos.
    this.timer = setInterval(() => {
      this.flush().catch((err) => console.error('[firestore] autosave:', err?.message ?? err));
    }, this.autosaveMs);
    this.timer.unref?.();
    console.log(
      `[store] Firestore listo · colección "${COLLECTION}" · autosave cada ${Math.round(this.autosaveMs / 60000)} min`,
    );
  }

  /** SIGTERM / apagado: vuelca toda la memoria antes de cerrar. */
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  // ── Helpers internos ───────────────────────────────────────
  docId(account) {
    return String(account?.uid || account?.id || account?.email || '');
  }

  markDirty(accountId) {
    if (accountId) this.dirty.add(accountId);
  }

  accountIdByCharacter(characterId) {
    return this.characters.get(characterId)?.accountId ?? null;
  }

  rawCharacterByAccount(accountId) {
    for (const ch of this.characters.values()) {
      if (ch.accountId === accountId) return ch;
    }
    return null;
  }

  buildDoc(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) return null;
    const character = this.rawCharacterByAccount(accountId);
    const stall = character ? this.stalls.get(character.id) ?? null : null;
    return {
      uid: account.uid ?? null,
      email: account.email ?? null,
      accountId: account.id,
      username: account.username ?? null,
      passwordHash: account.passwordHash ?? '',
      createdAt: account.createdAt ?? null,
      lastLoginAt: account.lastLoginAt ?? null,
      characterId: character?.id ?? null,
      character: character ? sanitize({ ...character }) : null,
      stall: stall ? sanitize({ ...stall }) : null,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Carga un documento de Firestore a la RAM y devuelve la cuenta. */
  hydrate(snap) {
    const data = typeof snap?.data === 'function' ? snap.data() : snap;
    if (!data || !data.accountId) return null;
    const account = {
      id: data.accountId,
      email: data.email ? String(data.email).toLowerCase() : null,
      username: data.username ?? data.email ?? data.accountId,
      passwordHash: data.passwordHash ?? '',
      uid: data.uid ?? null,
      createdAt: data.createdAt ?? new Date().toISOString(),
      lastLoginAt: data.lastLoginAt ?? null,
    };
    this.accounts.set(account.id, account);
    if (account.email) this.accountsByEmail.set(account.email, account.id);
    this.accountsByName.set(
      String(account.username ?? account.email ?? account.id).toLowerCase(),
      account.id,
    );

    const ch = data.character;
    if (ch?.id) {
      const { stall: _ignored, ...rest } = ch;
      rest.accountId = account.id;
      this.characters.set(ch.id, rest);
      const stall = data.stall ?? null;
      if (stall && Array.isArray(stall.items) && stall.items.length) {
        this.stalls.set(ch.id, {
          characterId: ch.id,
          ownerName: stall.ownerName ?? ch.name ?? '',
          x: stall.x ?? ch.x ?? 0,
          y: stall.y ?? ch.y ?? 0,
          items: stall.items,
          createdAt: stall.createdAt ?? new Date().toISOString(),
          updatedAt: stall.updatedAt ?? new Date().toISOString(),
        });
      } else {
        this.stalls.delete(ch.id);
      }
    }
    return structuredClone(account);
  }

  async queryOne(field, value) {
    if (!this.db || value == null || value === '') return null;
    try {
      const snap = await this.db.collection(COLLECTION).where(field, '==', value).limit(1).get();
      if (snap.empty) return null;
      return this.hydrate(snap.docs[0]);
    } catch (err) {
      console.error(`[firestore] consulta por ${field}:`, err?.message ?? err);
      return null;
    }
  }

  async persistAccount(accountId) {
    if (!this.db || !accountId) return false;
    const account = this.accounts.get(accountId);
    if (!account) return false;
    const id = this.docId(account);
    const data = id ? this.buildDoc(accountId) : null;
    if (!id || !data) return false;
    try {
      await this.db.collection(COLLECTION).doc(id).set(data, { merge: true });
      this.dirty.delete(accountId);
      return true;
    } catch (err) {
      console.error(`[firestore] no se pudo guardar ${account.email ?? id}:`, err?.message ?? err);
      this.dirty.add(accountId); // reintenta en el próximo autosave
      return false;
    }
  }

  /** Vuelca todos los jugadores dirty (autosave 5 min y SIGTERM). */
  async flush() {
    if (!this.db || this.dirty.size === 0) return 0;
    const ids = [...this.dirty];
    this.dirty.clear();
    let saved = 0;
    for (const id of ids) {
      if (await this.persistAccount(id)) saved += 1;
    }
    if (saved) console.log(`[firestore] guardados ${saved} jugador(es)`);
    return saved;
  }

  /** Vuelco inmediato al desconectarse un jugador. */
  async flushCharacter(characterId) {
    const accountId = this.accountIdByCharacter(characterId);
    if (!accountId) return false;
    return this.persistAccount(accountId);
  }

  // ── Lecturas: login / reconexión ──────────────────────────
  async getAccountByEmail(email, { uid = null } = {}) {
    const cached = await super.getAccountByEmail(email);
    if (cached) return cached;
    if (!this.db) return null;
    // Búsqueda directa por UID (id de documento) cuando el proveedor lo da.
    if (uid) {
      try {
        const snap = await this.db.collection(COLLECTION).doc(String(uid)).get();
        if (snap.exists) return this.hydrate(snap);
      } catch (err) {
        console.error('[firestore] lectura por uid:', err?.message ?? err);
      }
    }
    return this.queryOne('email', String(email ?? '').trim().toLowerCase());
  }

  async getAccountById(accountId) {
    const cached = await super.getAccountById(accountId);
    if (cached) return cached;
    return this.queryOne('accountId', accountId);
  }

  async getCharacterByAccount(accountId) {
    const cached = await super.getCharacterByAccount(accountId);
    if (cached) return cached;
    const account = await this.queryOne('accountId', accountId);
    if (!account) return null;
    return super.getCharacterByAccount(accountId);
  }

  async loadCharacter(characterId) {
    const cached = await super.loadCharacter(characterId);
    if (cached) return cached;
    const account = await this.queryOne('characterId', characterId);
    if (!account) return null;
    return super.loadCharacter(characterId);
  }

  async getCharacterByName(name) {
    const cached = await super.getCharacterByName(name);
    if (cached) return cached;
    if (!this.db || !String(name ?? '').trim()) return null;
    try {
      const snap = await this.db
        .collection(COLLECTION)
        .where('character.name', '==', String(name).trim())
        .limit(1)
        .get();
      if (snap.empty) return null;
      this.hydrate(snap.docs[0]);
      return super.getCharacterByName(name);
    } catch (err) {
      console.error('[firestore] consulta por nombre:', err?.message ?? err);
      return null;
    }
  }

  /** Al arrancar: restaura las tiendas AFK y deja sus dueños en RAM. */
  async listStalls() {
    const ram = await super.listStalls();
    if (!this.db) return ram;
    try {
      const snap = await this.db.collection(COLLECTION).get();
      const out = [];
      for (const doc of snap.docs) {
        const data = typeof doc.data === 'function' ? doc.data() : doc;
        const stall = data?.stall;
        const ch = data?.character;
        if (!stall || !Array.isArray(stall.items) || !stall.items.length || !ch?.id) continue;
        this.hydrate(doc); // deja al vendedor offline en RAM para compras atómicas
        out.push({
          characterId: ch.id,
          ownerName: stall.ownerName ?? ch.name ?? '',
          x: stall.x ?? ch.x ?? 0,
          y: stall.y ?? ch.y ?? 0,
          items: stall.items,
          createdAt: stall.createdAt ?? new Date().toISOString(),
        });
      }
      if (out.length) console.log(`[firestore] ${out.length} tienda(s) offline restauradas`);
      return out;
    } catch (err) {
      console.error('[firestore] no se pudieron listar tiendas:', err?.message ?? err);
      return ram;
    }
  }

  // ── Escrituras: RAM durante el juego, Firestore sólo en los 3 eventos ──
  async createAccount(payload = {}) {
    const account = await super.createAccount(payload);
    // Documento base en Firestore (nivel 1 / inventario vacío llegan con el personaje).
    await this.persistAccount(account.id);
    return account;
  }

  async createCharacter(accountId, state) {
    const character = await super.createCharacter(accountId, state);
    // Persiste de inmediato los valores base: nivel 1, stats iniciales, inventario vacío.
    await this.persistAccount(accountId);
    return character;
  }

  async touchLogin(accountId) {
    await super.touchLogin(accountId);
    this.markDirty(accountId);
  }

  async saveCharacter(character) {
    const result = await super.saveCharacter(character);
    // Sólo RAM + dirty: el bucle de juego NUNCA llama a Firestore.
    this.markDirty(character?.accountId ?? this.accountIdByCharacter(character?.id));
    return result;
  }

  async deleteStall(characterId) {
    await super.deleteStall(characterId);
    this.markDirty(this.accountIdByCharacter(characterId));
  }

  async creditGold(characterId, amount, meta = {}) {
    const result = await super.creditGold(characterId, amount, meta);
    if (result?.ok) this.markDirty(this.accountIdByCharacter(characterId));
    return result;
  }

  async buyStallItem(payload) {
    const { sellerId } = payload ?? {};
    // El vendedor offline puede no estar en RAM tras un reinicio: se carga bajo demanda.
    if (sellerId && !this.characters.has(sellerId)) {
      await this.loadCharacter(sellerId);
    }
    const result = await super.buyStallItem(payload);
    if (result?.ok) this.markDirty(this.accountIdByCharacter(sellerId));
    return result;
  }
}