import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { CONSTANTS } from '../../shared/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clone = (v) => (v == null ? v : structuredClone(v));

/**
 * Adaptador PostgreSQL. Usa una transacción por guardado y bloqueos FOR UPDATE
 * en las compras de tiendas para evitar duplicación de ítems/oro.
 */
export class PostgresStore {
  constructor({ databaseUrl, ssl = false } = {}) {
    this.databaseUrl = databaseUrl;
    this.ssl = ssl;
    this.pool = null;
  }

  async init() {
    if (!this.databaseUrl) throw new Error('DATABASE_URL no configurada');
    this.pool = new pg.Pool({
      connectionString: this.databaseUrl,
      ssl: this.ssl ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (err) => console.error('[pg] pool error:', err.message));
    const schema = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
    await this.pool.query(schema);
    await this.pool.query('SELECT 1');
    console.log('[store] PostgreSQL conectado y esquema aplicado');
  }

  async close() {
    await this.pool?.end();
  }

  async getAccountByUsername(username) {
    const res = await this.pool.query(
      'SELECT * FROM accounts WHERE lower(username) = lower($1) LIMIT 1',
      [username],
    );
    return res.rows[0] ? this.mapAccount(res.rows[0]) : null;
  }

  async getAccountByEmail(email) {
    const res = await this.pool.query(
      `SELECT * FROM accounts
       WHERE lower(email) = lower($1)
          OR (email IS NULL AND lower(username) = lower($1))
       LIMIT 1`,
      [email],
    );
    return res.rows[0] ? this.mapAccount(res.rows[0]) : null;
  }

  async getAccountById(accountId) {
    const res = await this.pool.query('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [accountId]);
    return res.rows[0] ? this.mapAccount(res.rows[0]) : null;
  }

  mapAccount(row) {
    return {
      id: row.id,
      email: row.email ?? null,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      lastLoginAt: row.last_login_at?.toISOString?.() ?? row.last_login_at ?? null,
    };
  }

  async createAccount({ email = null, username = null, passwordHash = '' } = {}) {
    const id = crypto.randomUUID();
    const normalizedEmail = email
      ? String(email).trim().toLowerCase()
      : (String(username ?? '').includes('@') ? String(username).trim().toLowerCase() : null);
    const displayName = username || normalizedEmail || `user_${id.slice(0, 8)}`;
    const res = await this.pool.query(
      `INSERT INTO accounts (id, username, password_hash, email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, displayName, passwordHash ?? '', normalizedEmail],
    );
    return this.mapAccount(res.rows[0]);
  }

  async touchLogin(accountId) {
    await this.pool.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [accountId]);
  }

  async getCharacterByAccount(accountId) {
    const res = await this.pool.query(
      'SELECT id FROM characters WHERE account_id = $1 LIMIT 1',
      [accountId],
    );
    if (!res.rows[0]) return null;
    return this.loadCharacter(res.rows[0].id);
  }

  async getCharacterByName(name) {
    const res = await this.pool.query(
      'SELECT id FROM characters WHERE lower(name) = lower($1) LIMIT 1',
      [name],
    );
    if (!res.rows[0]) return null;
    return this.loadCharacter(res.rows[0].id);
  }

  async createCharacter(accountId, state) {
    const character = {
      ...clone(state),
      id: state.id || crypto.randomUUID(),
      accountId,
      stall: null,
    };
    const cleanState = clone(character);
    delete cleanState.stall;
    await this.pool.query(
      `INSERT INTO characters
        (id, account_id, name, level, xp, gold, hp, mp, x, y, dir, skull, skull_until, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        character.id, accountId, character.name, character.level, character.xp,
        character.gold, character.hp, character.mp, character.x, character.y,
        character.dir, character.skull || 'none', character.skullUntil || 0, cleanState,
      ],
    );
    return this.loadCharacter(character.id);
  }

  async loadCharacter(characterId) {
    const res = await this.pool.query(
      `SELECT c.*, s.items AS stall_items, s.created_at AS stall_created_at
       FROM characters c
       LEFT JOIN shop_stalls s ON s.character_id = c.id
       WHERE c.id = $1 LIMIT 1`,
      [characterId],
    );
    if (!res.rows[0]) return null;
    return this.mapCharacter(res.rows[0]);
  }

  mapCharacter(row) {
    const state = row.state || {};
    const character = {
      ...state,
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      level: Number(row.level),
      xp: Number(row.xp),
      gold: Number(row.gold),
      hp: Number(row.hp),
      mp: Number(row.mp),
      x: Number(row.x),
      y: Number(row.y),
      dir: row.dir,
      skull: row.skull,
      skullUntil: Number(row.skull_until),
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
      stall: row.stall_items
        ? {
            characterId: row.id,
            ownerName: row.name,
            x: Number(row.x),
            y: Number(row.y),
            items: row.stall_items,
            createdAt: row.stall_created_at?.toISOString?.() ?? row.stall_created_at,
          }
        : null,
    };
    return character;
  }

  async saveCharacter(character) {
    const state = clone(character);
    delete state.stall;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE characters SET
           name=$2, level=$3, xp=$4, gold=$5, hp=$6, mp=$7, x=$8, y=$9,
           dir=$10, skull=$11, skull_until=$12, state=$13, updated_at=now()
         WHERE id=$1`,
        [
          character.id, character.name, character.level, character.xp, character.gold,
          character.hp, character.mp, character.x, character.y, character.dir,
          character.skull || 'none', character.skullUntil || 0, state,
        ],
      );
      if (res.rowCount === 0) throw new Error(`character ${character.id} inexistente`);

      if (character.stall?.items?.length) {
        await client.query(
          `INSERT INTO shop_stalls (character_id, owner_name, x, y, items, updated_at)
           VALUES ($1,$2,$3,$4,$5,now())
           ON CONFLICT (character_id) DO UPDATE SET
             owner_name=EXCLUDED.owner_name, x=EXCLUDED.x, y=EXCLUDED.y,
             items=EXCLUDED.items, updated_at=now()`,
          [character.id, character.name, character.x, character.y, character.stall.items],
        );
      } else {
        await client.query('DELETE FROM shop_stalls WHERE character_id = $1', [character.id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listStalls() {
    const res = await this.pool.query(
      `SELECT s.*, c.name FROM shop_stalls s
       JOIN characters c ON c.id = s.character_id`,
    );
    return res.rows.map((row) => ({
      characterId: row.character_id,
      ownerName: row.name,
      x: Number(row.x),
      y: Number(row.y),
      items: row.items,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    }));
  }

  async deleteStall(characterId) {
    await this.pool.query('DELETE FROM shop_stalls WHERE character_id = $1', [characterId]);
  }

  async creditGold(characterId, amount, meta = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT gold, state FROM characters WHERE id = $1 FOR UPDATE',
        [characterId],
      );
      if (!res.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'no_character' };
      }
      const gold = Math.max(0, Math.min(CONSTANTS.MAX_GOLD, Number(res.rows[0].gold) + amount));
      const state = res.rows[0].state || {};
      state.gold = gold;
      await client.query(
        'UPDATE characters SET gold=$2, state=$3, updated_at=now() WHERE id=$1',
        [characterId, gold, state],
      );
      await client.query(
        `INSERT INTO market_transactions (kind, seller_id, gold, meta)
         VALUES ('credit', $1, $2, $3)`,
        [characterId, amount, meta],
      );
      await client.query('COMMIT');
      return { ok: true, gold };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async buyStallItem({ sellerId, itemUid, buyerId = null }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const charRes = await client.query(
        'SELECT gold, state FROM characters WHERE id = $1 FOR UPDATE',
        [sellerId],
      );
      if (!charRes.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'seller_gone' };
      }
      const stallRes = await client.query(
        'SELECT items FROM shop_stalls WHERE character_id = $1 FOR UPDATE',
        [sellerId],
      );
      if (!stallRes.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'stall_gone' };
      }
      const items = Array.isArray(stallRes.rows[0].items) ? stallRes.rows[0].items : [];
      const idx = items.findIndex((it) => it.uid === itemUid);
      if (idx < 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'item_gone' };
      }
      const listing = items[idx];
      items.splice(idx, 1);

      const sellerGold = Math.max(
        0,
        Math.min(CONSTANTS.MAX_GOLD, Number(charRes.rows[0].gold) + Number(listing.price)),
      );
      const state = charRes.rows[0].state || {};
      state.gold = sellerGold;
      await client.query(
        'UPDATE characters SET gold=$2, state=$3, updated_at=now() WHERE id=$1',
        [sellerId, sellerGold, state],
      );

      if (items.length === 0) {
        await client.query('DELETE FROM shop_stalls WHERE character_id = $1', [sellerId]);
      } else {
        await client.query(
          'UPDATE shop_stalls SET items=$2, updated_at=now() WHERE character_id = $1',
          [sellerId, items],
        );
      }

      await client.query(
        `INSERT INTO market_transactions (kind, buyer_id, seller_id, item_id, qty, gold, meta)
         VALUES ('stall_buy', $1, $2, $3, $4, $5, $6)`,
        [buyerId, sellerId, listing.itemId, listing.qty, listing.price, { itemUid }],
      );
      await client.query('COMMIT');

      return {
        ok: true,
        item: { uid: listing.uid, itemId: listing.itemId, qty: listing.qty },
        price: Number(listing.price),
        sellerGold,
        remainingItems: items,
        stallClosed: items.length === 0,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async logTransaction(entry) {
    try {
      await this.pool.query(
        `INSERT INTO market_transactions (kind, buyer_id, seller_id, item_id, qty, gold, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          entry.kind, entry.buyerId ?? null, entry.sellerId ?? null, entry.itemId ?? null,
          entry.qty ?? 1, entry.gold ?? 0, entry.meta ?? {},
        ],
      );
    } catch (err) {
      console.error('[pg] no se pudo registrar transacción:', err.message);
    }
  }

  async snapshotCharacter(character) {
    try {
      const state = clone(character);
      delete state.stall;
      await this.pool.query(
        `INSERT INTO character_snapshots (character_id, level, gold, state)
         VALUES ($1,$2,$3,$4)`,
        [character.id, character.level, character.gold, state],
      );
    } catch (err) {
      console.error('[pg] snapshot falló:', err.message);
    }
  }
}
