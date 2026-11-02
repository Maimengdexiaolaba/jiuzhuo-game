/**
 * 超级梦幻 · 阶段机
 *
 * 每局流程：闷牌声明(可选) → 发牌 → 庄家换牌(可选) → 叫酒(可锁) → 开牌服/不服结算 → 下一局
 * 大回合：剩牌 < 人数×2 → 本庄统计 → 移庄(可选重设规则) → 重新洗牌
 */
import {
  buildDeck, shuffle, deckSize, cardMeta,
} from './cards.js';
import { evaluateHand, compareHands } from './rules.js';

export const MODE = 'supermeng';

/** 整场每人闷牌次数上限 */
export const BLIND_LIMIT = 3;
/** 整场锁牌次数上限 */
export const LOCK_LIMIT = 1;

export const PHASE = {
  BLIND: 'blind',           // 发牌前声明闷牌
  DEALER_CHANGE: 'dealer_change', // 庄家看牌后可选换牌
  BET: 'bet',               // 闲家依次叫酒
  OPEN: 'open',             // 庄家开牌
  SETTLE: 'settle',         // 本局结算
  BIG_END: 'big_end',       // 本庄统计
  DEALER_PICK: 'dealer_pick', // 移庄
};

export const PHASE_TEXT = {
  [PHASE.BLIND]: '闷牌声明',
  [PHASE.DEALER_CHANGE]: '庄家换牌',
  [PHASE.BET]: '叫酒',
  [PHASE.OPEN]: '开牌',
  [PHASE.SETTLE]: '本局结算',
  [PHASE.BIG_END]: '本庄统计',
  [PHASE.DEALER_PICK]: '移庄',
};

function emit(state, event) {
  state.seq += 1;
  state.lastEvent = { ...event, seq: state.seq, at: Date.now() };
  state.log.push(state.lastEvent);
  if (state.log.length > 60) state.log.shift();
}

const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

/**
 * 该座位的最低叫酒杯数
 * 看牌 + 手牌是炸弹（真炸 / 假炸 / 天炸）→ 最少 2 杯
 * 闷牌看不到牌 → 不限制（开牌发现是炸弹也不追溯）
 */
function minBetFor(state, seat) {
  if (!state || seat === undefined || seat === null || seat < 0) return 1;
  if (state.blind && state.blind[seat]) return 1;
  const hand = state.hands[seat] || [];
  if (hand.length !== 2) return 1;
  const h = evaluateHand(hand[0], hand[1], state.config);
  return h.key === 'bomb' ? 2 : 1;
}

function betOrderSeats(state) {
  const order = [];
  for (let i = 1; i < state.playerCount; i += 1) {
    order.push((state.dealerSeat + i) % state.playerCount);
  }
  return order;
}

function firstSeatOf(state) {
  return (state.dealerSeat + 1) % state.playerCount;
}

function dealerHand(state) {
  return state.hands[state.dealerSeat];
}

export function normalizeConfig(c) {
  const c0 = c || {};
  return {
    withJoker: c0.withJoker !== false,
    orderRule: c0.orderRule === 'flushFirst' ? 'flushFirst' : 'straightFirst',
    bombRule: c0.bombRule === 'byPoint' ? 'byPoint' : 'realFirst',
    eatBomb235: c0.eatBomb235 !== false,
    allowBlind: c0.allowBlind === true,
    dealerChange: c0.dealerChange === 'once' || c0.dealerChange === 'twice' ? c0.dealerChange : 'none',
    betMax: c0.betMax === 'g2' ? 'g2' : ([2, 3].includes(Number(c0.betMax)) ? Number(c0.betMax) : 3),
    ace23: c0.ace23 !== false,
  };
}

export function defaultConfig() {
  return {
    withJoker: true,
    orderRule: 'straightFirst',
    bombRule: 'realFirst',
    eatBomb235: true,
    allowBlind: false,
    dealerChange: 'none',
    betMax: 3,
    ace23: true,
  };
}

export function createState({ playerCount, config }) {
  const cfg = normalizeConfig(config || {});
  const st = {
    mode: MODE,
    config: cfg,
    playerCount,
    phase: PHASE.BLIND,
    dealerSeat: 0,
    currentSeat: 0,
    deck: shuffle(buildDeck(cfg.withJoker)),
    totalDeck: deckSize(cfg.withJoker),
    hands: Array.from({ length: playerCount }, () => []),
    blind: Array.from({ length: playerCount }, () => false),
    blindOrder: [],
    blindCursor: 0,
    // 整场（一个庄家任期）累计：每人闷牌次数、锁牌次数
    blindUsed: Array.from({ length: playerCount }, () => 0),
    lockUsedCount: 0,
    bets: Array.from({ length: playerCount }, () => 0),
    betConfirmed: Array.from({ length: playerCount }, () => false),
    betOrder: [],
    betCursor: 0,
    locked: null,
    openSeat: null,
    openedCount: 0,
    opened: Array.from({ length: playerCount }, () => false),
    dealerChangeUsed: 0,
    dealerChangeLimit: cfg.dealerChange === 'twice' ? 2 : cfg.dealerChange === 'once' ? 1 : 0,
    dealerSelfPenalty: 0,
    dealerSawOwn: false, // 庄家是否已「看牌」（看自己牌）
    results: null,
    roundNo: 0,
    bigRound: 0,
    bigStats: null,
    history: [],
    newDealerSeat: null,
    revealed: Array.from({ length: playerCount }, () => false),
    summaryReady: Array.from({ length: playerCount }, () => false),
    seq: 0,
    lastEvent: null,
    log: [],
    _players: [],
  };
  startRound(st);
  return st;
}

function startRound(state) {
  // 上一局被庄家开过牌的闲家 → 手牌视为消耗，本局重发；
  // 没被开过牌的闲家 → 保留手牌，本局不重发；庄家每局重发
  const isFirstRound = state.roundNo === 0;
  const prevOpened = Array.isArray(state.opened) ? state.opened.slice() : [];
  state.hands = state.hands.map((h, s) => {
    if (isFirstRound) return [];
    if (s === state.dealerSeat) return [];
    if (prevOpened[s]) return [];
    return h.length === 2 ? h.slice() : [];
  });
  state.blind = Array.from({ length: state.playerCount }, () => false);
  state.bets = Array.from({ length: state.playerCount }, () => 0);
  state.betOrder = [];
  state.betCursor = 0;
  state.openSeat = null;
  state.openedCount = 0;
  state.opened = Array.from({ length: state.playerCount }, () => false);
  state.dealerSelfPenalty = 0;
  state.dealerSawOwn = false;
  state.results = null;
  state.revealed = Array.from({ length: state.playerCount }, () => false);
  state.roundNo += 1;

  if (state.config.allowBlind) {
    state.phase = PHASE.BLIND;
    state.blindOrder = [...betOrderSeats(state), state.dealerSeat];
    state.blindCursor = 0;
    state.currentSeat = state.blindOrder[0];
    return;
  }
  dealNow(state);
}

function dealNow(state) {
  for (let s = 0; s < state.playerCount; s += 1) {
    if (state.hands[s].length >= 2) continue; // 保留手牌的玩家不重发
    state.hands[s] = [state.deck.pop(), state.deck.pop()].filter(Boolean);
  }
  emit(state, { type: 'deal', handCounts: state.hands.map((h) => h.length), deckLeft: state.deck.length });
  // 叫酒在前，换牌在叫酒结束后（庄家看牌才能换）
  state.phase = PHASE.BET;
  beginBet(state);
}

/** 叫酒结束 → 庄家看牌且仍有换牌次数则进换牌，否则直接开牌 */
function afterBet(state) {
  const canChange = state.dealerChangeLimit > 0
    && state.dealerChangeUsed < state.dealerChangeLimit
    && !state.blind[state.dealerSeat];
  if (canChange) {
    state.phase = PHASE.DEALER_CHANGE;
    state.currentSeat = state.dealerSeat;
    return;
  }
  state.phase = PHASE.OPEN;
  state.openSeat = null;
  state.currentSeat = state.dealerSeat;
}

function beginBet(state) {
  const order = betOrderSeats(state);
  state.betOrder = order;
  if (state.locked) {
    for (const seat of order) state.bets[seat] = state.locked.cups;
    emit(state, { type: 'lockAuto', cups: state.locked.cups });
    afterBet(state);
    return;
  }
  // 干 2：全场默认 2 杯，跳过逐人叫酒
  if (state.config.betMax === 'g2') {
    for (const seat of order) state.bets[seat] = 2;
    emit(state, { type: 'g2Auto', cups: 2 });
    afterBet(state);
    return;
  }
  state.betCursor = 0;
  state.currentSeat = order[0];
}

function advanceBet(state) {
  const order = state.betOrder;
  const idx = order.indexOf(state.currentSeat);
  if (idx + 1 >= order.length) {
    afterBet(state);
    return;
  }
  state.betCursor = idx + 1;
  state.currentSeat = order[idx + 1];
}

function endRound(state) {
  const dealer = evaluateHand(dealerHand(state)[0], dealerHand(state)[1], state.config);
  const rows = [];
  let won = 0;
  let lost = 0;
  const winSeats = [];

  for (const seat of betOrderSeats(state)) {
    if (!state.opened[seat]) continue;
    const h = evaluateHand(state.hands[seat][0], state.hands[seat][1], state.config);
    const cmp = compareHands(dealer, h, state.config);
    const dealerWin = cmp >= 0; // 平局庄家胜
    const bet = state.bets[seat];
    const blind = state.blind[seat];
    const isFold = state.opened[seat] === 'fold';

    let seatCups = 0;
    let lostByDealer = 0;
    let outcome;

    if (isFold) {
      // 服 = 认输，不与庄家比大小，闲家必输（喝所押酒），庄家不赔
      seatCups = bet;
      outcome = 'fold';
    } else if (dealerWin) {
      seatCups = bet * 2;
      outcome = 'lose';
    } else {
      // 闲家赢（庄家输）：闲家闷 + 庄家已看牌 → 庄家输 4 倍，否则 2 倍
      const mult = blind && state.dealerSawOwn ? 4 : 2;
      lostByDealer = bet * mult;
      outcome = 'win';
    }
    won += seatCups;
    lost += lostByDealer;
    if (dealerWin) winSeats.push(seat);

    rows.push({
      seat,
      hand: state.hands[seat].slice(),
      handName: h.name,
      handKey: h.key,
      rank: h.rank,
      bet,
      blind,
      outcome,
      seatCups,
      lostByDealer,
      openType: state.opened[seat],
    });
  }

  const selfPenalty = state.dealerSelfPenalty;
  lost += selfPenalty;

  const first = firstSeatOf(state);
  const last = betOrderSeats(state)[betOrderSeats(state).length - 1];
  if (state.locked && state.playerCount >= 3 && winSeats.includes(first) && winSeats.includes(last)) {
    state.locked = null;
  }

  state.results = {
    dealerSeat: state.dealerSeat,
    dealer: {
      hand: dealerHand(state).slice(),
      handName: dealer.name,
      handKey: dealer.key,
      rank: dealer.rank,
      won,
      lost,
      net: won - lost,
      blind: state.blind[state.dealerSeat],
      selfPenalty,
    },
    rows,
    locked: state.locked,
    roundNo: state.roundNo,
  };

  state.history.push({ roundNo: state.roundNo, dealerSeat: state.dealerSeat, results: JSON.parse(JSON.stringify(state.results)) });

  // 注意：这里不清空手牌（结算面板还要展示牌面）。
  // 「未被开牌保留手牌 / 被开牌重发」在下一局 startRound 时按上一局 opened 判断。

  state.phase = PHASE.SETTLE;
  emit(state, { type: 'settle', results: state.results });
}

export const actions = {
  blindChoice(state, players, actor, payload) {
    if (state.phase !== PHASE.BLIND) return fail('当前无需声明闷牌');
    if (actor.seat !== state.currentSeat) return fail('还没轮到你声明');
    const wantBlind = !!payload?.blind;
    // 每人每场限闷 3 次
    if (wantBlind && (state.blindUsed[actor.seat] || 0) >= BLIND_LIMIT) {
      return fail(`本场闷牌次数已用完（每人限 ${BLIND_LIMIT} 次），只能看牌`);
    }
    state.blind[actor.seat] = wantBlind;
    if (wantBlind) state.blindUsed[actor.seat] = (state.blindUsed[actor.seat] || 0) + 1;
    emit(state, {
      type: 'blind',
      seat: actor.seat,
      blind: state.blind[actor.seat],
      blindLeft: BLIND_LIMIT - (state.blindUsed[actor.seat] || 0),
    });

    state.blindCursor += 1;
    if (state.blindCursor >= state.blindOrder.length) {
      dealNow(state);
      return ok();
    }
    // 庄家（最后一个）：只有存在闷牌闲家时才需要选，否则自动看牌
    const next = state.blindOrder[state.blindCursor];
    const anyBlind = betOrderSeats(state).some((s) => state.blind[s]);
    if (next === state.dealerSeat && !anyBlind) {
      state.blind[state.dealerSeat] = false;
      state.blindCursor += 1;
      dealNow(state);
      return ok();
    }
    state.currentSeat = next;
    return ok();
  },

  changeCards(state, players, actor) {
    if (state.phase !== PHASE.DEALER_CHANGE) return fail('当前不能换牌');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家能换牌');
    if (state.dealerChangeUsed >= state.dealerChangeLimit) return fail('本庄换牌次数已用完');
    state.hands[state.dealerSeat] = [state.deck.pop(), state.deck.pop()].filter(Boolean);
    state.dealerChangeUsed += 1;
    state.dealerSelfPenalty += 1;
    emit(state, { type: 'changeCards', seat: actor.seat, used: state.dealerChangeUsed, limit: state.dealerChangeLimit });
    state.phase = PHASE.OPEN;
    state.openSeat = null;
    state.currentSeat = state.dealerSeat;
    return ok();
  },

  skipChange(state, players, actor) {
    if (state.phase !== PHASE.DEALER_CHANGE) return fail('当前不能跳过');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家能操作');
    state.phase = PHASE.OPEN;
    state.openSeat = null;
    state.currentSeat = state.dealerSeat;
    return ok();
  },

  bet(state, players, actor, payload) {
    if (state.phase !== PHASE.BET) return fail('当前不能叫酒');
    if (actor.seat !== state.currentSeat) return fail('还没轮到你叫酒');
    const cups = Number(payload?.cups);
    if (![1, 2, 3].includes(cups) || cups > state.config.betMax) return fail('叫酒数量不合法');
    // 炸弹（真炸 / 假炸 / 天炸）最少叫 2 杯；闷牌玩家看不到牌，不限制也不追溯
    if (cups < 2 && minBetFor(state, actor.seat) > cups) {
      return fail('炸弹最少叫 2 杯');
    }
    state.bets[actor.seat] = cups;
    emit(state, { type: 'bet', seat: actor.seat, cups });
    advanceBet(state);
    return ok();
  },

  lock(state, players, actor) {
    if (state.phase !== PHASE.BET) return fail('当前不能锁酒');
    if (state.lockUsedCount >= LOCK_LIMIT) return fail(`本场锁牌次数已用完（整场限 ${LOCK_LIMIT} 次）`);
    const order = betOrderSeats(state);
    const last = order[order.length - 1];
    if (actor.seat !== last) return fail('只有尾家能锁酒');
    const firstCups = state.bets[order[0]];
    if (!(firstCups === 2 || firstCups === 3)) return fail('首家未叫 2 杯或 3 杯，不能锁');
    state.locked = { cups: firstCups };
    state.lockUsedCount += 1;
    for (const seat of order) state.bets[seat] = firstCups;
    emit(state, { type: 'lock', cups: firstCups });
    state.phase = PHASE.OPEN;
    state.openSeat = null;
    state.currentSeat = state.dealerSeat;
    return ok();
  },

  open(state, players, actor, payload) {
    if (state.phase !== PHASE.OPEN) return fail('当前不能开牌');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家能开牌');
    if (state.openSeat !== null) return fail('等待该闲家回应');
    const seat = Number(payload?.seat);
    if (seat === undefined || seat === state.dealerSeat) return fail('请选择要开的闲家');
    if (state.opened[seat]) return fail('该闲家已开过');
    state.openSeat = seat;
    state.currentSeat = seat;
    emit(state, { type: 'openRequest', seat });
    return ok();
  },

  fold(state, players, actor) {
    if (state.phase !== PHASE.OPEN || state.openSeat !== actor.seat) return fail('当前不是你服牌');
    state.opened[actor.seat] = 'fold';
    const bet = state.bets[actor.seat];
    emit(state, { type: 'fold', seat: actor.seat, cups: bet });
    state.openSeat = null;
    state.openedCount += 1;
    state.currentSeat = state.dealerSeat;
    return ok();
  },

  fight(state, players, actor) {
    if (state.phase !== PHASE.OPEN || state.openSeat !== actor.seat) return fail('当前不是你比牌');
    state.opened[actor.seat] = 'fight';
    const d = evaluateHand(dealerHand(state)[0], dealerHand(state)[1], state.config);
    const h = evaluateHand(state.hands[actor.seat][0], state.hands[actor.seat][1], state.config);
    const cmp = compareHands(d, h, state.config);
    // 亮牌规则：双方都看牌 → 亮牌即时展示；任一方闷牌 → 只出输赢，牌面留到本庄统计
    const seatSaw = !state.blind[actor.seat];
    const dealerSaw = !state.blind[state.dealerSeat] || state.dealerSawOwn;
    const reveal = seatSaw && dealerSaw;
    emit(state, {
      type: 'fight',
      seat: actor.seat,
      dealerWin: cmp >= 0,
      seatName: players.find((p) => p.seat === actor.seat)?.name || '',
      reveal,
      hand: reveal ? state.hands[actor.seat].slice() : null,
      dealerHand: reveal ? dealerHand(state).slice() : null,
      handName: reveal ? h.name : '',
      dealerHandName: reveal ? d.name : '',
    });
    state.openSeat = null;
    state.openedCount += 1;
    state.currentSeat = state.dealerSeat;
    return ok();
  },

  /** 闲家看牌（闷牌声明后，本局中途看自己的牌） */
  revealSelf(state, players, actor) {
    if (state.phase !== PHASE.OPEN) return fail('当前不能看牌');
    if (actor.seat === state.dealerSeat) return fail('庄家请用看牌按钮');
    if (!state.blind[actor.seat]) return fail('你已经是看牌状态');
    state.blind[actor.seat] = false;
    emit(state, { type: 'revealSelf', seat: actor.seat, hand: state.hands[actor.seat].slice() });
    return ok();
  },

  /** 庄家看牌：闷牌的庄家可中途看自己的牌（看牌后开闷牌闲家翻倍） */
  peek(state, players, actor) {
    if (actor.seat !== state.dealerSeat) return fail('只有庄家能看牌');
    if (state.dealerSawOwn) return fail('你已经看过牌了');
    state.dealerSawOwn = true;
    emit(state, { type: 'peek', seat: actor.seat });
    return ok();
  },

  stopOpen(state, players, actor) {
    if (state.phase !== PHASE.OPEN) return fail('当前不能结束开牌');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家能操作');
    if (state.openSeat !== null) return fail('等待该闲家回应');
    if (state.openedCount < 1) {
      return fail('庄家至少开一家');
    }
    endRound(state);
    return ok();
  },

  nextRound(state, players, actor) {
    if (state.phase !== PHASE.SETTLE) return fail('本局尚未结算');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家能开启下一局');
    if (state.deck.length < state.playerCount * 2) {
      state.phase = PHASE.BIG_END;
      state.bigStats = computeBigStats(state);
      state.summaryReady = Array.from({ length: state.playerCount }, () => false);
      emit(state, { type: 'bigEnd', bigStats: state.bigStats });
      return ok();
    }
    startRound(state);
    return ok();
  },

  pickDealer(state, players, actor, payload) {
    if (state.phase !== PHASE.DEALER_PICK && state.phase !== PHASE.BIG_END) return fail('当前不能移庄');
    const seat = Number(payload?.seat);
    if (seat === undefined || seat < 0 || seat >= state.playerCount) return fail('请选择新庄家');
    state.newDealerSeat = seat;
    emit(state, { type: 'dealerPicked', seat });
    return ok();
  },

  startBigRound(state, players, actor, payload) {
    if (state.phase !== PHASE.DEALER_PICK && state.phase !== PHASE.BIG_END) return fail('当前不能开局');
    const target = state.newDealerSeat ?? state.dealerSeat;
    if (actor.seat !== target) return fail('等待新庄家确认');
    if (payload?.config) {
      state.config = normalizeConfig({ ...state.config, ...payload.config });
      state.dealerChangeLimit = state.config.dealerChange === 'twice' ? 2 : state.config.dealerChange === 'once' ? 1 : 0;
    }
    state.dealerSeat = target;
    state.newDealerSeat = null;
    state.deck = shuffle(buildDeck(state.config.withJoker));
    state.totalDeck = deckSize(state.config.withJoker);
    state.dealerChangeUsed = 0;
    state.locked = null;
    // 移庄 / 连庄 = 新的一场游戏：闷牌、锁牌次数重置
    state.blindUsed = Array.from({ length: state.playerCount }, () => 0);
    state.lockUsedCount = 0;
    state.bigRound += 1;
    state.bigStats = null;
    state.history = [];
    state.roundNo = 0;
    startRound(state);
    emit(state, { type: 'bigStart', dealerSeat: state.dealerSeat, config: state.config });
    return ok();
  },

  closeSummary(state, players, actor) {
    if (state.phase !== PHASE.BIG_END) return fail('当前无需关闭');
    state.summaryReady[actor.seat] = true;
    // 庄家关闭后即进入移庄，不再要求全员关闭，避免真人掉线导致卡死
    if (actor.seat === state.dealerSeat || state.summaryReady.every((v) => v)) {
      state.phase = PHASE.DEALER_PICK;
      state.currentSeat = state.dealerSeat;
    }
    return ok();
  },
};

function computeBigStats(state) {
  const clean = Array.from({ length: state.playerCount }, () => ({ won: 0, lost: 0, net: 0, rounds: 0 }));
  for (const h of state.history) {
    const d = h.results.dealer;
    clean[h.dealerSeat].rounds += 1;
    clean[h.dealerSeat].won += d.won;
    clean[h.dealerSeat].lost += d.lost;
    clean[h.dealerSeat].net += d.won - d.lost;
    for (const r of h.results.rows) {
      clean[r.seat].rounds += 1;
      const seatWin = r.outcome === 'win' ? r.lostByDealer : 0;
      const seatLose = r.seatCups || 0;
      clean[r.seat].won += seatWin;
      clean[r.seat].lost += seatLose;
      clean[r.seat].net += seatWin - seatLose;
    }
  }
  return { rows: clean, rounds: state.history.length };
}

export function applyAction(state, players, actorSeat, type, payload) {
  const fn = actions[type];
  if (!fn) return fail(`未知操作：${type}`);
  const actor = players.find((p) => p.seat === actorSeat);
  if (!actor) return fail('玩家不在座位上');
  state._players = players;
  try {
    return fn(state, players, actor, payload);
  } catch (err) {
    console.error('[supermeng] action error', type, err);
    return fail('操作失败，请重试');
  }
}

export function waitingSeats(state) {
  if (state.phase === PHASE.BLIND) return [state.currentSeat];
  if (state.phase === PHASE.DEALER_CHANGE) return [state.dealerSeat];
  if (state.phase === PHASE.BET) return [state.currentSeat];
  if (state.phase === PHASE.OPEN) return state.openSeat !== null ? [state.openSeat] : [state.dealerSeat];
  if (state.phase === PHASE.SETTLE) return [state.dealerSeat];
  if (state.phase === PHASE.DEALER_PICK) return state.newDealerSeat !== null ? [state.newDealerSeat] : [state.dealerSeat];
  return [];
}

export function pendingBotActions(state, isBot) {
  const jobs = [];

  if (state.phase === PHASE.BLIND) {
    const seat = state.currentSeat;
    if (isBot(seat)) jobs.push({ seat, type: 'blindChoice', payload: { blind: Math.random() < 0.3 } });
  } else if (state.phase === PHASE.DEALER_CHANGE) {
    if (isBot(state.dealerSeat)) {
      const hand = state.hands[state.dealerSeat];
      const h = hand.length === 2 ? evaluateHand(hand[0], hand[1], state.config) : null;
      const weak = !h || (h.key === 'single' && h.rank < 10);
      jobs.push({ seat: state.dealerSeat, type: weak ? 'changeCards' : 'skipChange', payload: {} });
    }
  } else if (state.phase === PHASE.BET) {
    const seat = state.currentSeat;
    if (isBot(seat)) {
      const hand = state.hands[seat];
      const h = hand.length === 2 ? evaluateHand(hand[0], hand[1], state.config) : null;
      let cups = 1;
      if (h && (h.key === 'bomb' || h.key === 'flushStraight')) cups = Math.min(state.config.betMax, 3);
      else if (h && (h.key === 'straight' || h.key === 'flush')) cups = Math.min(state.config.betMax, 2);
      jobs.push({ seat, type: 'bet', payload: { cups } });
    }
  } else if (state.phase === PHASE.OPEN) {
    if (state.openSeat !== null) {
      const seat = state.openSeat;
      if (isBot(seat)) {
        const hand = state.hands[seat];
        const h = hand.length === 2 ? evaluateHand(hand[0], hand[1], state.config) : null;
        const strong = h && (h.key === 'bomb' || h.key === 'flushStraight' || (h.key === 'straight' && h.rank >= 10));
        jobs.push({ seat, type: strong && Math.random() < 0.7 ? 'fight' : 'fold', payload: {} });
      }
    } else if (isBot(state.dealerSeat)) {
      const dealer = evaluateHand(dealerHand(state)[0], dealerHand(state)[1], state.config);
      const cands = betOrderSeats(state).filter((s) => !state.opened[s]);
      if (cands.length) {
        cands.sort((a, b) => state.bets[b] - state.bets[a]);
        const strong = dealer.key === 'bomb' || dealer.key === 'flushStraight' || dealer.key === 'straight';
        jobs.push({ seat: state.dealerSeat, type: strong || state.openedCount < 1 ? 'open' : 'stopOpen', payload: strong || state.openedCount < 1 ? { seat: cands[0] } : {} });
      } else {
        jobs.push({ seat: state.dealerSeat, type: 'stopOpen', payload: {} });
      }
    }
  } else if (state.phase === PHASE.SETTLE) {
    if (isBot(state.dealerSeat)) jobs.push({ seat: state.dealerSeat, type: 'nextRound', payload: {} });
  } else if (state.phase === PHASE.BIG_END) {
    // 本庄统计：机器人自动关闭，庄家机器人直接推进到移庄
    if (isBot(state.dealerSeat)) {
      jobs.push({ seat: state.dealerSeat, type: 'closeSummary', payload: {} });
    } else {
      for (let s = 0; s < state.playerCount; s += 1) {
        if (isBot(s) && !state.summaryReady[s]) jobs.push({ seat: s, type: 'closeSummary', payload: {} });
      }
    }
  } else if (state.phase === PHASE.DEALER_PICK) {
    // 移庄：庄家机器人连庄或随机选新庄家，然后直接开新大回合
    if (isBot(state.dealerSeat) && state.newDealerSeat === null) {
      const stay = Math.random() < 0.4;
      const others = [];
      for (let s = 0; s < state.playerCount; s += 1) if (s !== state.dealerSeat) others.push(s);
      const target = stay ? state.dealerSeat : others[Math.floor(Math.random() * others.length)];
      jobs.push({ seat: state.dealerSeat, type: 'pickDealer', payload: { seat: target } });
    }
    if (isBot(state.newDealerSeat)) {
      jobs.push({ seat: state.newDealerSeat, type: 'startBigRound', payload: {} });
    }
  }
  return jobs;
}

export function serialize(state) {
  return {
    mode: state.mode,
    phase: state.phase,
    phaseText: PHASE_TEXT[state.phase] || '',
    dealerSeat: state.dealerSeat,
    currentSeat: state.currentSeat,
    roundNo: state.roundNo,
    bigRound: state.bigRound,
    deckLeft: state.deck.length,
    totalDeck: state.totalDeck,
    config: state.config,
    meta: cardMeta(state.config.withJoker),
    handCounts: state.hands.map((h) => h.length),
    blind: state.blind,
    blindUsed: state.blindUsed,
    blindLimit: BLIND_LIMIT,
    lockUsedCount: state.lockUsedCount,
    lockLimit: LOCK_LIMIT,
    bets: state.bets,
    betOrder: state.betOrder,
    locked: state.locked,
    openSeat: state.openSeat,
    opened: state.opened,
    openedCount: state.openedCount,
    canStop: state.openedCount >= 1,
    dealerChangeUsed: state.dealerChangeUsed,
    dealerChangeLimit: state.dealerChangeLimit,
    dealerChangeLeft: Math.max(0, state.dealerChangeLimit - state.dealerChangeUsed),
    dealerSawOwn: state.dealerSawOwn,
    revealed: state.revealed.slice(),
    results: state.results,
    bigStats: state.bigStats,
    history: state.history,
    newDealerSeat: state.newDealerSeat,
    lastEvent: state.lastEvent,
  };
}

/** 下发到前端的个人提示（叫酒杯数上下限等） */
export function hintsFor(state, seat) {
  if (!state || seat === undefined || seat === null || seat < 0) return null;
  return {
    betMin: minBetFor(state, seat),
    betMax: state.config.betMax,
    myTurnToBet: state.phase === PHASE.BET && state.currentSeat === seat,
  };
}
