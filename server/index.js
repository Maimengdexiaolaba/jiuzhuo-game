import http from 'node:http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import crypto from 'node:crypto';
import path from 'node:path';

import { PORT, HOST, PUBLIC_DIR, GUEST_TTL } from './config.js';
import { Users, Sessions, Matches, seedAdmin } from './db.js';
import { listGames, getGame } from './games/registry.js';
import { RoomManager } from './rooms.js';

seedAdmin();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: true, credentials: true },
  pingInterval: 20000,
  pingTimeout: 25000,
  maxHttpBufferSize: 1e6,
});

/** 游客临时会话（仅存在于内存，退出即清空） */
const guestSessions = new Map();
/** 游客临时 token -> userId，用于页面刷新后恢复座位 */
const guestTokens = new Map();
/** userId -> socketId */
const userSockets = new Map();

const rooms = new RoomManager({
  onUpdate(room) {
    broadcastRoom(room);
  },
  onListChange(list) {
    io.emit('lobby:rooms', list);
  },
});

function guestName() {
  return `游客${Math.floor(1000 + Math.random() * 9000)}`;
}

function makeGuest(name) {
  const id = `guest_${crypto.randomUUID()}`;
  const user = {
    id,
    username: id,
    displayName: (name || guestName()).slice(0, 16),
    isAdmin: false,
    isGuest: true,
    prefs: { lastGame: 'tuibingzi', erbaMax: false, botFill: true },
  };
  guestSessions.set(id, { user, at: Date.now() });
  return user;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: !!user.isAdmin,
    isGuest: !!user.isGuest,
    prefs: user.prefs,
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    if (p.isBot || !p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) {
      sock.emit('room:state', room.serializeFor(p.id));
    }
  }
  if (room.pendingNotice) {
    for (const p of room.players) {
      if (p.isBot || !p.socketId) continue;
      io.sockets.sockets.get(p.socketId)?.emit('toast', {
        type: 'warn',
        message: room.pendingNotice,
      });
    }
    room.pendingNotice = null;
  }
}

function currentRoomOf(socket) {
  const roomId = socket.data.roomId;
  return roomId ? rooms.get(roomId) : null;
}

function leaveCurrentRoom(socket) {
  const room = currentRoomOf(socket);
  if (!room || !socket.data.user) return;
  const user = socket.data.user;
  room.removePlayer(user.id);
  socket.data.roomId = null;
  socket.leave(`room:${room.id}`);
  if (room.players.length) {
    broadcastRoom(room);
    rooms.notifyList();
  }
}

async function attachUser(socket, user, token) {
  const prev = socket.data.user;
  if (prev && prev.id !== user.id) {
    // 身份切换：先离开当前房间
    leaveCurrentRoom(socket);
  }
  socket.data.user = user;
  socket.data.token = token || null;
  userSockets.set(user.id, socket.id);
  socket.join(`user:${user.id}`);

  const roomId = socket.data.roomId;
  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      const existing = room.findPlayer(user.id);
      if (existing) {
        existing.socketId = socket.id;
        existing.connected = true;
        existing.autoPilot = false;
        broadcastRoom(room);
      }
    }
  }
  socket.emit('auth:ok', { user: publicUser(user), token: token || null });
  socket.emit('lobby:rooms', rooms.list());
  socket.emit('lobby:games', listGames());
}

io.on('connection', (socket) => {
  socket.data.user = null;
  socket.data.roomId = null;

  socket.emit('lobby:games', listGames());
  socket.emit('lobby:rooms', rooms.list());

  const withUser = (fn) => (payload, ack) => {
    try {
      if (!socket.data.user) {
        socket.emit('auth:required');
        if (typeof ack === 'function') ack({ error: '请先登录或使用游客模式' });
        return;
      }
      const result = fn(payload || {}, socket.data.user, socket) || {};
      if (typeof ack === 'function') ack(result);
    } catch (err) {
      console.error('[socket] handler error', err);
      if (typeof ack === 'function') ack({ error: '服务器开小差了，请重试' });
    }
  };

  /* ---------------- 认证 ---------------- */

  socket.on('auth:guest', (payload, ack) => {
    const name = String(payload?.name || '').trim().slice(0, 16);
    const user = makeGuest(name || undefined);
    const token = `g_${crypto.randomBytes(16).toString('hex')}`;
    guestTokens.set(token, user.id);
    attachUser(socket, user, token);
    if (typeof ack === 'function') ack({ ok: true, user: publicUser(user), token });
  });

  socket.on('auth:login', (payload, ack) => {
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    if (!username || !password) {
      if (typeof ack === 'function') ack({ error: '请输入账号与密码' });
      return;
    }
    const res = Users.verify(username, password);
    if (res.error) {
      if (typeof ack === 'function') ack({ error: res.error });
      return;
    }
    Users.touchLogin(res.user.id);
    const token = Sessions.create(res.user.id);
    attachUser(socket, res.user, token);
    if (typeof ack === 'function') ack({ ok: true, user: publicUser(res.user), token });
  });

  socket.on('auth:register', (payload, ack) => {
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    const displayName = String(payload?.displayName || username).trim();

    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,16}$/.test(username)) {
      if (typeof ack === 'function') ack({ error: '账号需为 3~16 位中英文、数字或下划线' });
      return;
    }
    if (password.length < 3) {
      if (typeof ack === 'function') ack({ error: '密码至少 3 位' });
      return;
    }
    if (Users.byUsername(username)) {
      if (typeof ack === 'function') ack({ error: '该账号已存在' });
      return;
    }
    const user = Users.create({ username, password, displayName: displayName || username });
    Users.touchLogin(user.id);
    const token = Sessions.create(user.id);
    attachUser(socket, user, token);
    if (typeof ack === 'function') ack({ ok: true, user: publicUser(user), token });
  });

  socket.on('auth:restore', (payload, ack) => {
    const token = String(payload?.token || '');

    // 游客临时 token
    if (token.startsWith('g_')) {
      const uid = guestTokens.get(token);
      const session = uid ? guestSessions.get(uid) : null;
      if (!session) {
        guestTokens.delete(token);
        if (typeof ack === 'function') ack({ error: '游客会话已结束' });
        return;
      }
      session.at = Date.now();
      attachUser(socket, session.user, token);
      if (typeof ack === 'function') ack({ ok: true, user: publicUser(session.user), token });
      return;
    }

    const user = Sessions.resolve(token);
    if (!user) {
      if (typeof ack === 'function') ack({ error: '登录状态已失效' });
      return;
    }
    if (user.disabled) {
      Sessions.destroy(token);
      if (typeof ack === 'function') ack({ error: '该账号已被管理员停用' });
      return;
    }
    attachUser(socket, user, token);
    if (typeof ack === 'function') ack({ ok: true, user: publicUser(user), token });
  });

  socket.on('auth:logout', (payload, ack) => {
    const token = socket.data.token || payload?.token;
    if (token && token.startsWith('g_')) {
      const uid = guestTokens.get(token);
      guestTokens.delete(token);
      if (uid) guestSessions.delete(uid);
    } else if (token) {
      Sessions.destroy(token);
    }
    leaveCurrentRoom(socket);
    if (socket.data.user) {
      userSockets.delete(socket.data.user.id);
      if (socket.data.user.isGuest) guestSessions.delete(socket.data.user.id);
    }
    socket.data.user = null;
    socket.data.token = null;
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('me:rename', (payload, ack) => {
    const user = socket.data.user;
    if (!user) return ack?.({ error: '请先登录' });
    if (!user.isGuest) return ack?.({ error: '注册用户请到个人设置中修改昵称' });
    const name = String(payload?.name || '').trim().slice(0, 16);
    if (!name) return ack?.({ error: '昵称不能为空' });
    user.displayName = name;
    const room = currentRoomOf(socket);
    if (room) {
      const p = room.findPlayer(user.id);
      if (p) p.name = name;
      broadcastRoom(room);
    }
    ack?.({ ok: true, user: publicUser(user) });
  });

  socket.on('me:prefs', (payload, ack) => {
    const user = socket.data.user;
    if (!user) return ack?.({ error: '请先登录' });
    const patch = {};
    if (payload?.lastGame) patch.lastGame = String(payload.lastGame).slice(0, 32);
    if (payload?.erbaMax !== undefined) patch.erbaMax = !!payload.erbaMax;
    if (payload?.botFill !== undefined) patch.botFill = !!payload.botFill;
    user.prefs = { ...user.prefs, ...patch };
    if (!user.isGuest) {
      try {
        Users.savePrefs(user.id, patch);
      } catch (err) {
        console.error('[prefs] save failed', err);
      }
    }
    ack?.({ ok: true, prefs: user.prefs });
  });

  socket.on('me:stats', (payload, ack) => {
    const user = socket.data.user;
    if (!user) return ack?.({ error: '请先登录' });
    if (user.isGuest) {
      return ack?.({ ok: true, guest: true, stats: [], window: 100 });
    }
    const names = new Map(listGames().map((g) => [g.id, g.name]));
    const stats = Matches.statsFor(user.id).map((row) => ({
      ...row,
      gameName: names.get(row.gameId) || row.gameId,
      recent: Matches.recent(user.id, row.gameId, 20),
    }));
    ack?.({ ok: true, stats, window: 100 });
  });

  /* ---------------- 大厅 / 房间 ---------------- */

  socket.on('lobby:list', (payload, ack) => {
    ack?.({ rooms: rooms.list(), games: listGames() });
  });

  socket.on(
    'room:create',
    withUser((payload, user, sock) => {
      if (!getGame(payload.gameId)) return { error: '游戏类型无效' };
      leaveCurrentRoom(sock);
      const res = rooms.create({
        gameId: payload.gameId,
        config: payload.config || {},
        host: user,
      });
      if (res.error) return { error: res.error };
      const room = res.room;
      const player = room.findPlayer(user.id);
      player.socketId = sock.id;
      sock.data.roomId = room.id;
      sock.join(`room:${room.id}`);
      broadcastRoom(room);
      rooms.notifyList();
      return { ok: true, roomId: room.id };
    })
  );

  socket.on(
    'room:join',
    withUser((payload, user, sock) => {
      const room = rooms.get(payload.roomId);
      if (!room) return { error: '房间不存在或已解散' };
      if (room.findPlayer(user.id)) {
        const p = room.findPlayer(user.id);
        p.socketId = sock.id;
        p.connected = true;
        p.autoPilot = false;
        sock.data.roomId = room.id;
        sock.join(`room:${room.id}`);
        broadcastRoom(room);
        return { ok: true, roomId: room.id };
      }
      if (room.state) return { error: '牌局进行中，暂时无法加入' };
      if (room.isFull) return { error: '房间已满员' };

      leaveCurrentRoom(sock);
      const res = room.addPlayer(user);
      if (res.error) return { error: res.error };
      res.player.socketId = sock.id;
      sock.data.roomId = room.id;
      sock.join(`room:${room.id}`);
      broadcastRoom(room);
      rooms.notifyList();
      return { ok: true, roomId: room.id };
    })
  );

  socket.on(
    'room:leave',
    withUser((payload, user, sock) => {
      leaveCurrentRoom(sock);
      rooms.notifyList();
      return { ok: true };
    })
  );

  socket.on(
    'room:ready',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      const res = room.setReady(user.id, payload.ready);
      if (res.error) return { error: res.error };
      room.touch();
      return { ok: true };
    })
  );

  socket.on(
    'room:addBot',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      const res = room.addBot(user.id);
      if (res.error) return { error: res.error };
      room.touch();
      rooms.notifyList();
      return { ok: true };
    })
  );

  socket.on(
    'room:removeBot',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      const res = room.removeBot(user.id, payload.seat);
      if (res.error) return { error: res.error };
      if (!res.destroyed) {
        room.touch();
        rooms.notifyList();
      }
      return { ok: true };
    })
  );

  socket.on(
    'room:fillBots',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      if (user.id !== room.hostId) return { error: '只有房主可以添加机器人' };
      let added = 0;
      while (!room.isFull && added < 10) {
        const res = room.addBot(user.id);
        if (res.error) return { error: res.error };
        added += 1;
      }
      room.touch();
      rooms.notifyList();
      return { ok: true, added };
    })
  );

  socket.on(
    'room:kick',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      const res = room.kick(user.id, payload.playerId);
      if (res.error) return { error: res.error };
      if (res.kickedId) {
        const targetSocketId = userSockets.get(res.kickedId);
        if (targetSocketId) io.sockets.sockets.get(targetSocketId)?.emit('room:kicked');
      }
      if (room.players.length) {
        room.touch();
        rooms.notifyList();
      }
      return { ok: true };
    })
  );

  socket.on(
    'room:config',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      const res = room.updateConfig(user.id, payload.patch || {});
      if (res.error) return { error: res.error };
      room.touch();
      rooms.notifyList();
      return { ok: true };
    })
  );

  socket.on(
    'game:action',
    withUser((payload, user, sock) => {
      const room = currentRoomOf(sock);
      if (!room) return { error: '你不在任何房间中' };
      const player = room.findPlayer(user.id);
      if (!player) return { error: '你不在该房间中' };
      if (!room.state) return { error: '牌局尚未开始' };
      const res = room.dispatch(player.seat, String(payload.type || ''), payload.payload);
      if (res.error) return { error: res.error };
      return { ok: true };
    })
  );

  /* ---------------- 管理后台 ---------------- */

  function requireAdmin(user) {
    if (!user || !user.isAdmin) return { error: '需要管理员权限' };
    return null;
  }

  socket.on('admin:list', (payload, ack) => {
    const guard = requireAdmin(socket.data.user);
    if (guard) return ack?.(guard);
    const names = new Map(listGames().map((g) => [g.id, g.name]));
    const users = Users.list().map((u) => ({
      ...u,
      stats: Matches.statsFor(u.id).map((row) => ({
        ...row,
        gameName: names.get(row.gameId) || row.gameId,
      })),
    }));
    ack?.({
      ok: true,
      users,
      online: [...userSockets.keys()].filter((id) => id && !id.startsWith('guest_')).length,
      rooms: rooms.list().length,
    });
  });

  socket.on('admin:update', (payload, ack) => {
    const guard = requireAdmin(socket.data.user);
    if (guard) return ack?.(guard);
    const target = Users.byId(payload?.id);
    if (!target) return ack?.({ error: '用户不存在' });

    const me = socket.data.user;
    if (payload.isAdmin === false && target.id === me.id) {
      return ack?.({ error: '不能取消自己的管理员权限' });
    }
    if (payload.disabled === true && target.id === me.id) {
      return ack?.({ error: '不能停用自己的账号' });
    }
    if (payload.username) {
      const uname = String(payload.username).trim();
      if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,16}$/.test(uname)) {
        return ack?.({ error: '账号需为 3~16 位中英文、数字或下划线' });
      }
      if (uname !== target.username) {
        const res = Users.setUsername(target.id, uname);
        if (res.error) return ack?.(res);
      }
    }
    if (payload.password) {
      if (String(payload.password).length < 3) return ack?.({ error: '密码至少 3 位' });
    }
    const updated = Users.update(target.id, {
      displayName: payload.displayName,
      password: payload.password,
      isAdmin: payload.isAdmin,
      disabled: payload.disabled,
    });
    if (payload.password) Sessions.destroyForUser(target.id);
    ack?.({ ok: true, user: updated, users: Users.list() });
  });

  socket.on('admin:create', (payload, ack) => {
    const guard = requireAdmin(socket.data.user);
    if (guard) return ack?.(guard);
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,16}$/.test(username)) {
      return ack?.({ error: '账号需为 3~16 位中英文、数字或下划线' });
    }
    if (password.length < 3) return ack?.({ error: '密码至少 3 位' });
    if (Users.byUsername(username)) return ack?.({ error: '该账号已存在' });
    Users.create({
      username,
      password,
      displayName: String(payload.displayName || username).trim(),
      isAdmin: !!payload.isAdmin,
    });
    ack?.({ ok: true, users: Users.list() });
  });

  socket.on('admin:delete', (payload, ack) => {
    const guard = requireAdmin(socket.data.user);
    if (guard) return ack?.(guard);
    const target = Users.byId(payload?.id);
    if (!target) return ack?.({ error: '用户不存在' });
    if (target.id === socket.data.user.id) return ack?.({ error: '不能删除自己的账号' });
    if (target.username === 'admin') return ack?.({ error: '内置管理员账号不可删除' });
    Sessions.destroyForUser(target.id);
    Users.remove(target.id);
    ack?.({ ok: true, users: Users.list() });
  });

  /* ---------------- 断开 ---------------- */

  socket.on('disconnect', () => {
    const user = socket.data.user;
    if (!user) return;
    if (userSockets.get(user.id) === socket.id) userSockets.delete(user.id);

    const room = currentRoomOf(socket);
    if (room) {
      const player = room.findPlayer(user.id);
      if (player) {
        player.socketId = null;
        room.setConnected(user.id, false);
        broadcastRoom(room);
        rooms.notifyList();
        setTimeout(() => {
          const stillRoom = rooms.get(room.id);
          if (!stillRoom) return;
          const p = stillRoom.findPlayer(user.id);
          if (!p || p.connected) return;
          if (!stillRoom.state) {
            stillRoom.removePlayer(user.id);
            if (stillRoom.players.length) {
              broadcastRoom(stillRoom);
              rooms.notifyList();
            }
          }
        }, 45000);
      }
    }

    if (user.isGuest) {
      setTimeout(() => {
        const g = guestSessions.get(user.id);
        if (g && Date.now() - g.at > 0) guestSessions.delete(user.id);
      }, 60000);
    }
  });
});

/* 清理任务 */
setInterval(() => {
  rooms.cleanup();
  const now = Date.now();
  for (const [id, info] of guestSessions) {
    if (now - info.at > GUEST_TTL) guestSessions.delete(id);
  }
  for (const [token, uid] of guestTokens) {
    if (!guestSessions.has(uid)) guestTokens.delete(token);
  }
}, 1000 * 60 * 5).unref?.();

/* SPA 兜底 */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log('──────────────────────────────────────────');
  console.log('  酒桌游戏 · 推饼子');
  console.log(`  服务已启动: http://${HOST}:${PORT}`);
  console.log('  局域网访问: http://<本机IP>:9876');
  console.log('──────────────────────────────────────────');
});

export { app, server, io, rooms };
