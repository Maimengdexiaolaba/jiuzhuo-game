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
