/**
 * 推饼子牌组：1~9 筒 各 4 张（36 张） + 幺鸡 4 张 = 40 张
 * 牌的表示：{ id, r }
 *   r = 1..9  表示筒子的点数
 *   r = 0     表示幺鸡（按 1 点计算）
 */

export const RANK_LABEL = {
  0: '幺鸡',
  1: '一筒',
  2: '二筒',
  3: '三筒',
  4: '四筒',
  5: '五筒',
  6: '六筒',
  7: '七筒',
  8: '八筒',
  9: '九筒',
};

export const DECK_SIZE = 40;

export function buildDeck() {
  const deck = [];
  for (let r = 1; r <= 9; r += 1) {
    for (let i = 0; i < 4; i += 1) {
      deck.push({ id: `p${r}_${i}`, r });
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push({ id: `bird_${i}`, r: 0 });
  }
  return deck;
}

export function shuffleDeck(deck) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 一张牌的点值：幺鸡算 0 点，一筒~九筒按牌面算 1~9 点 */
export function cardPoint(card) {
  return card.r === 0 ? 0 : card.r;
}

export function cardName(card) {
  return RANK_LABEL[card.r];
}

export function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

export function rollTwoDice() {
  const d1 = rollDie();
  const d2 = rollDie();
  return { d1, d2, total: d1 + d2 };
}

/**
 * 命中庄家的点数表。
 * 按需求给定的三组实证规则归纳：{1, n+1, n+5}
 *   4 人局 -> 1 / 5 / 9
 *   5 人局 -> 1 / 6 / 10
 *   6 人局 -> 1 / 7 / 11
 * 超出两枚骰子上限（12）的取值自动省略。
 */
export function dealerHitTotals(playerCount) {
  const hits = new Set([1]);
  if (playerCount + 1 <= 12) hits.add(playerCount + 1);
  if (playerCount + 5 <= 12) hits.add(playerCount + 5);
  return [...hits].sort((a, b) => a - b);
}

/**
 * 根据两枚骰子总点数决定由谁担任动作人（切牌人 / 首个摸牌人）。
 * 命中庄家点数 -> 返回 0（庄家本人，无需切牌）；
 * 其余点数按座位顺序轮流分配给各位闲家。
 */
export function diceToSeat(total, playerCount) {
  if (!playerCount || playerCount <= 1) return 0;
  const hits = dealerHitTotals(playerCount);
  if (hits.includes(total)) return 0;

  let k = 0;
  for (let t = 2; t <= 12; t += 1) {
    if (hits.includes(t)) continue;
    if (t === total) return 1 + (k % (playerCount - 1));
    k += 1;
  }
  return 0;
}
