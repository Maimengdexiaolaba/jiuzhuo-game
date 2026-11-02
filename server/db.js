import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DATA_DIR, ADMIN_USERNAME, ADMIN_PASSWORD } from './config.js';

/**
 * 使用 Node 内置的 node:sqlite（Node >= 22.5）。
 * 不依赖任何原生编译产物，因此 x86 / ARM NAS 均可直接构建运行。
 */
const db = new DatabaseSync(path.join(DATA_DIR, 'jiuzhuo.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  prefs         TEXT NOT NULL DEFAULT '{}',
  games_played  INTEGER NOT NULL DEFAULT 0,
  cups_won      INTEGER NOT NULL DEFAULT 0,
  cups_lost     INTEGER NOT NULL DEFAULT 0,
  points        INTEGER NOT NULL DEFAULT 1000,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 逐局战绩，仅保留每位玩家每款游戏最近 100 场
CREATE TABLE IF NOT EXISTS match_records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  game_id    TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  net        INTEGER NOT NULL DEFAULT 0,
  cups_won   INTEGER NOT NULL DEFAULT 0,
  cups_lost  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_user_game ON match_records(user_id, game_id, id);

-- 玩家背包：商城兑换的道具先入背包，使用后才生效
CREATE TABLE IF NOT EXISTS inventory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  acquired_at INTEGER NOT NULL,
  expires_at  INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);

-- 商城商品（管理员可改价 / 上下架）
CREATE TABLE IF NOT EXISTS shop_items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  desc          TEXT NOT NULL DEFAULT '',
  price         INTEGER NOT NULL DEFAULT 0,
  category      TEXT NOT NULL DEFAULT 'misc',   -- cardFace / theme / bgm / sfx / misc
  type          TEXT NOT NULL DEFAULT 'consumable', -- consumable / permanent / timed
  duration_days INTEGER,                        -- type=timed 时的有效天数
  asset         TEXT,                           -- 皮肤类商品对应的资源 key
  enabled       INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
`);

// 数据库迁移：为已有数据库补 points 字段（积分商城）
try {
  const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (!cols.includes('points')) {
    db.exec(`ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 1000`);
  }
} catch (err) {
  console.error('[db] 迁移 points 字段失败', err);
}

/** 默认皮肤配置：所有游戏默认「经典牌面 / 默认主题 / 默认音乐音效」 */
export const DEFAULT_SKINS = {
  cardFace: 'classic', // classic | xihua
  theme: 'default', // default | warm
  bgm: 'default',
  sfx: 'default',
};

function normalizeSkins(raw) {
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  return { ...DEFAULT_SKINS, ...parsed };
}

// 数据库迁移：为已有数据库补 skins 字段（皮肤系统）
try {
  const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (!cols.includes('skins')) {
    db.exec(`ALTER TABLE users ADD COLUMN skins TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_SKINS)}'`);
  }
} catch (err) {
  console.error('[db] 迁移 skins 字段失败', err);
}

const now = () => Date.now();

const DEFAULT_PREFS = {
  lastGame: 'tuibingzi',
  erbaMax: false,
  botFill: true,
};

const MATCH_WINDOW = 100;

function normalizePrefs(raw) {
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  return { ...DEFAULT_PREFS, ...parsed };
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: !!row.is_admin,
    disabled: !!row.disabled,
    prefs: normalizePrefs(row.prefs),
    gamesPlayed: row.games_played,
    cupsWon: row.cups_won,
    cupsLost: row.cups_lost,
    points: row.points ?? 1000,
    skins: normalizeSkins(row.skins),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    isGuest: false,
  };
}

export const Users = {
  create({ username, password, displayName, isAdmin = false }) {
    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, is_admin, prefs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      username,
      displayName || username,
      hash,
      isAdmin ? 1 : 0,
      JSON.stringify(DEFAULT_PREFS),
      now()
    );
    return this.byId(id);
  },

  byId(id) {
    return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  },

  byUsername(username) {
    return toUser(
      db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username)
    );
  },

  rawPasswordHash(id) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
    return row ? row.password_hash : null;
  },

  verify(username, password) {
    const row = db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);
    if (!row) return { error: '账号或密码不正确' };
    if (!bcrypt.compareSync(password, row.password_hash)) {
      return { error: '账号或密码不正确' };
    }
    if (row.disabled) return { error: '该账号已被管理员停用' };
    return { user: toUser(row) };
  },

  list() {
    return db
      .prepare('SELECT * FROM users ORDER BY is_admin DESC, created_at ASC')
      .all()
      .map(toUser);
  },

  update(id, patch) {
    const fields = [];
    const values = [];
    if (patch.displayName !== undefined) {
      fields.push('display_name = ?');
      values.push(String(patch.displayName).slice(0, 24) || '玩家');
    }
    if (patch.password) {
      fields.push('password_hash = ?');
      values.push(bcrypt.hashSync(String(patch.password), 10));
    }
    if (patch.isAdmin !== undefined) {
      fields.push('is_admin = ?');
      values.push(patch.isAdmin ? 1 : 0);
    }
    if (patch.disabled !== undefined) {
      fields.push('disabled = ?');
      values.push(patch.disabled ? 1 : 0);
    }
    if (patch.prefs !== undefined) {
      fields.push('prefs = ?');
      values.push(JSON.stringify(normalizePrefs(JSON.stringify(patch.prefs))));
    }
    if (!fields.length) return this.byId(id);
    values.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.byId(id);
  },

  renameCheck(id, username) {
    const row = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);
    if (row && row.id !== id) return { error: '该账号名已被占用' };
    return { ok: true };
  },

  setUsername(id, username) {
    const conflict = this.renameCheck(id, username);
    if (conflict.error) return conflict;
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
    return { ok: true, user: this.byId(id) };
  },

  remove(id) {
    db.prepare('DELETE FROM match_records WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM inventory WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },

  /** 调整积分（delta 可为负，但不低于 0） */
  addPoints(id, delta) {
    const d = Math.round(Number(delta) || 0);
    if (!d) return this.byId(id);
    const cur = this.byId(id);
    if (!cur) return null;
    const next = Math.max(0, (cur.points ?? 1000) + d);
    db.prepare('UPDATE users SET points = ? WHERE id = ?').run(next, id);
    return this.byId(id);
  },

  /** 直接设置积分（管理员用） */
  setPoints(id, value) {
    const v = Math.max(0, Math.round(Number(value) || 0));
    db.prepare('UPDATE users SET points = ? WHERE id = ?').run(v, id);
    return this.byId(id);
  },

  /** 读取皮肤配置 */
  getSkins(id) {
    const row = db.prepare('SELECT skins FROM users WHERE id = ?').get(id);
    return normalizeSkins(row?.skins);
  },

  /** 更新皮肤配置（局部 patch，返回完整配置） */
  setSkins(id, patch) {
    const merged = normalizeSkins(JSON.stringify({ ...this.getSkins(id), ...(patch || {}) }));
    db.prepare('UPDATE users SET skins = ? WHERE id = ?').run(JSON.stringify(merged), id);
    return merged;
  },

  touchLogin(id) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id);
  },

  addGameResult(id, { cupsWon = 0, cupsLost = 0 } = {}) {
    if (!id) return;
    db.prepare(
      `UPDATE users SET games_played = games_played + 1,
        cups_won = cups_won + ?, cups_lost = cups_lost + ? WHERE id = ?`
    ).run(Math.max(0, Math.round(cupsWon)), Math.max(0, Math.round(cupsLost)), id);
  },

  savePrefs(id, prefs) {
    const merged = normalizePrefs(JSON.stringify({ ...this.byId(id)?.prefs, ...prefs }));
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(merged), id);
    return merged;
  },

  count() {
    return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  },
};


/**
 * 逐局战绩：每位玩家每款游戏仅保留最近 100 场，超出自动清理。
 */
export const Matches = {
  record(userId, gameId, { outcome, net = 0, cupsWon = 0, cupsLost = 0 }) {
    if (!userId || !gameId) return;
    db.prepare(
      `INSERT INTO match_records (user_id, game_id, outcome, net, cups_won, cups_lost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(String(userId), String(gameId), String(outcome), Math.round(net),
      Math.round(cupsWon), Math.round(cupsLost), now());

    // 只保留最近 100 场，避免数据无限增长
    db.prepare(
      `DELETE FROM match_records
       WHERE user_id = ? AND game_id = ?
         AND id NOT IN (
           SELECT id FROM match_records
           WHERE user_id = ? AND game_id = ?
           ORDER BY id DESC LIMIT ?
         )`
    ).run(String(userId), String(gameId), String(userId), String(gameId), MATCH_WINDOW);
  },

  /** 汇总某位玩家各游戏的百场战绩 */
  statsFor(userId) {
    if (!userId) return [];
    const rows = db
      .prepare(
        `SELECT game_id,
                COUNT(*)                      AS played,
                SUM(CASE WHEN outcome='win'  THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN outcome='lose' THEN 1 ELSE 0 END) AS losses,
                SUM(CASE WHEN outcome='draw' THEN 1 ELSE 0 END) AS draws,
                SUM(net)                      AS net,
                SUM(cups_won)                 AS cups_won,
                SUM(cups_lost)                AS cups_lost,
                MAX(created_at)               AS last_at
         FROM match_records
         WHERE user_id = ?
         GROUP BY game_id`
      )
      .all(String(userId));

    return rows.map((r) => {
      const played = r.played || 0;
      return {
        gameId: r.game_id,
        played,
        wins: r.wins || 0,
        losses: r.losses || 0,
        draws: r.draws || 0,
        net: r.net || 0,
        cupsWon: r.cups_won || 0,
        cupsLost: r.cups_lost || 0,
        winRate: played ? Math.round(((r.wins || 0) / played) * 1000) / 10 : 0,
        lastAt: r.last_at || null,
        window: MATCH_WINDOW,
      };
    });
  },

  /** 最近 N 场的原始记录（用于胜率趋势） */
  recent(userId, gameId, limit = 20) {
    return db
      .prepare(
        `SELECT outcome, net, created_at FROM match_records
         WHERE user_id = ? AND game_id = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(String(userId), String(gameId), limit)
      .map((r) => ({ outcome: r.outcome, net: r.net, at: r.created_at }));
  },

  clearFor(userId) {
    db.prepare('DELETE FROM match_records WHERE user_id = ?').run(String(userId));
  },

  total() {
    return db.prepare('SELECT COUNT(*) AS c FROM match_records').get().c;
  },
};

/**
 * 玩家背包：商城兑换的道具先入背包，玩家「使用」后才生效。
 * - consumable（一次性）：使用后生效并消失
 * - permanent（永久）：使用后登记为已拥有，长期生效（可切换）
 * - timed（限时）：有 expires_at，到期失效
 */
export const Inventory = {
  /** 放入背包（同道具且无过期时叠加数量） */
  add(userId, itemId, quantity = 1, expiresAt = null) {
    const qty = Math.max(1, Math.round(Number(quantity) || 1));
    if (!expiresAt) {
      const exist = db
        .prepare('SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ? AND expires_at IS NULL')
        .get(userId, itemId);
      if (exist) {
        db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(qty, exist.id);
        return this.list(userId);
      }
    }
    db.prepare(
      'INSERT INTO inventory (user_id, item_id, quantity, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, itemId, qty, now(), expiresAt || null);
    return this.list(userId);
  },

  /** 背包列表（附带商品信息与过期状态） */
  list(userId) {
    const items = ShopItems.map();
    const rows = db
      .prepare('SELECT * FROM inventory WHERE user_id = ? ORDER BY acquired_at DESC')
      .all(userId);
    const t = now();
    return rows
      .map((r) => {
        const def = items[r.item_id] || {};
        return {
          itemId: r.item_id,
          quantity: r.quantity,
          acquiredAt: r.acquired_at,
          expiresAt: r.expires_at,
          expired: !!(r.expires_at && r.expires_at < t),
          name: def.name || r.item_id,
          desc: def.desc || '',
          category: def.category || 'misc',
          type: def.type || 'consumable',
          asset: def.asset || null,
        };
      })
      .filter((r) => !r.expired);
  },

  /** 取用一个（数量 -1，用尽则删除该行） */
  take(userId, itemId) {
    const row = db
      .prepare('SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ? ORDER BY id ASC')
      .get(userId, itemId);
    if (!row) return false;
    if (row.quantity > 1) {
      db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(row.id);
    } else {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(row.id);
    }
    return true;
  },

  /** 是否拥有某件（永久类用它判断） */
  has(userId, itemId) {
    const row = db
      .prepare('SELECT 1 AS ok FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1')
      .get(userId, itemId);
    return !!row;
  },

  clearFor(userId) {
    db.prepare('DELETE FROM inventory WHERE user_id = ?').run(userId);
  },
};

/** 商城商品（存库，管理员可改价 / 上下架） */
export const ShopItems = {
  list({ onlyEnabled = true } = {}) {
    const sql = onlyEnabled
      ? 'SELECT * FROM shop_items WHERE enabled = 1 ORDER BY sort_order ASC, price ASC'
      : 'SELECT * FROM shop_items ORDER BY sort_order ASC, price ASC';
    return db.prepare(sql).all().map((r) => ({
      id: r.id,
      name: r.name,
      desc: r.desc,
      price: r.price,
      category: r.category,
      type: r.type,
      durationDays: r.duration_days,
      asset: r.asset,
      enabled: !!r.enabled,
    }));
  },

  map() {
    const out = {};
    for (const it of this.list({ onlyEnabled: false })) out[it.id] = it;
    return out;
  },

  byId(id) {
    const r = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      desc: r.desc,
      price: r.price,
      category: r.category,
      type: r.type,
      durationDays: r.duration_days,
      asset: r.asset,
      enabled: !!r.enabled,
    };
  },

  /** 管理员改价 / 上下架 / 改名 */
  update(id, patch = {}) {
    const cur = this.byId(id);
    if (!cur) return null;
    const fields = [];
    const values = [];
    if (patch.price !== undefined) {
      fields.push('price = ?');
      values.push(Math.max(0, Math.round(Number(patch.price) || 0)));
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(String(patch.name).slice(0, 32));
    }
    if (patch.desc !== undefined) {
      fields.push('desc = ?');
      values.push(String(patch.desc).slice(0, 120));
    }
    if (!fields.length) return cur;
    values.push(id);
    db.prepare(`UPDATE shop_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.byId(id);
  },

  /** 初始化默认商品（仅当表为空时写入） */
  seed() {
    const count = db.prepare('SELECT COUNT(*) AS c FROM shop_items').get().c;
    if (count > 0) return;
    const defaults = [
      {
        id: 'clear_stats',
        name: '胜率清零卡',
        desc: '使用后清空你的百场胜率记录（所有游戏）',
        price: 50,
        category: 'misc',
        type: 'consumable',
        asset: null,
        sort: 10,
      },
      {
        id: 'card_face_xihua',
        name: '西游记牌面',
        desc: '西游记角色插画牌面，购买后可在设置中切换，永久有效',
        price: 100,
        category: 'cardFace',
        type: 'permanent',
        asset: 'xihua',
        sort: 20,
      },
      {
        id: 'theme_warm',
        name: '暖阳主题',
        desc: '暖橙 / 木质色调主题皮肤，购买后可在设置中切换，永久有效',
        price: 120,
        category: 'theme',
        type: 'permanent',
        asset: 'warm',
        sort: 30,
      },
    ];
    const stmt = db.prepare(
      `INSERT INTO shop_items (id, name, desc, price, category, type, asset, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of defaults) {
      stmt.run(d.id, d.name, d.desc, d.price, d.category, d.type, d.asset, d.sort);
    }
  },
};

export const Sessions = {
  create(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)'
    ).run(token, userId, now(), now());
    return token;
  },
  resolve(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!row) return null;
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now(), token);
    return Users.byId(row.user_id);
  },
  destroy(token) {
    if (!token) return;
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },
  destroyForUser(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },
};

export function seedAdmin() {
  ShopItems.seed();
  const exists = Users.byUsername(ADMIN_USERNAME);
  if (!exists) {
    Users.create({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      displayName: '管理员',
      isAdmin: true,
    });
    console.log(`[db] 已创建默认管理员账号 ${ADMIN_USERNAME}/${ADMIN_PASSWORD}`);
  }
}

export default db;
