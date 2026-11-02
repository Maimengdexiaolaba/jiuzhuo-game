/**
 * 超级梦幻 · 牌型判定与比较
 *
 * 两张暗牌 + 想象第 3 张，系统按下列优先级固定判定牌型（不因对手变化）：
 *   天炸（王+王）
 *   炸弹：两张同点=真炸；王+X=单癞假炸（点数 X）
 *   同花顺：同色且相邻/隔1
 *   顺子：相邻或隔1（A 可选当 1 组成 A23）
 *   金花：同色
 *   235：手牌 2、5 且不同色（遇炸弹时 235 吃；否则按单牌，点数 5）
 *   单牌：取两张里最大的那张（A 最大、2 最小）
 *
 * 没有「对子」牌型。
 */
import { JOKER_S, JOKER_B, isJoker, RANK_TEXT } from './cards.js';

export const MODE = 'supermeng';

export const TIER = {
  bomb: 6,
  flushStraight: 5,
  straight: 3,
  flush: 3,
  single: 1,
};

/** 牌型 key 的中文名（用于展示） */
export function handName(hand) {
  if (hand.key === 'bomb') {
    if (hand.bombType === 'tian') return '天炸';
    if (hand.bombType === 'fake') return `假炸 · ${RANK_TEXT[hand.rank]}`;
    return `真炸 · ${RANK_TEXT[hand.rank]}`;
  }
  if (hand.key === 'bomb235') return '235';
  if (hand.key === 'flushStraight') return `同花顺 · ${RANK_TEXT[hand.rank]} 大`;
  if (hand.key === 'straight') return `顺子 · ${RANK_TEXT[hand.rank]} 大`;
  if (hand.key === 'flush') return `金花 · ${RANK_TEXT[hand.rank]} 大`;
  return `单牌 · ${RANK_TEXT[hand.rank]}`;
}

/** 是否构成顺子（相邻 diff=1 或隔一张 diff=2；A 可当 1） */
export function isStraightPair(a, b, ace23) {
  const diff = Math.abs(a - b);
  if (diff === 1 || diff === 2) return true;
  if (ace23) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    // A(14) 当 1：与 2 或 3 组成 A23
    if (hi === 14 && (lo === 2 || lo === 3)) return true;
  }
  return false;
}

/**
 * 顺子信息：顶牌 + 「想象的那张牌」
 * 想象牌由两张手牌唯一确定：
 *   - 相邻（差 1）→ 往上补一张：6,7 → 想象 8（顶 8）
 *   - 隔一张（差 2）→ 补中间：5,7 → 想象 6（顶 7）
 *   - 相邻且顶到 A → 只能往下补：K,A → 想象 Q（顶 A）
 *   - A 当 1 → A,2 想象 3；A,3 想象 2（顶 3）
 */
function straightInfo(a, b, ace23) {
  const diff = Math.abs(a - b);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (ace23 && hi === 14 && (lo === 2 || lo === 3)) {
    return { top: 3, imagine: lo === 2 ? 3 : 2 };
  }
  if (diff === 2) return { top: hi, imagine: hi - 1 };
  if (hi === 14) return { top: 14, imagine: lo - 1 };
  return { top: hi + 1, imagine: hi + 1 };
}

/** 判定两手牌（2 张）的最终牌型 */
export function evaluateHand(c1, c2, config) {
  const cfg = config || {};
  const withJoker = cfg.withJoker !== false;

  const j1 = isJoker(c1);
  const j2 = isJoker(c2);

  // 天炸：王 + 王
  if (j1 && j2) {
    return { key: 'bomb', bombType: 'tian', rank: 99, name: handName({ key: 'bomb', bombType: 'tian', rank: 99 }) };
  }
  // 单癞子假炸：王 + X
  if (j1 || j2) {
    const x = j1 ? c2 : c1;
    const h = { key: 'bomb', bombType: 'fake', rank: x.rank };
    h.name = handName(h);
    return h;
  }

  const a = c1.rank;
  const b = c2.rank;
  const sameSuit = c1.suit === c2.suit;

  // 真炸：同点
  if (a === b) {
    const h = { key: 'bomb', bombType: 'real', rank: a };
    h.name = handName(h);
    return h;
  }

  // 235（不同色 2、5）
  if (cfg.eatBomb235 && ((a === 2 && b === 5) || (a === 5 && b === 2)) && !sameSuit) {
    return { key: 'bomb235', rank: 5, name: '235', eatBomb: true };
  }

  const ace23 = cfg.ace23 !== false;
  const straight = isStraightPair(a, b, ace23);
  const info = straight ? straightInfo(a, b, ace23) : null;

  if (straight && sameSuit) {
    const h = { key: 'flushStraight', rank: info.top, imagine: info.imagine };
    h.name = handName(h);
    return h;
  }
  if (straight) {
    const h = { key: 'straight', rank: info.top, imagine: info.imagine };
    h.name = handName(h);
    return h;
  }
  if (sameSuit) {
    const h = { key: 'flush', rank: Math.max(a, b) };
    h.name = handName(h);
    return h;
  }

  // 单牌：两张里最大那张
  const h = { key: 'single', rank: Math.max(a, b) };
  h.name = handName(h);
  return h;
}

/** 牌型 tier（顺子/金花顺序由 config.orderRule 决定） */
function tierOf(key, config) {
  if (key === 'straight' || key === 'flush') {
    const straightFirst = config.orderRule !== 'flushFirst';
    if (key === 'straight') return straightFirst ? 3 : 2;
    return straightFirst ? 2 : 3;
  }
  return TIER[key] || 0;
}

function compareBombs(a, b, config) {
  const aReal = a.bombType === 'real';
  const bReal = b.bombType === 'real';
  if (config.bombRule === 'realFirst') {
    if (aReal && !bReal) return 1;
    if (!aReal && bReal) return -1;
  }
  if (a.rank !== b.rank) return a.rank > b.rank ? 1 : -1;
  return 0;
}

/**
 * 比较两手牌型。返回 1 = a 大，-1 = b 大，0 = 平（由庄家判定胜负）。
 */
export function compareHands(a, b, config) {
  const cfg = config || {};

  const aTian = a.key === 'bomb' && a.bombType === 'tian';
  const bTian = b.key === 'bomb' && b.bombType === 'tian';
  if (aTian && bTian) return 0;
  if (aTian) return 1;
  if (bTian) return -1;

  // 235 吃炸弹（含真炸与单癞假炸；天炸已排除）
  const aIsBomb = a.key === 'bomb';
  const bIsBomb = b.key === 'bomb';
  if (a.key === 'bomb235' && bIsBomb) return 1;
  if (b.key === 'bomb235' && aIsBomb) return -1;

  // 235 遇非炸弹 → 按单牌（点数 5）
  const aKey = a.key === 'bomb235' ? 'single' : a.key;
  const bKey = b.key === 'bomb235' ? 'single' : b.key;

  const ta = tierOf(aKey, cfg);
  const tb = tierOf(bKey, cfg);
  if (ta !== tb) return ta > tb ? 1 : -1;

  if (aKey === 'bomb') return compareBombs(a, b, cfg);

  const ar = aKey === 'single' && a.key === 'bomb235' ? 5 : a.rank;
  const br = bKey === 'single' && b.key === 'bomb235' ? 5 : b.rank;
  if (ar !== br) return ar > br ? 1 : -1;

  // 顺子 / 同花顺：顶牌相同 → 比「想象的那张牌」，想象牌越小越强（KA > QA > QK）
  if (aKey === 'straight' || aKey === 'flushStraight') {
    const ai = a.imagine ?? 99;
    const bi = b.imagine ?? 99;
    if (ai !== bi) return ai < bi ? 1 : -1;
  }
  return 0;
}
