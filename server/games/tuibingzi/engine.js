import { buildDeck, shuffleDeck, rollTwoDice, diceToSeat, DECK_SIZE } from './cards.js';
import { evaluateHand, settleAgainstDealer, compareHands } from './rules.js';

export const PHASE = {
  SHUFFLE: 'shuffle', // 等待庄家点击洗牌
  CUT_DICE: 'cut_dice', // 等待庄家掷切牌骰
  CUT_CHOICE: 'cut_choice', // 等待被点中的闲家选择切 / 不切
  BET: 'bet', // 闲家押酒
  DEAL_DICE: 'deal_dice', // 等待庄家掷发牌骰
  REVEAL_DEALER: 'reveal_dealer', // 等待庄家亮牌
  REVEAL_PLAYERS: 'reveal_players', // 等待闲家亮牌
  SETTLE: 'settle', // 本局结算展示
  BIG_END: 'big_end', // 大回合统计（牌墙摸完）
  DEALER_PICK: 'dealer_pick', // 移庄
};

export const PHASE_TEXT = {
  [PHASE.SHUFFLE]: '等待庄家洗牌',
  [PHASE.CUT_DICE]: '等待庄家掷骰定切牌人',
  [PHASE.CUT_CHOICE]: '等待闲家决定是否切牌',
  [PHASE.BET]: '闲家押酒中',
  [PHASE.DEAL_DICE]: '等待庄家掷骰定起手',
  [PHASE.REVEAL_DEALER]: '等待庄家亮牌',
  [PHASE.REVEAL_PLAYERS]: '等待闲家亮牌',
  [PHASE.SETTLE]: '本局结算',
  [PHASE.BIG_END]: '本庄结束 · 统计中',
  [PHASE.DEALER_PICK]: '移庄',
};

const BET_OPTIONS = [1, 2, 3];

function blankTotals(n) {
  return Array.from({ length: n }, () => ({ won: 0, lost: 0 }));
}

export function createState({ playerCount, config }) {
  return {
    playerCount,
    config: { erbaMax: !!config?.erbaMax },
    phase: PHASE.SHUFFLE,
    dealerSeat: 0,
    bigRound: 1,
    roundNo: 0,
    wall: [],
    wallTotal: DECK_SIZE,
    hands: Array.from({ length: playerCount }, () => []),
    bets: Array.from({ length: playerCount }, () => 0),
    revealed: Array.from({ length: playerCount }, () => false),
    betConfirmed: Array.from({ length: playerCount }, () => false),
    cut: { done: false, bySeat: null, index: 0, skipped: false },
    dice: { cut: null, deal: null },
    firstSeat: 0,
    results: null,
    bigTotals: blankTotals(playerCount),
    summaryReady: Array.from({ length: playerCount }, () => false),
    history: [],
    seq: 0,
    lastEvent: null,
    log: [],
  };
}

function emit(state, event) {
  state.seq += 1;
  state.lastEvent = { ...event, seq: state.seq, at: Date.now() };
  state.log.push(state.lastEvent);
  if (state.log.length > 60) state.log.shift();
}

function resetRoundState(state) {
  const n = state.playerCount;
  state.hands = Array.from({ length: n }, () => []);
  state.bets = Array.from({ length: n }, () => 0);
  state.betConfirmed = Array.from({ length: n }, () => false);
  state.revealed = Array.from({ length: n }, () => false);
  state.results = null;
  state.dice.deal = null;
}

function fail(error) {
  return { ok: false, error };
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}

function activePlayers(state, players) {
  return players.filter((p) => p.seat < state.playerCount);
}

function idleSeats(state, players) {
  return activePlayers(state, players).filter((p) => p.seat !== state.dealerSeat);
}

/** 切牌位置：由骰子点数推导，保证确定性且可复现 */
export function cutIndexFromDice(total, wallLength) {
  const raw = (total * 4 + 1) % wallLength;
  return raw === 0 ? 1 : raw;
}

function allPlayersBet(state) {
  for (let seat = 0; seat < state.playerCount; seat += 1) {
    if (seat === state.dealerSeat) continue;
    if (!state.betConfirmed[seat]) return false;
  }
  return true;
}

function allPlayersRevealed(state) {
  for (let seat = 0; seat < state.playerCount; seat += 1) {
    if (seat === state.dealerSeat) continue;
    if (!state.revealed[seat]) return false;
  }
  return true;
}

function computeSettlement(state) {
  const opts = state.config;
  const dealerHand = evaluateHand(state.hands[state.dealerSeat], opts);
  const rows = [];
  let dealerWon = 0;
  let dealerLost = 0;

  for (let seat = 0; seat < state.playerCount; seat += 1) {
    if (seat === state.dealerSeat) continue;
    const hand = evaluateHand(state.hands[seat], opts);
    const bet = state.bets[seat] || 0;
    const settled = settleAgainstDealer(dealerHand, hand, bet);
    const cupsWon = settled.outcome === 'win' ? settled.amount : 0;
    const cupsLost = settled.outcome === 'win' ? 0 : settled.amount;
    dealerWon += cupsLost;
    dealerLost += cupsWon;

    rows.push({
      seat,
      isDealer: false,
      hand: state.hands[seat],
      handName: hand.name,
      handKey: hand.key,
      handDetail: hand.detail,
      points: hand.point,
      showPoints: hand.showPoints !== false,
      isPair: hand.isPair,
      tier: hand.tier,
      bet,
      multiplier: settled.multiplier,
      amount: settled.amount,
      outcome: settled.outcome,
      note: settled.note,
      cupsWon,
      cupsLost,
    });

    state.bigTotals[seat].won += cupsWon;
    state.bigTotals[seat].lost += cupsLost;
  }

  state.bigTotals[state.dealerSeat].won += dealerWon;
  state.bigTotals[state.dealerSeat].lost += dealerLost;

  const dealerRow = {
    seat: state.dealerSeat,
    isDealer: true,
    hand: state.hands[state.dealerSeat],
    handName: dealerHand.name,
    handKey: dealerHand.key,
    handDetail: dealerHand.detail,
    points: dealerHand.point,
    showPoints: dealerHand.showPoints !== false,
    isPair: dealerHand.isPair,
    tier: dealerHand.tier,
    bet: 0,
    multiplier: 1,
    amount: 0,
    outcome: 'dealer',
    note: '',
    cupsWon: dealerWon,
    cupsLost: dealerLost,
  };

  return {
    dealerRow,
    rows,
    dealer: { won: dealerWon, lost: dealerLost },
    roundNo: state.roundNo,
    bigRound: state.bigRound,
  };
}

/** 生成本局的历史快照，用于牌桌内的历史回放 */
function buildHistoryEntry(state) {
  return {
    roundNo: state.roundNo,
    bigRound: state.bigRound,
    dealerSeat: state.dealerSeat,
    cutDice: state.dice.cut ? { ...state.dice.cut } : null,
    dealDice: state.dice.deal ? { ...state.dice.deal } : null,
    firstSeat: state.firstSeat,
    cut: { ...state.cut },
    wallLeft: state.wall.length,
    config: { ...state.config },
    results: state.results,
  };
}

export const actions = {
  /** 1. 洗牌 */
  shuffle(state, players, actor, _payload) {
    const seat = actor.seat;
    if (state.phase !== PHASE.SHUFFLE) return fail('当前阶段不能洗牌');
    if (seat !== state.dealerSeat) return fail('只有庄家可以洗牌');

    state.wall = shuffleDeck(buildDeck());
    state.wallTotal = state.wall.length;
    state.cut = { done: false, bySeat: null, index: 0, skipped: false };
    state.dice = { cut: null, deal: null };
    state.roundNo = 1;
    resetRoundState(state);
    state.phase = PHASE.CUT_DICE;
    emit(state, { type: 'shuffle', wall: state.wall.map((c) => c.id) });
    return ok();
  },

  /** 2. 庄家掷骰定切牌人 */
  rollCutDice(state, players, actor) {
    if (state.phase !== PHASE.CUT_DICE) return fail('当前阶段不能掷骰');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家可以掷切牌骰');

    const dice = rollTwoDice();
    state.dice.cut = dice;
    const targetSeat = diceToSeat(dice.total, state.playerCount);
    const targetPlayer = players.find((p) => p.seat === targetSeat);
    state.cut.bySeat = targetSeat;
    state.cut.skipped = false;
    state.cut.done = false;

    emit(state, {
      type: 'dice',
      purpose: 'cut',
      ...dice,
      targetSeat,
      targetName: targetPlayer ? targetPlayer.name : '',
      isDealer: targetSeat === state.dealerSeat,
    });

    if (targetSeat === state.dealerSeat) {
      // 点数命中庄家，无需切牌
      state.cut.done = true;
      state.cut.skipped = true;
      state.phase = PHASE.BET;
    } else {
      state.phase = PHASE.CUT_CHOICE;
    }
    return ok();
  },

  /** 3a. 闲家选择切牌 */
  cut(state, players, actor) {
    if (state.phase !== PHASE.CUT_CHOICE) return fail('当前阶段不能切牌');
    if (actor.seat !== state.cut.bySeat) return fail('只有被点中的玩家可以切牌');
    if (actor.seat === state.dealerSeat) return fail('庄家无需切牌');

    const index = cutIndexFromDice(state.dice.cut?.total || 7, state.wall.length);
    state.wall = state.wall.slice(index).concat(state.wall.slice(0, index));
    state.cut.done = true;
    state.cut.skipped = false;
    state.cut.index = index;
    state.phase = PHASE.BET;
    emit(state, { type: 'cut', index, bySeat: actor.seat });
    return ok();
  },

  /** 3b. 闲家选择不切牌 */
  skipCut(state, players, actor) {
    if (state.phase !== PHASE.CUT_CHOICE) return fail('当前阶段不能操作');
    if (actor.seat !== state.cut.bySeat) return fail('只有被点中的玩家可以操作');
    state.cut.done = true;
    state.cut.skipped = true;
    state.cut.index = 0;
    state.phase = PHASE.BET;
    emit(state, { type: 'skipCut', bySeat: actor.seat });
    return ok();
  },

  /** 4. 闲家押酒 */
  bet(state, players, actor, payload) {
    if (state.phase !== PHASE.BET) return fail('当前阶段不能押酒');
    const seat = actor.seat;
    if (seat === state.dealerSeat) return fail('庄家无需押酒');
    if (state.betConfirmed[seat]) return fail('你已经押过酒了');

    const cups = Number(payload?.cups);
    if (!BET_OPTIONS.includes(cups)) return fail('押酒只能是 1 / 2 / 3 杯');

    state.bets[seat] = cups;
    state.betConfirmed[seat] = true;
    emit(state, { type: 'bet', seat, cups });

    if (allPlayersBet(state)) {
      state.phase = PHASE.DEAL_DICE;
      emit(state, { type: 'allBet', total: state.bets.reduce((a, b) => a + b, 0) });
    }
    return ok();
  },

  /** 5. 庄家掷骰定首个摸牌人并发牌 */
  rollDealDice(state, players, actor) {
    if (state.phase !== PHASE.DEAL_DICE) return fail('当前阶段不能掷骰');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家可以掷发牌骰');
    if (state.wall.length < state.playerCount * 2) return fail('牌墙剩余牌数不足，本庄应结束');

    const dice = rollTwoDice();
    state.dice.deal = dice;
    const firstSeat = diceToSeat(dice.total, state.playerCount);
    state.firstSeat = firstSeat;

    const order = [];
    for (let i = 0; i < state.playerCount; i += 1) {
      order.push((firstSeat + i) % state.playerCount);
    }

    for (const seat of order) {
      const hand = [state.wall.shift(), state.wall.shift()];
      hand.sort((a, b) => (a.r === 0 ? 100 : a.r) - (b.r === 0 ? 100 : b.r));
      state.hands[seat] = hand;
    }

    state.phase = PHASE.REVEAL_DEALER;
    emit(state, {
      type: 'deal',
      purpose: 'deal',
      ...dice,
      firstSeat,
      firstName: players.find((p) => p.seat === firstSeat)?.name || '',
      order,
      wallLeft: state.wall.length,
    });
    return ok();
  },

  /** 6. 庄家亮牌 */
  revealDealer(state, players, actor) {
    if (state.phase !== PHASE.REVEAL_DEALER) return fail('当前阶段不能亮牌');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家可以亮牌');
    state.revealed[state.dealerSeat] = true;
    state.phase = PHASE.REVEAL_PLAYERS;
    emit(state, { type: 'revealDealer', seat: state.dealerSeat });
    return ok();
  },

  /** 7. 闲家亮牌（全部亮完后一起结算） */
  revealSelf(state, players, actor) {
    if (state.phase !== PHASE.REVEAL_PLAYERS) return fail('当前阶段不能亮牌');
    const seat = actor.seat;
    if (seat === state.dealerSeat) return fail('庄家已亮牌');
    if (state.revealed[seat]) return fail('你已经亮牌了');

    state.revealed[seat] = true;
    emit(state, { type: 'revealPlayer', seat });

    if (allPlayersRevealed(state)) {
      state.results = computeSettlement(state);
      state.history.push(buildHistoryEntry(state));
      state.phase = PHASE.SETTLE;
      emit(state, { type: 'settle', results: state.results });
    }
    return ok();
  },

  /** 8. 本局结束后庄家点【开始游戏】 */
  nextRound(state, players, actor) {
    if (state.phase !== PHASE.SETTLE) return fail('当前阶段不能开始下一局');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家可以开始下一局');

    const need = state.playerCount * 2;
    if (state.wall.length < need) {
      state.phase = PHASE.BIG_END;
      state.summaryReady = Array.from({ length: state.playerCount }, () => false);
      emit(state, {
        type: 'bigEnd',
        rounds: state.history.length,
        totals: state.bigTotals,
        wallLeft: state.wall.length,
      });
      return ok();
    }

    resetRoundState(state);
    state.roundNo += 1;
    state.phase = PHASE.BET;
    emit(state, { type: 'nextRound', roundNo: state.roundNo });
    return ok();
  },

  /** 9. 大回合统计面板关闭 -> 自动准备 */
  closeSummary(state, players, actor) {
    if (state.phase !== PHASE.BIG_END) return fail('当前阶段不能操作');
    state.summaryReady[actor.seat] = true;
    emit(state, { type: 'summaryReady', seat: actor.seat });

    // 庄家（或任意玩家）关闭后即进入移庄，不再要求全员关闭，
    // 避免有真人未点关闭或中途掉线导致整桌永久卡死。
    if (actor.seat === state.dealerSeat || state.summaryReady.every(Boolean)) {
      state.phase = PHASE.DEALER_PICK;
      emit(state, { type: 'dealerPickPhase', dealerSeat: state.dealerSeat });
    }
    return ok();
  },

  /** 10. 移庄：连庄或指定新庄家 */
  pickDealer(state, players, actor, payload) {
    if (state.phase !== PHASE.DEALER_PICK) return fail('当前阶段不能移庄');
    if (actor.seat !== state.dealerSeat) return fail('只有庄家可以决定移庄');

    const target = payload?.seat;
    let newDealer = state.dealerSeat;
    if (target !== null && target !== undefined && target !== -1) {
      const t = Number(target);
      if (!Number.isInteger(t) || t < 0 || t >= state.playerCount) return fail('目标座位无效');
      newDealer = t;
    }

    const prevDealer = state.dealerSeat;
    state.dealerSeat = newDealer;
    state.bigRound += 1;
    state.roundNo = 0;
    state.history = [];
    state.bigTotals = blankTotals(state.playerCount);
    state.summaryReady = Array.from({ length: state.playerCount }, () => false);
    state.cut = { done: false, bySeat: null, index: 0, skipped: false };
    state.dice = { cut: null, deal: null };
    state.wall = [];
    resetRoundState(state);
    state.phase = PHASE.SHUFFLE;

    emit(state, {
      type: 'dealerChanged',
      from: prevDealer,
      to: newDealer,
      stayed: prevDealer === newDealer,
      dealerName: players.find((p) => p.seat === newDealer)?.name || '',
    });
    return ok();
  },
};

export function applyAction(state, players, actorSeat, type, payload) {
  const fn = actions[type];
  if (!fn) return fail(`未知操作：${type}`);
  const actor = players.find((p) => p.seat === actorSeat);
  if (!actor) return fail('玩家不在座位上');
  try {
    return fn(state, players, actor, payload);
  } catch (err) {
    console.error('[engine] action error', type, err);
    return fail('操作失败，请重试');
  }
}

/** 当前阶段等待哪些座位操作 */
export function waitingSeats(state) {
  const n = state.playerCount;
  const seats = [];
  switch (state.phase) {
    case PHASE.SHUFFLE:
    case PHASE.CUT_DICE:
    case PHASE.DEAL_DICE:
    case PHASE.REVEAL_DEALER:
      seats.push(state.dealerSeat);
      break;
    case PHASE.CUT_CHOICE:
      if (state.cut.bySeat !== null) seats.push(state.cut.bySeat);
      break;
    case PHASE.BET:
      for (let s = 0; s < n; s += 1) {
        if (s !== state.dealerSeat && !state.betConfirmed[s]) seats.push(s);
      }
      break;
    case PHASE.REVEAL_PLAYERS:
      for (let s = 0; s < n; s += 1) {
        if (s !== state.dealerSeat && !state.revealed[s]) seats.push(s);
      }
      break;
    case PHASE.SETTLE:
      seats.push(state.dealerSeat);
      break;
    case PHASE.BIG_END:
      for (let s = 0; s < n; s += 1) {
        if (!state.summaryReady[s]) seats.push(s);
      }
      break;
    case PHASE.DEALER_PICK:
      seats.push(state.dealerSeat);
      break;
    default:
      break;
  }
  return seats;
}

/** 机器人待执行动作列表 */
export function pendingBotActions(state, isBot) {
  const n = state.playerCount;
  const jobs = [];
  const push = (seat, type, payload, delay) => {
    if (!isBot(seat)) return;
    jobs.push({ seat, type, payload, delay });
  };

  switch (state.phase) {
    case PHASE.SHUFFLE:
      push(state.dealerSeat, 'shuffle', null, 1400);
      break;
    case PHASE.CUT_DICE:
      push(state.dealerSeat, 'rollCutDice', null, 1400);
      break;
    case PHASE.CUT_CHOICE: {
      const seat = state.cut.bySeat;
      if (seat !== null && seat !== state.dealerSeat) {
        // 机器人倾向切牌（70%）
        const doCut = Math.random() < 0.7;
        push(seat, doCut ? 'cut' : 'skipCut', null, 1600);
      }
      break;
    }
    case PHASE.BET:
      for (let s = 0; s < n; s += 1) {
        if (s === state.dealerSeat || state.betConfirmed[s]) continue;
        const cups = 1 + Math.floor(Math.random() * 3);
        push(s, 'bet', { cups }, 900 + Math.random() * 1500);
      }
      break;
    case PHASE.DEAL_DICE:
      push(state.dealerSeat, 'rollDealDice', null, 1400);
      break;
    case PHASE.REVEAL_DEALER:
      push(state.dealerSeat, 'revealDealer', null, 1200);
      break;
    case PHASE.REVEAL_PLAYERS:
      for (let s = 0; s < n; s += 1) {
        if (s === state.dealerSeat || state.revealed[s]) continue;
        push(s, 'revealSelf', null, 700 + Math.random() * 1400);
      }
      break;
    case PHASE.SETTLE:
      push(state.dealerSeat, 'nextRound', null, 3200);
      break;
    case PHASE.BIG_END:
      for (let s = 0; s < n; s += 1) {
        if (!state.summaryReady[s]) push(s, 'closeSummary', null, 1500 + Math.random() * 1200);
      }
      break;
    case PHASE.DEALER_PICK: {
      if (!isBot(state.dealerSeat)) break;
      const others = [];
      for (let s = 0; s < n; s += 1) if (s !== state.dealerSeat) others.push(s);
      const stay = Math.random() < 0.4;
      const target = stay ? state.dealerSeat : others[Math.floor(Math.random() * others.length)];
      push(state.dealerSeat, 'pickDealer', { seat: target }, 1800);
      break;
    }
    default:
      break;
  }
  return jobs;
}

/** 给某个观察者生成脱敏状态 */
export function serialize(state, playerCount) {
  return {
    phase: state.phase,
    phaseText: PHASE_TEXT[state.phase] || '',
    config: state.config,
    dealerSeat: state.dealerSeat,
    bigRound: state.bigRound,
    roundNo: state.roundNo,
    wallLeft: state.wall.length,
    wallTotal: state.wallTotal,
    cut: state.cut,
    cutDice: state.dice.cut,
    dealDice: state.dice.deal,
    firstSeat: state.firstSeat,
    bets: state.bets.slice(),
    betConfirmed: state.betConfirmed.slice(),
    revealed: state.revealed.slice(),
    summaryReady: state.summaryReady.slice(),
    results: state.results,
    bigTotals: state.bigTotals,
    roundsPlayed: state.history.length,
    history: state.history,
    waitingSeats: waitingSeats(state),
    seq: state.seq,
    lastEvent: state.lastEvent,
    playerCount: state.playerCount,
  };
}

export { compareHands, evaluateHand, BET_OPTIONS };
