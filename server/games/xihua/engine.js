import {
  MODE_B, RANK_TEXT, buildDeck, deckSize, shuffle, groupByRank, cardMeta,
} from './cards.js';
import { validatePlay, canBeat, isPassCard, isTurnBackCard, maxPlayCount } from './rules.js';

export const PHASE = {
  PLAY: 'play', // 轮流出牌
  PENALTY: 'penalty', // 罚酒确认
  SETTLE: 'settle', // 本局结算
};

export const PHASE_TEXT = {
  [PHASE.PLAY]: '轮流出牌',
  [PHASE.PENALTY]: '罚酒确认',
  [PHASE.SETTLE]: '本局结算',
};

function emit(state, event) {
  state.seq += 1;
  state.lastEvent = { ...event, seq: state.seq, at: Date.now() };
  state.log.push(state.lastEvent);
  if (state.log.length > 60) state.log.shift();
}

function fail(error) {
  return { ok: false, error };
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}

export function createState({ playerCount, config }) {
  return {
    mode: config.mode === MODE_B ? MODE_B : 'a54',
    penaltyMode: config.penalty === 'one' ? 'one' : 'two',
    playerCount,
    phase: PHASE.PLAY,
    dealerSeat: 0,
    hands: Array.from({ length: playerCount }, () => []),
    bottom: [],
    table: null,
    trickPile: [],
    passed: [],
    finished: [],
    currentSeat: 0,
    firstSeat: 0,
    lastWinner: null,
    roundNo: 0,
    // A 方案：累计罚杯
    penalties: Array.from({ length: playerCount }, () => 0),
    // B 方案：惩罚区
    penaltyZone: Array.from({ length: playerCount }, () => []),
    // 罚酒队列
    penaltyQueue: [],
    penaltyCursor: 0,
    penaltyAfter: PHASE.PLAY,
    results: null,
    // 兼容房间层的通用字段
    bets: Array.from({ length: playerCount }, () => 0),
    betConfirmed: Array.from({ length: playerCount }, () => false),
    revealed: Array.from({ length: playerCount }, () => false),
    summaryReady: Array.from({ length: playerCount }, () => false),
    history: [],
    seq: 0,
    lastEvent: null,
    log: [],
  };
}

function activeSeats(state) {
  const list = [];
  for (let s = 0; s < state.playerCount; s += 1) {
    if (state.hands[s].length > 0) list.push(s);
  }
  return list;
}

function nextActiveSeat(state, from) {
  for (let i = 1; i <= state.playerCount; i += 1) {
    const s = (from + i) % state.playerCount;
    if (state.hands[s].length > 0) return s;
  }
  return -1;
}

function prevActiveSeat(state, from) {
  for (let i = 1; i <= state.playerCount; i += 1) {
    const s = (from - i + state.playerCount * 2) % state.playerCount;
    if (state.hands[s].length > 0) return s;
  }
  return -1;
}

function sortHand(hand) {
  return hand.sort((a, b) => (a.rank - b.rank) || a.suit.localeCompare(b.suit));
}

/** 发牌并开始新一局 */
export function startRound(state, players) {
  const deck = shuffle(buildDeck(state.mode));
  const n = state.playerCount;
  const per = Math.floor(deck.length / n);
  state.bottom = deck.slice(per * n);
  state.hands = Array.from({ length: n }, (_, i) => sortHand(deck.slice(i * per, (i + 1) * per)));
  state.table = null;
  state.trickPile = [];
  state.passed = [];
  state.finished = [];
  state.penalties = Array.from({ length: n }, () => 0);
  state.penaltyZone = Array.from({ length: n }, () => []);
  state.penaltyQueue = [];
  state.penaltyCursor = 0;
  state.results = null;
  state.mergedRemaining = null;
  state.roundNo += 1;

  // 首出：A 方案持红桃 4 者（若在底牌则退化为房主）；B 方案房主；之后由上一局胜者先出
  let first = state.lastWinner ?? 0;
  if (state.lastWinner === null || state.lastWinner === undefined) {
    if (state.mode !== MODE_B) {
      const holder = state.hands.findIndex((h) => h.some((c) => c.id === 'h4'));
      first = holder >= 0 ? holder : 0;
    } else {
      first = 0;
    }
  }
  if (state.hands[first].length === 0) first = nextActiveSeat(state, first);
  state.firstSeat = first;
  state.currentSeat = first;
  state.phase = PHASE.PLAY;

  emit(state, {
    type: 'deal',
    firstSeat: first,
    perPlayer: per,
    bottom: state.bottom.length,
    handCounts: state.hands.map((h) => h.length),
  });
  return state;
}

function endRound(state, players) {
  if (state.trickPile && state.trickPile.length) {
    state.bottom.push(...state.trickPile);
    state.trickPile = [];
  }
  state.table = null;
  const lastSeat = activeSeats(state)[0];

  if (lastSeat !== undefined && lastSeat >= 0) {
    const remaining = state.hands[lastSeat].length;
    if (state.mode === MODE_B) {
      // 最后一位玩家的手牌并入其惩罚区
      state.mergedRemaining = { seat: lastSeat, count: remaining };
      state.penaltyZone[lastSeat].push(...state.hands[lastSeat]);
      state.hands[lastSeat] = [];
    } else if (remaining > 0) {
      state.penalties[lastSeat] += remaining;
    }
  }

  state.results = computeResults(state, players);

  // 结算后的罚杯不再逐人确认，直接进入本局统计（统计面板统一展示罚杯明细）
  state.phase = PHASE.SETTLE;
  state.penaltyQueue = [];
  state.penaltyCursor = 0;
  state.penaltyAfter = PHASE.SETTLE;

  emit(state, { type: 'settle', results: state.results });
}

function computeResults(state, players) {
  const n = state.playerCount;
  const order = [...state.finished];
  for (let s = 0; s < n; s += 1) {
    if (!order.includes(s)) order.push(s);
  }

  const entries = order.map((seat, idx) => {
    const merged = state.mergedRemaining && state.mergedRemaining.seat === seat
      ? state.mergedRemaining.count
      : null;
    const remaining = merged !== null ? merged : state.hands[seat].length;
    if (state.mode === MODE_B) {
      const zoneCount = state.penaltyZone[seat].length;
      const cups = state.penaltyMode === 'one' ? zoneCount : Math.floor(zoneCount / 2);
      return {
        seat,
        place: idx + 1,
        finished: idx < state.finished.length,
        remaining,
        zoneCount,
        cups,
        cupsWon: 0,
        cupsLost: cups,
        outcome: idx === 0 ? 'win' : 'lose',
      };
    }
    const cups = state.penalties[seat];
    return {
      seat,
      place: idx + 1,
      finished: idx < state.finished.length,
      remaining,
      penaltyCups: cups,
      cups,
      cupsWon: 0,
      cupsLost: cups,
      outcome: idx === 0 ? 'win' : 'lose',
    };
  });

  return {
    mode: state.mode,
    penaltyMode: state.penaltyMode,
    roundNo: state.roundNo,
    order,
    entries,
    winnerSeat: order[0],
    loserSeat: order[order.length - 1],
    totalCups: entries.reduce((a, e) => a + e.cups, 0),
  };
}

function finishSeat(state, seat, players) {
  if (state.finished.includes(seat)) return;
  state.finished.push(seat);
  const p = players.find((x) => x.seat === seat);
  emit(state, {
    type: 'finished',
    seat,
    name: p ? p.name : '',
    place: state.finished.length,
  });
}

/** 出完牌或过牌后推进轮次 */
function advanceTurn(state, from) {
  const active = activeSeats(state);

  // 只剩一人持有手牌 -> 本局结束
  if (active.length <= 1) {
    endRound(state, state._players || []);
    return;
  }

  if (state.mode === MODE_B) {
    state.currentSeat = nextActiveSeat(state, from);
    return;
  }

  // A 方案：判断这一手是否结束（除出牌人外全部过牌）
  const owner = state.table ? state.table.seat : null;
  if (owner === null) {
    state.currentSeat = nextActiveSeat(state, from);
    return;
  }
  const ownerActive = state.hands[owner].length > 0;
  const passers = state.passed.filter((s) => s !== owner && state.hands[s].length > 0);
  const others = active.filter((s) => s !== owner).length;
  if (ownerActive && passers.length >= others) {
    // 一圈都管不住，出牌人重新领出
    if (state.trickPile.length) {
      state.bottom.push(...state.trickPile);
      state.trickPile = [];
    }
    state.table = null;
    state.passed = [];
    state.currentSeat = owner;
    emit(state, { type: 'trickEnd', seat: owner });
    return;
  }
  if (!ownerActive && passers.length >= active.length) {
    if (state.trickPile.length) {
      state.bottom.push(...state.trickPile);
      state.trickPile = [];
    }
    state.table = null;
    state.passed = [];
    state.currentSeat = nextActiveSeat(state, from);
    emit(state, { type: 'trickEnd', seat: state.currentSeat });
    return;
  }
  state.currentSeat = nextActiveSeat(state, from);
}

export const actions = {
  /** 出牌 */
  play(state, players, actor, payload) {
    if (state.phase !== PHASE.PLAY) return fail('当前不能出牌');
    if (actor.seat !== state.currentSeat) return fail('还没轮到你出牌');

    const ids = Array.isArray(payload?.cardIds) ? payload.cardIds : [];
    const hand = state.hands[actor.seat];
    const cards = ids
      .map((id) => hand.find((c) => c.id === id))
      .filter(Boolean);
    if (cards.length !== ids.length) return fail('手牌中没有这些牌');

    const check = validatePlay(cards, state.table, state.mode);
    if (!check.ok) return fail(check.error);

    const rankName = RANK_TEXT[check.rank];

    // 过牌：牌留在桌面展示（不改变要管的那手牌），轮到下家继续管；可多张甩出
    if (check.kind === 'pass') {
      const removeIds = new Set(cards.map((c) => c.id));
      state.hands[actor.seat] = hand.filter((c) => !removeIds.has(c.id));
      state.trickPile.push(...cards);
      state.passed = [...state.passed, actor.seat];
      emit(state, { type: 'passCard', seat: actor.seat, rank: check.rank, count: check.count });
      if (state.hands[actor.seat].length === 0) finishSeat(state, actor.seat, players);
      advanceTurn(state, actor.seat);
      return ok();
    }

    // 白龙马（仅 B 方案）：牌进桌面牌堆，出牌权交给上家继续管；可多张甩出
    if (check.kind === 'turnback') {
      const removeIds = new Set(cards.map((c) => c.id));
      state.hands[actor.seat] = hand.filter((c) => !removeIds.has(c.id));
      state.trickPile.push(...cards);
      const prev = prevActiveSeat(state, actor.seat);
      emit(state, {
        type: 'turnback',
        seat: actor.seat,
        targetSeat: prev,
        count: check.count,
        targetName: players.find((p) => p.seat === prev)?.name || '',
      });
      if (state.hands[actor.seat].length === 0) finishSeat(state, actor.seat, players);
      if (activeSeats(state).length <= 1) {
        endRound(state, players);
        return ok();
      }
      // 桌面（要管的那手牌）保持不变，由上家继续出牌
      state.currentSeat = prev >= 0 ? prev : nextActiveSeat(state, actor.seat);
      return ok();
    }

    // 正常出牌：本轮已打出的牌累积在 trickPile，被管住也不清空
    const removeIds = new Set(cards.map((c) => c.id));
    state.hands[actor.seat] = hand.filter((c) => !removeIds.has(c.id));
    state.table = {
      seat: actor.seat,
      rank: check.rank,
      count: check.count,
      cards: cards.slice(),
    };
    state.trickPile.push(...cards);
    state.passed = [];

    emit(state, {
      type: 'play',
      seat: actor.seat,
      name: players.find((p) => p.seat === actor.seat)?.name || '',
      rank: check.rank,
      rankName,
      count: check.count,
      handLeft: state.hands[actor.seat].length,
    });

    if (state.hands[actor.seat].length === 0) {
      finishSeat(state, actor.seat, players);
    }

    if (activeSeats(state).length <= 1) {
      endRound(state, players);
      return ok();
    }

    state.currentSeat = nextActiveSeat(state, actor.seat);
    return ok();
  },

  /** 管不住 */
  pass(state, players, actor) {
    if (state.phase !== PHASE.PLAY) return fail('当前不能过牌');
    if (actor.seat !== state.currentSeat) return fail('还没轮到你');
    if (!state.table) return fail('当前没有需要管的牌，请直接出牌');

    const seat = actor.seat;

    if (state.mode === MODE_B) {
      // 收走本轮所有人打出的牌到自己右下角惩罚区（过牌 2 只展示、不计罚）
      const passCards = state.trickPile.filter((c) => isPassCard(c.rank));
      const collected = state.trickPile.filter((c) => !isPassCard(c.rank));
      const fromSeat = state.table.seat;
      if (passCards.length) state.bottom.push(...passCards);
      state.penaltyZone[seat].push(...collected);
      state.trickPile = [];
      state.table = null;
      state.passed = [];
      emit(state, {
        type: 'collect',
        seat,
        count: collected.length,
        zoneCount: state.penaltyZone[seat].length,
        fromSeat,
      });

      // 收牌的人（被惩罚人）领出下一轮
      if (activeSeats(state).length <= 1) {
        endRound(state, players);
        return ok();
      }
      state.currentSeat = state.hands[seat].length > 0 ? seat : nextActiveSeat(state, seat);
      return ok();
    }

    // A 方案：罚 1 杯，进入罚酒页面
    state.penalties[seat] += 1;
    state.passed = [...state.passed, seat];
    const entry = { seat, cups: 1, reason: '管不住上家，罚 1 杯' };
    emit(state, { type: 'penalty', seat, cups: 1 });
    advanceTurn(state, seat);

    if (state.results) {
      // 这一过牌刚好结束本局：罚杯已计入结算，直接进入本局统计
      state.penaltyQueue = [];
      state.penaltyCursor = 0;
      state.penaltyAfter = PHASE.SETTLE;
      state.phase = PHASE.SETTLE;
    } else {
      state.penaltyQueue = [entry];
      state.penaltyAfter = PHASE.PLAY;
      state.penaltyCursor = 0;
      state.phase = PHASE.PENALTY;
    }
    return ok();
  },

  /** 罚酒确认：喝完了 */
  ackPenalty(state, players, actor) {
    if (state.phase !== PHASE.PENALTY) return fail('当前不需要确认');
    const current = state.penaltyQueue[state.penaltyCursor];
    if (!current) return fail('没有待确认的罚酒');
    if (current.seat !== actor.seat) return fail('这不是你的罚酒');

    state.penaltyCursor += 1;
    emit(state, { type: 'penaltyDone', seat: actor.seat, cups: current.cups });

    if (state.penaltyCursor >= state.penaltyQueue.length) {
      state.phase = state.penaltyAfter || PHASE.PLAY;
      state.penaltyQueue = [];
      state.penaltyCursor = 0;
      if (state.results) state.phase = PHASE.SETTLE;
    }
    return ok();
  },

  /** 本局结束后开始下一局（由率先出完的玩家发起） */
  nextRound(state, players, actor) {
    if (state.phase !== PHASE.SETTLE) return fail('本局尚未结束');
    const winner = state.results ? state.results.winnerSeat : null;
    if (winner !== null && winner !== undefined && actor.seat !== winner) {
      return fail('等待本局第一名开启下一局');
    }
    state.lastWinner = state.results?.winnerSeat ?? null;
    startRound(state, players);
    return ok();
  },
};

export function applyAction(state, players, actorSeat, type, payload) {
  const fn = actions[type];
  if (!fn) return fail(`未知操作：${type}`);
  const actor = players.find((p) => p.seat === actorSeat);
  if (!actor) return fail('玩家不在座位上');
  state._players = players;
  try {
    return fn(state, players, actor, payload);
  } catch (err) {
    console.error('[xihua] action error', type, err);
    return fail('操作失败，请重试');
  }
}

/** 当前等待哪些座位操作 */
export function waitingSeats(state) {
  if (state.phase === PHASE.PENALTY) {
    const cur = state.penaltyQueue[state.penaltyCursor];
    return cur ? [cur.seat] : [];
  }
  if (state.phase === PHASE.PLAY) {
    return state.currentSeat >= 0 ? [state.currentSeat] : [];
  }
  if (state.phase === PHASE.SETTLE) {
    // 结算页由首位出完者点「下一局」
    return state.results ? [state.results.winnerSeat] : [];
  }
  return [];
}

/* ---------------- 机器人 ---------------- */

/**
 * 合法着法的唯一来源：前端高亮、机器人决策都从这里取，
 * 保证「界面能点的」和「引擎认的」结构性一致。
 */
export function legalPlays(state, seat) {
  const hand = state.hands[seat] || [];
  const table = state.table;
  const maxCount = maxPlayCount(state.mode);
  const passCards = hand.filter((c) => isPassCard(c.rank));
  const turnBackCards = hand.filter((c) => isTurnBackCard(c.rank, state.mode));
  // 跟牌时，2/6 也必须出与桌面相同的张数；数量不足则不构成合法的功能牌出法
  const passCount = table ? table.count : passCards.length;
  const turnBackCount = table ? table.count : turnBackCards.length;
  const out = {
    lead: !table,
    need: table ? table.count : 0,
    plays: [],
    passCard: passCards.length >= passCount ? passCards[0] : null,
    passCards: passCards.length >= passCount ? passCards.slice(0, passCount) : [],
    turnBack: turnBackCards.length >= turnBackCount ? turnBackCards[0] : null,
    turnBackCards: turnBackCards.length >= turnBackCount ? turnBackCards.slice(0, turnBackCount) : [],
  };
  if (!hand.length) return out;

  for (const [rank, cs] of groupByRank(hand).entries()) {
    if (isPassCard(rank) || isTurnBackCard(rank, state.mode)) continue;
    if (table) {
      if (cs.length < table.count) continue;
      if (!canBeat(rank, table.rank, state.mode)) continue;
      out.plays.push({ rank, count: table.count, cards: cs.slice(0, table.count) });
    } else {
      const max = Math.min(maxCount, cs.length);
      for (let n = 1; n <= max; n += 1) {
        out.plays.push({ rank, count: n, cards: cs.slice(0, n) });
      }
    }
  }
  return out;
}

function pickBotPlay(state, seat) {
  const hand = state.hands[seat];
  if (!hand.length) return null;
  const legal = legalPlays(state, seat);

  if (legal.lead) {
    // 领出：优先出最小的单张；只剩同点牌时按最多张出（压得别人接不上）
    if (legal.plays.length) {
      const singles = legal.plays.filter((p) => p.count === 1).sort((a, b) => a.rank - b.rank);
      if (singles.length) return { cardIds: [singles[0].cards[0].id] };
      const biggest = legal.plays.slice().sort((a, b) => b.count - a.count || a.rank - b.rank)[0];
      return { cardIds: biggest.cards.map((c) => c.id) };
    }
    // 手上只剩过牌 / 白龙马：单张甩出去让过
    return { cardIds: [hand[0].id] };
  }

  // 跟牌：手里有过牌时有一定概率直接过掉（出与桌面相同张数）
  if (legal.passCard && Math.random() < 0.25) {
    return { cardIds: legal.passCards.map((c) => c.id) };
  }
  if (legal.plays.length) {
    const cheapest = legal.plays.slice().sort((a, b) => a.rank - b.rank)[0];
    return { cardIds: cheapest.cards.map((c) => c.id) };
  }
  // 管不住：可用白龙马甩锅给上家（出与桌面相同张数）
  if (legal.turnBack && Math.random() < 0.3) {
    return { cardIds: legal.turnBackCards.map((c) => c.id) };
  }
  return { pass: true };
}

export function pendingBotActions(state, isBot) {
  const jobs = [];
  const push = (seat, type, payload, delay) => {
    if (!isBot(seat)) return;
    jobs.push({ seat, type, payload, delay });
  };

  if (state.phase === PHASE.PLAY) {
    const seat = state.currentSeat;
    if (seat >= 0 && isBot(seat)) {
      const choice = pickBotPlay(state, seat);
      if (choice?.pass) push(seat, 'pass', null, 1200 + Math.random() * 900);
      else if (choice) push(seat, 'play', { cardIds: choice.cardIds }, 900 + Math.random() * 900);
    }
  } else if (state.phase === PHASE.PENALTY) {
    const cur = state.penaltyQueue[state.penaltyCursor];
    if (cur) push(cur.seat, 'ackPenalty', null, 1200 + Math.random() * 800);
  } else if (state.phase === PHASE.SETTLE) {
    const winner = state.results?.winnerSeat;
    if (winner !== undefined && winner !== null) push(winner, 'nextRound', null, 4000);
  }
  return jobs;
}


/** 给某位玩家计算「能出哪些点数」，供前端高亮可出的牌 */
export function hintsFor(state, seat) {
  if (!state) return null;
  if (state.phase !== PHASE.PLAY || state.currentSeat !== seat) return null;
  if (!(state.hands[seat] || []).length) return null;

  const legal = legalPlays(state, seat);
  return {
    need: legal.need,
    lead: legal.lead,
    playable: [...new Set(legal.plays.map((p) => p.rank))],
    // 每个点数最多能出几张（领出时给前端做张数选择）
    counts: legal.plays.reduce((acc, p) => {
      acc[p.rank] = Math.max(acc[p.rank] || 0, p.count);
      return acc;
    }, {}),
    hasPassCard: !!legal.passCard,
    passCount: legal.passCards.length,
    hasTurnBack: !!legal.turnBack,
    turnBackCount: legal.turnBackCards.length,
  };
}

/* ---------------- 序列化 ---------------- */

export function serialize(state) {
  return {
    mode: state.mode,
    penaltyMode: state.penaltyMode,
    phase: state.phase,
    phaseText: PHASE_TEXT[state.phase] || '',
    roundNo: state.roundNo,
    playerCount: state.playerCount,
    currentSeat: state.currentSeat,
    firstSeat: state.firstSeat,
    table: state.table,
    trickPileCount: state.trickPile.length,
    trickCards: state.trickPile,
    passed: state.passed,
    finished: state.finished,
    handCounts: state.hands.map((h) => h.length),
    bottomCount: state.bottom.length,
    penalties: state.penalties,
    penaltyZoneCounts: state.penaltyZone.map((z) => z.length),
    penalty: state.penaltyQueue[state.penaltyCursor] || null,
    penaltyQueueLen: state.penaltyQueue.length,
    penaltyCursor: state.penaltyCursor,
    results: state.results,
    maxPlay: maxPlayCount(state.mode),
    deckSize: deckSize(state.mode),
    meta: cardMeta(state.mode),
    seq: state.seq,
    lastEvent: state.lastEvent,
  };
}
