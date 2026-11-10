import crypto from 'node:crypto';
import { CONSTANTS } from '../../shared/index.js';

const clone = (value) => (value == null ? value : structuredClone(value));

/**
 * Store en memoria. Sirve de contrato/base para JSON y para tests de integración.
 * No debe usarse en producción (los datos se pierden al reiniciar).
 */
export class MemoryStore {
  constructor() {
    this.accounts = new Map();       // id -> account
    this.accountsByName = new Map(); // username(lower) -> id
    this.accountsByEmail = new Map();// email(lower) -> id
    this.characters = new Map();     // id -> character (sin stall)
    this.stalls = new Map();         // characterId -> stall
    this.transactions = [];
    this.initialized = false;
  }

  async init() { this.initialized = true; }
  async close() {}

  async getAccountById(accountId) {
    return this.accounts.has(accountId) ? clone(this.accounts.get(accountId)) : null;
  }

  async getAccountByUsername(username) {
    const id = this.accountsByName.get(String(username).toLowerCase());
    return id ? clone(this.accounts.get(id)) : null;
  }

  async getAccountByEmail(email) {
    const id = this.accountsByEmail.get(String(email ?? '').trim().toLowerCase());
    return id ? clone(this.accounts.get(id)) : null;
  }

  async createAccount({ email = null, username = null, passwordHash = '', uid = null } = {}) {
    const normalizedEmail = email
      ? String(email).trim().toLowerCase()
      : (String(username ?? '').includes('@') ? String(username).trim().toLowerCase() : null);
    const displayName = username || normalizedEmail || `user_${crypto.randomUUID().slice(0, 8)}`;
    if (normalizedEmail && this.accountsByEmail.has(normalizedEmail)) {
      throw new Error('Ya existe una cuenta con ese correo');
    }
    if (this.accountsByName.has(displayName.toLowerCase())) {
      throw new Error('Ya existe una cuenta con ese nombre');
    }
    const account = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      username: displayName,
      passwordHash: passwordHash ?? '',
      uid: uid ? String(uid) : null,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    this.accounts.set(account.id, account);
    this.accountsByName.set(displayName.toLowerCase(), account.id);
    if (normalizedEmail) this.accountsByEmail.set(normalizedEmail, account.id);
    return clone(account);
  }

  async touchLogin(accountId) {
    const acc = this.accounts.get(accountId);
    if (acc) acc.lastLoginAt = new Date().toISOString();
  }

  async getCharacterByAccount(accountId) {
    for (const character of this.characters.values()) {
      if (character.accountId === accountId) return this.loadCharacter(character.id);
    }
    return null;
  }

  async getCharacterByName(name) {
    const needle = String(name ?? '').trim().toLowerCase();
    for (const character of this.characters.values()) {
      if (String(character.name ?? '').trim().toLowerCase() === needle) {
        return this.loadCharacter(character.id);
      }
    }
    return null;
  }

  async createCharacter(accountId, state) {
    const now = new Date().toISOString();
    const character = {
      ...clone(state),
      id: state.id || crypto.randomUUID(),
      accountId,
      createdAt: now,
      updatedAt: now,
      stall: null,
    };
    this.characters.set(character.id, clone({ ...character, stall: null }));
    return this.loadCharacter(character.id);
  }

  async loadCharacter(characterId) {
    const base = this.characters.get(characterId);
    if (!base) return null;
    const character = clone(base);
    const stall = this.stalls.get(characterId);
    character.stall = stall ? clone(stall) : null;
    return character;
  }

  async saveCharacter(character) {
    if (!character?.id) throw new Error('saveCharacter: id requerido');
    const base = clone(character);
    base.updatedAt = new Date().toISOString();
    delete base.stall;
    this.characters.set(character.id, base);

    if (character.stall && character.stall.items?.length) {
      this.stalls.set(character.id, {
        characterId: character.id,
        ownerName: character.name,
        x: character.x,
        y: character.y,
        items: clone(character.stall.items),
        createdAt: character.stall.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      this.stalls.delete(character.id);
    }
    return true;
  }

  async listStalls() {
    return [...this.stalls.values()].map(clone);
  }

  async deleteStall(characterId) {
    this.stalls.delete(characterId);
  }

  async creditGold(characterId, amount, meta = {}) {
    const character = this.characters.get(characterId);
    if (!character) return { ok: false, code: 'no_character' };
    const gold = Math.max(0, Math.min(CONSTANTS.MAX_GOLD, (character.gold || 0) + amount));
    character.gold = gold;
    character.updatedAt = new Date().toISOString();
    this.logTransaction({ kind: 'credit', sellerId: characterId, gold: amount, meta });
    return { ok: true, gold };
  }

  /**
   * Compra atómica de un listado de tienda AFK. El servidor valida y descuenta
   * el oro del comprador; este método acredita al vendedor y quita el listado.
   */
  async buyStallItem({ sellerId, itemUid, buyerId = null }) {
    const stall = this.stalls.get(sellerId);
    if (!stall) return { ok: false, code: 'stall_gone' };
    const idx = stall.items.findIndex((it) => it.uid === itemUid);
    if (idx < 0) return { ok: false, code: 'item_gone' };
    const listing = stall.items[idx];
    const character = this.characters.get(sellerId);
    if (!character) return { ok: false, code: 'seller_gone' };

    stall.items.splice(idx, 1);
    const sellerGold = Math.max(0, Math.min(CONSTANTS.MAX_GOLD, (character.gold || 0) + listing.price));
    character.gold = sellerGold;
    character.updatedAt = new Date().toISOString();

    const remainingItems = stall.items;
    const stallClosed = remainingItems.length === 0;
    if (stallClosed) this.stalls.delete(sellerId);
    else stall.updatedAt = new Date().toISOString();

    this.logTransaction({
      kind: 'stall_buy', buyerId, sellerId, itemId: listing.itemId,
      qty: listing.qty, gold: listing.price, meta: { itemUid },
    });

    return {
      ok: true,
      item: { uid: listing.uid, itemId: listing.itemId, qty: listing.qty },
      price: listing.price,
      sellerGold,
      remainingItems: clone(remainingItems),
      stallClosed,
    };
  }

  logTransaction(entry) {
    this.transactions.push({ ...entry, at: new Date().toISOString() });
    if (this.transactions.length > 5000) this.transactions.shift();
  }

  async snapshotCharacter(character) {
    // Sin histórico en memoria; PostgreSQL sí guarda snapshots.
    return true;
  }
}
