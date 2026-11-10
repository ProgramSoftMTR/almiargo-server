-- ============================================================
-- Almiargo Online — Esquema PostgreSQL
-- Diseño: núcleo relacional + snapshot JSONB del personaje.
-- El estado completo se escribe en una sola transacción (rápido y atómico)
-- y las tablas relacionales permiten reportes, ledger y consultas.
-- ============================================================

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Migracion segura para bases creadas antes del login por correo.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uniq ON accounts(lower(email));

CREATE TABLE IF NOT EXISTS characters (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  xp          BIGINT NOT NULL DEFAULT 0,
  gold        BIGINT NOT NULL DEFAULT 0,
  hp          INTEGER NOT NULL DEFAULT 100,
  mp          INTEGER NOT NULL DEFAULT 50,
  x           REAL NOT NULL DEFAULT 40,
  y           REAL NOT NULL DEFAULT 42,
  dir         TEXT NOT NULL DEFAULT 'down',
  skull       TEXT NOT NULL DEFAULT 'none',
  skull_until BIGINT NOT NULL DEFAULT 0,
  -- Estado completo: inventario, equipamiento, skills, clan, tienda AFK.
  state       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS characters_account_uniq ON characters(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_uniq ON characters(lower(name));
CREATE INDEX IF NOT EXISTS characters_gold_idx ON characters(gold DESC);

-- Snapshots históricos: recuperación ante corrupción del estado vivo.
CREATE TABLE IF NOT EXISTS character_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  level        INTEGER NOT NULL,
  gold         BIGINT NOT NULL,
  state        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS character_snapshots_char_idx
  ON character_snapshots(character_id, created_at DESC);

-- Tiendas de jugador (persisten aunque el jugador se desconecte = AFK/offline).
CREATE TABLE IF NOT EXISTS shop_stalls (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  owner_name   TEXT NOT NULL,
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_stalls_pos_idx ON shop_stalls(x, y);

-- Ledger económico: nunca se actualiza oro sin dejar rastro.
CREATE TABLE IF NOT EXISTS market_transactions (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,            -- npc_buy | npc_sell | stall_buy | quest | death
  buyer_id     TEXT REFERENCES characters(id) ON DELETE SET NULL,
  seller_id    TEXT REFERENCES characters(id) ON DELETE SET NULL,
  item_id      TEXT,
  qty          INTEGER NOT NULL DEFAULT 1,
  gold         BIGINT NOT NULL DEFAULT 0,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_tx_created_idx ON market_transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS login_events (
  id           BIGSERIAL PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices declarativos para consultas de ranking (se mantienen por app).
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  category   TEXT NOT NULL,
  character_id TEXT NOT NULL,
  value      BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category, character_id)
);
