import crypto from 'node:crypto';
import { getGame } from './games/registry.js';
import { Users, Matches } from './db.js';

const BOT_NAMES = [
  '阿饼', '幺鸡王', '老饕', '三筒', '九筒', '醉猫',
  '杯神', '小酌', '老白', '八两', '糊涂仙', '半斤',
];

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeRoomId(existing) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let id = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 4; i += 1) {
      id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    }
    if (!existing.has(id)) return id;
  }
  return crypto.randomUUID().slice(0, 6).toUpperCase();
}

let botSeq = 0;

export class Room {
  constructor({ id, gameId, config, host, onUpdate, onDestroy }) {
    this.id = id;
    this.gameId = gameId;
    this.game = getGame(gameId);
    this.config = this.game.normalizeConfig(config);
    this.hostId = host.id;
    this.players = [];
    this.spectators = []; // 观战者（不占座位）
    this.state = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.onUpdate = onUpdate;
    this.onDestroy = onDestroy;
    this.botTimers = new Map();
    this.roundSnapshot = null;
    this.addPlayer(host, { silent: true });
  }

  get capacity() {
    return this.config.playerCount;
  }

  get status() {
    return this.state ? 'playing' : 'waiting';
  }

  get isFull() {
    return this.players.length >= this.capacity;
  }

  findPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  playerBySeat(seat) {
    return this.players[seat] || null;
  }

  addPlayer(user, { silent = false } = {}) {
    const existing = this.findPlayer(user.id);
    if (existing) {
      existing.connected = true;
      existing.autoPilot = false;
      if (!silent) this.touch();
      return { ok: true, player: existing, rejoin: true };
    }
    if (this.state) return { error: '牌局进行中，暂时无法加入' };
    if (this.isFull) return { error: '房间已满员' };

    const player = {
      id: user.id,
      name: user.displayName || user.username || '玩家',
      isBot: false,
      isGuest: !!user.isGuest,
      isAdmin: !!user.isAdmin,
      ready: false,
      connected: true,
      autoPilot: false,
      socketId: null,
      seat: this.players.length,
      joinedAt: Date.now(),
    };
    this.players.push(player);
    if (!silent) this.touch();
    return { ok: true, player };
  }

  /* ---------------- 观战 ---------------- */

  findSpectator(id) {
    return this.spectators.find((s) => s.id === id) || null;
  }

  addSpectator(user) {
    if (this.findPlayer(user.id)) return { error: '你已在牌局中' };
    const existing = this.findSpectator(user.id);
    if (existing) {
      existing.connected = true;
      return { ok: true, spectator: existing };
    }
    const spectator = {
      id: user.id,
      name: user.displayName || user.username || '观众',
      isAdmin: !!user.isAdmin,
      connected: true,
      socketId: null,
    };
    this.spectators.push(spectator);
    return { ok: true, spectator };
  }

  removeSpectator(playerId) {
    const idx = this.spectators.findIndex((s) => s.id === playerId);
    if (idx === -1) return { error: '不在观战' };
    this.spectators.splice(idx, 1);
    return { ok: true };
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return { error: '玩家不在房间' };

    const [removed] = this.players.splice(idx, 1);
    this.players.forEach((p, i) => {
      p.seat = i;
    });

    if (!this.players.length) {
      this.dispose();
      return { ok: true, destroyed: true };
    }

    if (this.hostId === removed.id) {
      const nextHost = this.players.find((p) => !p.isBot);
      this.hostId = nextHost ? nextHost.id : this.players[0].id;
    }

    if (this.state) {
      // 中途离开：重排座位并复原为等待状态，避免状态错位卡死
      this.abortGame(`${removed.name} 离开了房间，本局已重置`);
    }

    this.touch();
    return { ok: true };
  }

  addBot(actorId) {
    if (actorId !== this.hostId) return { error: '只有房主可以添加机器人' };
    if (this.state) return { error: '牌局进行中无法添加机器人' };
    if (!this.config.botFill) return { error: '本房间未开启机器人补位' };
    if (this.isFull) return { error: '房间已满员' };

    const used = new Set(this.players.map((p) => p.name));
    let name = BOT_NAMES[botSeq % BOT_NAMES.length];
    let guard = 0;
    while (used.has(name) && guard < 40) {
      botSeq += 1;
      name = BOT_NAMES[botSeq % BOT_NAMES.length];
      guard += 1;
    }
    botSeq += 1;

    const bot = {
      id: `bot_${crypto.randomUUID().slice(0, 8)}`,
      name,
      isBot: true,
      isGuest: true,
      isAdmin: false,
      ready: true,
      connected: true,
      autoPilot: true,
      socketId: null,
      seat: this.players.length,
      joinedAt: Date.now(),
    };
    this.players.push(bot);
    this.touch();
    return { ok: true, player: bot };
  }

  removeBot(actorId, seat) {
    if (actorId !== this.hostId) return { error: '只有房主可以移除机器人' };
    if (this.state) return { error: '牌局进行中无法移除机器人' };
    const player = this.players[Number(seat)];
    if (!player || !player.isBot) return { error: '该座位不是机器人' };
    return this.removePlayer(player.id);
  }

  kick(actorId, playerId) {
    if (actorId !== this.hostId) return { error: '只有房主可以请离玩家' };
    if (playerId === this.hostId) return { error: '房主不能请离自己' };
    const target = this.findPlayer(playerId);
    if (!target) return { error: '玩家不在房间' };
    if (target.isBot) return this.removeBot(actorId, target.seat);
    this.removePlayer(playerId);
    return { ok: true, kickedId: playerId };
  }

  updateConfig(actorId, patch) {
    if (actorId !== this.hostId) return { error: '只有房主可以修改房间设置' };
    if (this.state) return { error: '牌局进行中无法修改设置' };
    const next = this.game.normalizeConfig({ ...this.config, ...patch });
    if (next.playerCount < this.players.length) {
      return { error: `当前已有 ${this.players.length} 人，人数不能低于此值` };
    }
    this.config = next;
    this.touch();
    return { ok: true };
  }

  setReady(playerId, ready) {
    const player = this.findPlayer(playerId);
    if (!player) return { error: '玩家不在房间' };
    if (player.isBot) return { error: '机器人无需操作' };
    if (this.state) return { error: '牌局进行中' };
    player.ready = !!ready;
    this.touch();
    return { ok: true };
  }

  canStart() {
    if (this.state) return { ok: false, reason: '已在牌局中' };
    if (!this.isFull) return { ok: false, reason: `还差 ${this.capacity - this.players.length} 人` };
    const notReady = this.players.filter((p) => !p.ready && !p.isBot);
    if (notReady.length) {
      return { ok: false, reason: `等待 ${notReady.map((p) => p.name).join('、')} 准备` };
    }
    return { ok: true };
  }

  startGame() {
    const check = this.canStart();
    if (!check.ok) return { error: check.reason };

    this.players.forEach((p, i) => {
      p.seat = i;
    });

    const hostSeat = Math.max(
      0,
      this.players.findIndex((p) => p.id === this.hostId)
    );

    this.state = this.game.createState({
      playerCount: this.players.length,
      config: this.config,
    });
    this.state.dealerSeat = hostSeat;
    this.roundSnapshot = null;

    // 庄家是该房间初始庄家（房主），其余为闲家
    this.lastActivity = Date.now();
    return { ok: true };
  }

  abortGame(reason) {
    this.clearBotTimers();
    this.state = null;
    this.roundSnapshot = null;
    this.players.forEach((p) => {
      p.ready = p.isBot;
      p.autoPilot = p.isBot;
    });
    this.lastActivity = Date.now();
    this.pendingNotice = reason || '牌局已重置';
  }

  clearBotTimers() {
    for (const timer of this.botTimers.values()) clearTimeout(timer);
    this.botTimers.clear();
  }

  setConnected(playerId, connected) {
    const player = this.findPlayer(playerId);
    if (!player) return;
    player.connected = connected;
    if (this.state) {
      // 掉线玩家由自动托管接手，避免牌局卡死；重新连上后自动关闭托管
      player.autoPilot = !connected;
    }
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
    this.autoStartIfPossible();
    this.broadcast();
    this.scheduleBots();
  }

  autoStartIfPossible() {
    if (this.state) return;
    if (this.canStart().ok) {
      this.startGame();
    }
  }

  broadcast() {
    if (this.onUpdate) this.onUpdate(this);
  }

  /** 座位 -> 是否是「由 AI 代打」（机器人或掉线托管） */
  isAutoSeat(seat) {
    const p = this.players[seat];
    if (!p) return false;
    return p.isBot || (!!this.state && p.autoPilot);
  }

  scheduleBots() {
    if (!this.state) {
      this.clearBotTimers();
      return;
    }
    const jobs = this.game.pendingBotActions(this.state, (seat) => this.isAutoSeat(seat));
    const validKeys = new Set();

    for (const job of jobs) {
      const key = `${this.state.phase}:${job.seat}:${job.type}`;
      validKeys.add(key);
      if (this.botTimers.has(key)) continue;
      const timer = setTimeout(() => {
        this.botTimers.delete(key);
        if (!this.state) return;
        this.dispatch(job.seat, job.type, job.payload, { auto: true });
      }, Math.max(300, job.delay));
      this.botTimers.set(key, timer);
    }

    for (const [key, timer] of this.botTimers) {
      if (!validKeys.has(key)) {
        clearTimeout(timer);
        this.botTimers.delete(key);
      }
    }
  }

  /** 执行一次牌局操作 */
  dispatch(seat, type, payload, { auto = false } = {}) {
    if (!this.state) return { error: '牌局尚未开始' };
    const player = this.players[seat];
    if (!player) return { error: '座位无效' };
    if (!auto && player.isBot) return { error: '机器人无需手动操作' };
    if (!auto && player.autoPilot) return { error: '你当前处于托管状态' };

    const before = this.state.phase;
    const result = this.game.applyAction(this.state, this.players, seat, type, payload);
    if (!result.ok) return result;

    if (before !== this.state.phase) {
      this.onPhaseChange(before, this.state.phase);
    }

    this.touch();
    return result;
  }

  onPhaseChange(from, to) {
    const PHASE = this.game.PHASE;
    if (to === PHASE.SETTLE) {
      this.recordRoundStats();
    }
    if (to === PHASE.BIG_END) {
      this.recordBigRoundStats();
    }
  }

  /** 逐局记录每位注册玩家的胜负，用于百场胜率 */
  recordRoundStats() {
    const results = this.state && this.state.results;
    if (!results) return;
    const bySeat = new Map();
    if (Array.isArray(results.entries)) {
      results.entries.forEach((e) => bySeat.set(e.seat, e));
    } else if (Array.isArray(results.rows) && results.dealer) {
      // 超级梦幻：庄家 + 各闲家
      results.rows.forEach((r) => {
        const net = r.outcome === 'win' ? (r.lostByDealer || 0) : -(r.seatCups || 0);
        bySeat.set(r.seat, {
          ...r,
          outcome: r.outcome === 'win' ? 'win' : 'lose',
          cupsWon: Math.max(0, net),
          cupsLost: Math.max(0, -net),
        });
      });
      const d = results.dealer;
      bySeat.set(results.dealerSeat, { seat: results.dealerSeat, cupsWon: d.won, cupsLost: d.lost, outcome: d.net > 0 ? 'win' : d.net < 0 ? 'lose' : 'draw' });
    } else if (Array.isArray(results.rows) && results.dealerRow) {
      results.rows.forEach((r) => bySeat.set(r.seat, r));
      bySeat.set(results.dealerRow.seat, results.dealerRow);
    }

    this.players.forEach((p, seat) => {
      if (p.isBot || p.isGuest) return;
      const r = bySeat.get(seat);
      if (!r) return;
      const net = (r.cupsWon || 0) - (r.cupsLost || 0);
      let outcome;
      if (r.outcome === 'win') outcome = 'win';
      else if (r.outcome === 'lose' || r.outcome === 'dealerWin') outcome = 'lose';
      else outcome = net > 0 ? 'win' : net < 0 ? 'lose' : 'draw';

      try {
        Matches.record(p.id, this.gameId, {
          outcome,
          net,
          cupsWon: r.cupsWon || 0,
          cupsLost: r.cupsLost || 0,
        });
      } catch (err) {
        console.error('[room] 记录逐局战绩失败', err);
      }
    });
  }

  recordBigRoundStats() {
    if (!this.state) return;
    const totals = this.state.bigTotals || [];
    this.players.forEach((p, seat) => {
      if (p.isBot || p.isGuest) return;
      const t = totals[seat];
      if (!t) return;
      try {
        Users.addGameResult(p.id, { cupsWon: t.won, cupsLost: t.lost });
      } catch (err) {
        console.error('[room] 记录战绩失败', err);
      }
    });
  }

  /** 玩家/观战者视角的公开信息，手牌严格按可见性脱敏 */
  serializeFor(viewerId, isSpectator = false) {
    const viewer = this.findPlayer(viewerId);
    const spec = isSpectator ? this.findSpectator(viewerId) : null;
    const isAdminSpec = !!spec?.isAdmin; // 管理员观战 = 上帝视角
    const viewerSeat = viewer ? viewer.seat : -1;
    const gs = this.state ? this.game.serialize(this.state) : null;
    const PHASE = this.game.PHASE;

    const revealAtEnd = this.game.revealHandsAtEnd !== false;
    const isSupermeng = this.gameId === 'supermeng';
    const handsVisible = (seat) => {
      if (!this.state) return false;
      // 管理员观战：上帝视角，可见所有手牌
      if (isSpectator && isAdminSpec) return true;
      // 普通观战者：只看公共信息，任何手牌不可见
      if (isSpectator) return false;
      // 超级梦幻：闷牌玩家看不到自己的牌（庄家看牌后除外）
      if (isSupermeng && seat === viewerSeat) {
        if (this.state.blind && this.state.blind[seat]) {
          if (seat === this.state.dealerSeat && this.state.dealerSawOwn) return true;
          return false;
        }
        return true;
      }
      if (seat === viewerSeat) return true;
      if (this.state.revealed && this.state.revealed[seat]) return true;
      if (!revealAtEnd) return false;
      // 本庄统计 / 移庄选人：本庄已结束，全部手牌公开
      if (this.state.phase === PHASE.BIG_END || this.state.phase === PHASE.DEALER_PICK) {
        return true;
      }
      // 本局结算：超级梦幻只公开「庄家 + 被开过牌的闲家」
      // 未被开牌的闲家手里还留着牌（下局继续用），提前亮出会让下局变明牌
      if (this.state.phase === PHASE.SETTLE) {
        if (isSupermeng) {
          if (seat === this.state.dealerSeat) return true;
          if (this.state.opened && this.state.opened[seat]) return true;
          return false;
        }
        return true;
      }
      return false;
    };

    const evalHand = (hand) =>
      (this.game.evalHand ? this.game.evalHand(hand, this.config) : null);

    const players = this.players.map((p) => {
      const seat = p.seat;
      const hand = this.state && handsVisible(seat) ? this.state.hands[seat] || [] : null;
      return {
        id: p.id,
        name: p.name,
        seat,
        isBot: p.isBot,
        isGuest: p.isGuest,
        isHost: p.id === this.hostId,
        isDealer: this.state ? this.state.dealerSeat === seat : false,
        ready: p.ready,
        connected: p.connected,
        autoPilot: p.autoPilot,
        bet: this.state ? this.state.bets[seat] || 0 : 0,
        betConfirmed: this.state ? this.state.betConfirmed[seat] : false,
        revealed: this.state ? !!this.state.revealed[seat] : false,
        summaryReady: this.state ? !!this.state.summaryReady[seat] : false,
        hand,
        handInfo: hand && hand.length === 2 ? evalHand(hand) : null,
        handCount: this.state ? (this.state.hands[seat] || []).length : 0,
      };
    });

    const myHand = (this.state && viewerSeat >= 0 && handsVisible(viewerSeat))
      ? this.state.hands[viewerSeat] || []
      : [];

    // 超级梦幻：比牌那一刻的双方牌面，只给「被开的闲家 + 庄家自己 + 管理员上帝视角」看
    // 其他闲家 / 普通观战者一律脱敏，前端渲染成牌背 —— 否则后面被开的闲家能照着庄家的牌决定服不服
    if (isSupermeng && gs && gs.lastEvent && gs.lastEvent.type === 'fight') {
      const fightSeat = gs.lastEvent.seat;
      const involved =
        (isSpectator && isAdminSpec) ||
        (!isSpectator && (viewerSeat === fightSeat || viewerSeat === this.state?.dealerSeat));
      if (!involved) {
        gs.lastEvent = {
          ...gs.lastEvent,
          hand: null,
          dealerHand: null,
          handName: '',
          dealerHandName: '',
          hidden: true,
        };
      }
    }

    return {
      id: this.id,
      gameId: this.gameId,
      gameName: this.game.name,
      hostId: this.hostId,
      hostName: this.findPlayer(this.hostId)?.name || '',
      config: this.config,
      configText: this.game.describeConfig(this.config),
      capacity: this.capacity,
      status: this.status,
      isHost: viewerId === this.hostId,
      isSpectator,
      mySeat: viewerSeat,
      myHand,
      myHandInfo: myHand.length === 2 ? evalHand(myHand) : null,
      hints: (this.state && this.game.hintsFor && !isSpectator) ? this.game.hintsFor(this.state, viewerSeat) : null,
      players,
      spectators: this.spectators.map((s) => ({ id: s.id, name: s.name, isAdmin: s.isAdmin })),
      canStart: this.canStart(),
      notice: this.pendingNotice || null,
      game: gs,
      createdAt: this.createdAt,
    };
  }

  lobbySummary() {
    const host = this.findPlayer(this.hostId);
    return {
      id: this.id,
      gameId: this.gameId,
      gameName: this.game.name,
      hostName: host ? host.name : '未知',
      playerCount: this.players.length,
      capacity: this.capacity,
      status: this.status,
      config: this.config,
      configText: this.game.describeConfig(this.config),
      humans: this.players.filter((p) => !p.isBot).length,
      bots: this.players.filter((p) => p.isBot).length,
      createdAt: this.createdAt,
    };
  }

  dispose() {
    this.clearBotTimers();
    if (this.onDestroy) this.onDestroy(this);
  }
}

export class RoomManager {
  constructor({ onUpdate, onListChange }) {
    this.rooms = new Map();
    this.onUpdate = onUpdate;
    this.onListChange = onListChange;
  }

  create({ gameId, config, host }) {
    const game = getGame(gameId);
    if (!game) return { error: '未找到该游戏' };
    const id = makeRoomId(new Set(this.rooms.keys()));
    const room = new Room({
      id,
      gameId,
      config,
      host,
      onUpdate: this.onUpdate,
      onDestroy: (r) => {
        this.rooms.delete(r.id);
        this.notifyList();
      },
    });
    this.rooms.set(id, room);
    this.notifyList();
    return { ok: true, room };
  }

  get(id) {
    return this.rooms.get(String(id || '').toUpperCase()) || null;
  }

  remove(room) {
    room.dispose();
    this.rooms.delete(room.id);
    this.notifyList();
  }

  list() {
    return [...this.rooms.values()]
      .map((r) => r.lobbySummary())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  notifyList() {
    if (this.onListChange) this.onListChange(this.list());
  }

  cleanup() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const humans = room.players.filter((p) => !p.isBot);
      const allOffline = humans.length === 0 || humans.every((p) => !p.connected);
      const idleTooLong = now - room.lastActivity > 1000 * 60 * 60 * 2;
      if (allOffline && now - room.lastActivity > 1000 * 60 * 10) {
        this.remove(room);
      } else if (idleTooLong && !room.state) {
        this.remove(room);
      }
    }
  }
}
